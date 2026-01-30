const $ = id => document.getElementById(id);

async function addEmployee() {
  const adminCode = $('adminCode').value.trim();
  const name = $('empName').value.trim();
  const passcode = $('empPass').value.trim();
  const pay_rate = parseFloat($('empRate').value) || 0;
  $('result').textContent = 'Working...';
  try {
    const res = await fetch('/api/admin/add-employee', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({ adminCode, name, passcode, pay_rate })
    });
    const data = await res.json();
    if (!res.ok) {
      $('result').textContent = data && data.error ? `Error: ${data.error}` : 'Error adding employee';
      return;
    }
    $('result').textContent = `Added ${data.name} (id ${data.id}) with pay rate $${Number(data.pay_rate).toFixed(2)}`;
    $('empName').value = '';
    $('empPass').value = '';
    $('empRate').value = '';
  } catch (err) {
    $('result').textContent = 'Network error';
  }
}

$('add-btn').addEventListener('click', addEmployee);
$('clear-btn').addEventListener('click', ()=>{ $('adminCode').value=''; $('empName').value=''; $('empPass').value=''; $('empRate').value=''; $('result').textContent=''; });
