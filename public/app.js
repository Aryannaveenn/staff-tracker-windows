let current = null;

const el = id => document.getElementById(id);

async function login(passcode) {
  const res = await fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({passcode})});
  if (!res.ok) throw await res.json();
  return res.json();
}

async function clock(employeeId, action) {
  const res = await fetch('/api/clock', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({employeeId, action})});
  return res.json();
}

async function status(employeeId) {
  const res = await fetch(`/api/status/${employeeId}`);
  return res.json();
}

async function history(employeeId) {
  const res = await fetch(`/api/history/${employeeId}`);
  return res.json();
}

function showLogin(msg=''){
  el('login-section').classList.remove('hidden');
  el('clock-section').classList.add('hidden');
  el('login-msg').textContent = msg;
}

function showClock(name){
  el('login-section').classList.add('hidden');
  el('clock-section').classList.remove('hidden');
  el('welcome').textContent = `Welcome, ${name}`;
}

el('login-btn').addEventListener('click', async ()=>{
  const pass = el('passcode').value.trim();
  el('login-msg').textContent = 'Checking...';
  try{
    const data = await login(pass);
    current = data;
    el('passcode').value = '';
    showClock(data.name);
    refreshStatus();
  }catch(e){
    el('login-msg').textContent = e && e.error ? e.error : 'Login failed';
  }
});

el('clock-in').addEventListener('click', async ()=>{
  if (!current) return;
  el('action-msg').textContent = 'Recording...';
  const res = await clock(current.id, 'in');
  if (res && res.error) el('action-msg').textContent = res.error; else el('action-msg').textContent = 'Clocked in';
  refreshStatus();
});

el('clock-out').addEventListener('click', async ()=>{
  if (!current) return;
  el('action-msg').textContent = 'Recording...';
  const res = await clock(current.id, 'out');
  if (res && res.error) el('action-msg').textContent = res.error;
  else {
    if (res.session_pay !== undefined) {
      el('action-msg').textContent = `Clocked out — earned $${(res.session_pay).toFixed(2)} (${(res.hours||0).toFixed(2)} hrs)`;
    } else {
      el('action-msg').textContent = 'Clocked out';
    }
  }
  refreshStatus();
});

el('view-history').addEventListener('click', async ()=>{
  if (!current) return;
  const sec = el('history-section');
  const list = el('history-list');
  sec.classList.toggle('hidden');
  if (sec.classList.contains('hidden')) return;
  list.innerHTML = 'Loading...';
  try{
    const res = await history(current.id);
    if (res && res.days) {
      if (res.days.length === 0) list.innerHTML = '<p class="muted">No history found</p>';
      else {
        list.innerHTML = '';
        res.days.forEach(day => {
          const dEl = document.createElement('div');
          dEl.className = 'card';
          const hdr = document.createElement('h4'); hdr.textContent = day.date; dEl.appendChild(hdr);
          const table = document.createElement('table');
          table.style.width = '100%';
          table.innerHTML = '<tr><th>Clock In</th><th>Clock Out</th></tr>';
          day.pairs.forEach(p => {
            const tr = document.createElement('tr');
            const tin = document.createElement('td'); tin.textContent = p.in || '-';
            const tout = document.createElement('td'); tout.textContent = p.out || '-';
            tr.appendChild(tin); tr.appendChild(tout); table.appendChild(tr);
          });
          dEl.appendChild(table);
          list.appendChild(dEl);
        });
      }
    } else list.innerHTML = '<p class="muted">No history</p>';
  }catch(err){ list.innerHTML = `<p class="muted">Error loading history</p>`; }
});

el('logout').addEventListener('click', ()=>{ current = null; showLogin(); el('action-msg').textContent = ''; el('last-status').textContent = '—'; });

async function refreshStatus(){
  if (!current) return;
  const st = await status(current.id);
  if (st && st.last) el('last-status').textContent = `${st.last.type} @ ${new Date(st.last.timestamp).toLocaleString()}`;
  else el('last-status').textContent = 'None recorded';
}

// Initial
showLogin('Enter your passcode (sample: 1111, 2222, 3333)');
