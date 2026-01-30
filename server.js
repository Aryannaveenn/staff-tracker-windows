const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'staff.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function openDb() {
  return new sqlite3.Database(DB_FILE);
}

function initDbIfNeeded() {
  const db = openDb();
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      passcode TEXT NOT NULL UNIQUE,
      pay_rate REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      employee_name TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`);

    // Ensure attendance has employee_name column for older DBs
    db.all("PRAGMA table_info(attendance)", (err, cols) => {
      if (!err && Array.isArray(cols)) {
        const hasName = cols.some(c => c.name === 'employee_name');
        if (!hasName) {
          db.run('ALTER TABLE attendance ADD COLUMN employee_name TEXT', (aerr) => {
            if (aerr) console.warn('Could not add employee_name column:', aerr.message);
          });
        }
      }
    });

    // Ensure employees table has pay_rate column for older DBs
    db.all("PRAGMA table_info(employees)", (err2, cols2) => {
      if (!err2 && Array.isArray(cols2)) {
        const hasPay = cols2.some(c => c.name === 'pay_rate');
        if (!hasPay) {
          db.run('ALTER TABLE employees ADD COLUMN pay_rate REAL DEFAULT 0', (aerr) => {
            if (aerr) console.warn('Could not add pay_rate column:', aerr.message);
          });
        }
      }
    });

    db.get('SELECT COUNT(1) as c FROM employees', (err, row) => {
      if (err) {
        console.error(err);
        return db.close();
      }
      if (row.c === 0) {
          const stmt = db.prepare('INSERT INTO employees (name, passcode, pay_rate) VALUES (?,?,?)');
          stmt.run('Anmol', '1111', 30.00);
          stmt.run('Harshit', '2222', 25.50);
          stmt.run('Shivani', '3333', 28.75);
          stmt.run('Riya', '4444', 27.00);
        stmt.finalize(() => {
          console.log('Inserted sample employees');
          db.close();
        });
      } else {
        db.close();
      }
    });
  });
}

initDbIfNeeded();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const passcode = (req.body.passcode || '').toString();
  if (!passcode) return res.status(400).json({ error: 'passcode required' });
  const db = openDb();
  db.get('SELECT id, name FROM employees WHERE passcode = ?', [passcode], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.status(401).json({ error: 'invalid passcode' });
    res.json({ id: row.id, name: row.name });
  });
});

app.post('/api/clock', (req, res) => {
  const { employeeId, action } = req.body;
  if (!employeeId || !action) return res.status(400).json({ error: 'employeeId and action required' });
  const type = action === 'in' ? 'IN' : 'OUT';
  const db = openDb();

  // Lookup employee name and pay_rate then insert row with employee_name
  db.get('SELECT name, COALESCE(pay_rate,0) as pay_rate FROM employees WHERE id = ?', [employeeId], (err, emp) => {
    if (err) { console.error('DB error selecting employee:', err); db.close(); return res.status(500).json({ error: 'db error' }); }
    if (!emp) { db.close(); return res.status(404).json({ error: 'employee not found' }); }

    // Enforce one IN and one OUT per AEST day
    const { startUtc, endUtc } = getAESTDayRangeForNow();
    if (type === 'IN') {
      db.get('SELECT 1 FROM attendance WHERE employee_id = ? AND type = ? AND timestamp BETWEEN ? AND ? LIMIT 1', [employeeId, 'IN', startUtc, endUtc], (err2, exists) => {
        if (err2) { console.error('DB error checking existing IN:', err2); db.close(); return res.status(500).json({ error: 'db error' }); }
        if (exists) { db.close(); return res.status(400).json({ error: 'already clocked IN today' }); }
        // proceed to insert
        db.run('INSERT INTO attendance (employee_id, employee_name, type) VALUES (?,?,?)', [employeeId, emp.name, type], function(err3) {
          if (err3) { console.error('DB error inserting attendance:', err3); db.close(); return res.status(500).json({ error: 'db error' }); }
          const newId = this.lastID;
          // fetch the timestamp we just created
          db.get('SELECT timestamp FROM attendance WHERE id = ?', [newId], (err4, rowts) => {
            if (err4) { console.error('DB error fetching new timestamp:', err4); db.close(); return res.status(500).json({ error: 'db error' }); }

            // If this was an OUT, try to find the last IN to compute hours and pay
            if (type === 'OUT') {
              db.get('SELECT timestamp FROM attendance WHERE employee_id = ? AND type = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1', [employeeId, 'IN', rowts.timestamp], (err5, inrow) => {
                if (err5) { console.error('DB error finding previous IN:', err5); db.close(); return res.status(500).json({ error: 'db error' }); }
                db.close();
                const outTs = rowts && rowts.timestamp;
                const inTs = inrow && inrow.timestamp;
                let hours = 0;
                if (inTs && outTs) {
                  const dIn = new Date(inTs + 'Z');
                  const dOut = new Date(outTs + 'Z');
                  hours = Math.max(0, (dOut - dIn) / 3600000);
                }
                const rate = Number(emp.pay_rate) || 0;
                const pay = Math.round((hours * rate) * 100) / 100;
                const tsAest = formatToAEST(outTs);
                res.json({ success: true, id: newId, type, employee_name: emp.name, timestamp: tsAest, hours: Math.round(hours*100)/100, session_pay: pay, pay_rate: rate });
              });
            } else {
              // IN: just close and respond
              db.close();
              const tsAest = formatToAEST(rowts && rowts.timestamp);
              res.json({ success: true, id: newId, type, employee_name: emp.name, timestamp: tsAest });
            }
          });
        });
      });
    } else {
      // Ensure employee has clocked IN during the same AEST day before allowing OUT
      db.get('SELECT 1 FROM attendance WHERE employee_id = ? AND type = ? AND timestamp BETWEEN ? AND ? LIMIT 1', [employeeId, 'IN', startUtc, endUtc], (errIn, inExists) => {
        if (errIn) { console.error('DB error checking IN for OUT:', errIn); db.close(); return res.status(500).json({ error: 'db error' }); }
        if (!inExists) { db.close(); return res.status(400).json({ error: 'cannot clock OUT without clocking IN today' }); }

        // check if already clocked OUT today
        db.get('SELECT 1 FROM attendance WHERE employee_id = ? AND type = ? AND timestamp BETWEEN ? AND ? LIMIT 1', [employeeId, 'OUT', startUtc, endUtc], (err2, exists) => {
          if (err2) { console.error('DB error checking existing OUT:', err2); db.close(); return res.status(500).json({ error: 'db error' }); }
          if (exists) { db.close(); return res.status(400).json({ error: 'already clocked OUT today' }); }
          // proceed to insert OUT
          db.run('INSERT INTO attendance (employee_id, employee_name, type) VALUES (?,?,?)', [employeeId, emp.name, type], function(err3) {
            if (err3) { console.error('DB error inserting attendance (OUT):', err3); db.close(); return res.status(500).json({ error: 'db error' }); }
            const newId = this.lastID;
            db.get('SELECT timestamp FROM attendance WHERE id = ?', [newId], (err4, rowts) => {
              if (err4) { console.error('DB error fetching timestamp after OUT insert:', err4); db.close(); return res.status(500).json({ error: 'db error' }); }
              db.close();
              const tsAest = formatToAEST(rowts && rowts.timestamp);
              res.json({ success: true, id: newId, type, employee_name: emp.name, timestamp: tsAest });
            });
          });
        });
      });
    }
  });
});

// Admin: add employee (protected by adminCode)
app.post('/api/admin/add-employee', (req, res) => {
  const { adminCode, name, passcode, pay_rate } = req.body || {};
  if (adminCode !== '0123') return res.status(403).json({ error: 'forbidden' });
  if (!name || !passcode) return res.status(400).json({ error: 'name and passcode required' });
  const db = openDb();
  db.run('INSERT INTO employees (name, passcode, pay_rate) VALUES (?,?,?)', [name, passcode, Number(pay_rate) || 0], function(err) {
    db.close();
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'passcode already exists' });
      console.error('DB error adding employee:', err);
      return res.status(500).json({ error: 'db error' });
    }
    res.json({ id: this.lastID, name, passcode, pay_rate: Number(pay_rate) || 0 });
  });
});

app.get('/api/status/:employeeId', (req, res) => {
  const employeeId = req.params.employeeId;
  const db = openDb();
  db.get('SELECT type, timestamp FROM attendance WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1', [employeeId], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.json({ last: null });
    res.json({ last: { type: row.type, timestamp: formatToAEST(row.timestamp) } });
  });
});

const ExcelJS = require('exceljs');
const { DateTime } = require('luxon');

function formatToAEST(timestamp) {
  if (!timestamp) return '';
  // SQLite timestamps are in UTC like 'YYYY-MM-DD HH:MM:SS'
  const d = new Date(timestamp + 'Z');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce((acc, p) => {
    acc[p.type] = p.value; return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getAESTDayRangeForNow() {
  // returns start and end instants in UTC formatted as 'yyyy-LL-dd HH:mm:ss' matching SQLite timestamps
  const nowAest = DateTime.now().setZone('Australia/Sydney');
  const startAest = nowAest.startOf('day');
  const endAest = nowAest.endOf('day');
  const startUtc = startAest.toUTC().toFormat('yyyy-LL-dd HH:mm:ss');
  const endUtc = endAest.toUTC().toFormat('yyyy-LL-dd HH:mm:ss');
  return { startUtc, endUtc };
}

app.get('/api/export', async (req, res) => {
  const db = openDb();
  db.all('SELECT a.employee_id, a.employee_name, a.type, a.timestamp, e.pay_rate FROM attendance a LEFT JOIN employees e ON a.employee_id = e.id ORDER BY a.employee_name, a.timestamp', [], async (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });

    // Group rows by employee
    const byEmp = {};
    rows.forEach(r => {
      const name = r.employee_name || ('#' + r.employee_id);
      byEmp[name] = byEmp[name] || { events: [], pay_rate: Number(r.pay_rate) || 0 };
      byEmp[name].events.push({ type: r.type, timestamp: r.timestamp });
    });

    // Build pairs: for each IN, find next OUT; emit row per pair (timestamps converted to AEST)
    const outputRows = [];
    Object.keys(byEmp).forEach(name => {
      const events = byEmp[name].events;
      const rate = byEmp[name].pay_rate || 0;
      let i = 0;
      while (i < events.length) {
        if (events[i].type === 'IN') {
          const inTime = events[i].timestamp;
          // find next OUT after this IN
          let outTime = '';
          let j = i + 1;
          while (j < events.length) {
            if (events[j].type === 'OUT') { outTime = events[j].timestamp; break; }
            j++;
          }
          // compute hours and pay for this pair
          let hours = 0;
          if (inTime && outTime) {
            const dIn = new Date(inTime + 'Z');
            const dOut = new Date(outTime + 'Z');
            hours = Math.max(0, (dOut - dIn) / 3600000);
          }
          const pay = Math.round((hours * rate) * 100) / 100;
          outputRows.push({ name, pay_rate: rate, inTime: formatToAEST(inTime), outTime: formatToAEST(outTime), hours: Math.round(hours*100)/100, pay });
          i = j >= i+1 ? j+1 : i+1;
        } else {
          // skip stray OUT without preceding IN (optionally record)
          i++;
        }
      }
    });

    // Create Excel workbook
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Attendance');
    ws.columns = [
      { header: 'Employee Name', key: 'name', width: 30 },
      { header: 'Pay Rate', key: 'pay_rate', width: 12 },
      { header: 'Clock In', key: 'inTime', width: 25 },
      { header: 'Clock Out', key: 'outTime', width: 25 },
      { header: 'Hours', key: 'hours', width: 10 },
      { header: 'Pay', key: 'pay', width: 12 }
    ];

    outputRows.forEach(r => ws.addRow({ name: r.name, pay_rate: r.pay_rate, inTime: r.inTime, outTime: r.outTime, hours: r.hours, pay: r.pay }));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });
});

// Return history grouped by day (AEST) for an employee: pairs of clock in/out per day
app.get('/api/history/:employeeId', (req, res) => {
  const employeeId = req.params.employeeId;
  const db = openDb();
  db.all('SELECT type, timestamp FROM attendance WHERE employee_id = ? ORDER BY timestamp', [employeeId], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });

    // helper to get AEST date key YYYY-MM-DD
    const dateKey = (ts) => {
      if (!ts) return '';
      const d = new Date(ts + 'Z');
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
      return fmt.format(d);
    };

    const fmtTs = (ts) => formatToAEST(ts);

    const days = {};
    rows.forEach(r => {
      const day = dateKey(r.timestamp);
      if (!days[day]) days[day] = [];
      const list = days[day];
      if (r.type === 'IN') {
        // start a new pair
        list.push({ in: fmtTs(r.timestamp), out: null });
      } else {
        // OUT: attach to last pair if exists and has no out, otherwise create stray OUT
        if (list.length > 0 && list[list.length - 1].out === null) {
          list[list.length - 1].out = fmtTs(r.timestamp);
        } else {
          list.push({ in: null, out: fmtTs(r.timestamp) });
        }
      }
    });

    // Convert to array sorted by date desc
    const out = Object.keys(days).sort((a,b)=>b.localeCompare(a)).map(d => ({ date: d, pairs: days[d] }));
    res.json({ days: out });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
