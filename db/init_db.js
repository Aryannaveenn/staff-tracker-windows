const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'staff.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE);

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

  // Ensure employee_name column exists for backwards-compatibility
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

  // Ensure employees table has pay_rate column for backwards-compatibility
  db.all("PRAGMA table_info(employees)", (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasPay = cols.some(c => c.name === 'pay_rate');
      if (!hasPay) {
        db.run('ALTER TABLE employees ADD COLUMN pay_rate REAL DEFAULT 0', (aerr) => {
          if (aerr) console.warn('Could not add pay_rate column:', aerr.message);
        });
      }
    }
  });

  db.get('SELECT COUNT(1) as c FROM employees', (err, row) => {
    if (err) return console.error(err);
    if (row.c === 0) {
      const stmt = db.prepare('INSERT INTO employees (name, passcode, pay_rate) VALUES (?,?,?)');
      stmt.run('Shivani', '1111', 30.00);
      stmt.run('Harshit', '2222', 25.50);
      stmt.run('Anmol', '3333', 28.75);
      stmt.finalize(() => {
        console.log('Sample employees inserted into', DB_FILE);
        db.close();
      });
    } else {
      console.log('Database already initialized at', DB_FILE);
      db.close();
    }
  });
});
