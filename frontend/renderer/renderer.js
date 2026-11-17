const $ = (id) => document.getElementById(id);

function errText(res) {
  const d = res.data && res.data.detail;
  if (!d) return `Erreur HTTP ${res.status}`;
  return typeof d === 'string' ? d : JSON.stringify(d, null, 2);
}

function showResult(el, ok, text) {
  el.classList.remove('hidden', 'ok', 'err');
  el.classList.add(ok ? 'ok' : 'err');
  el.textContent = text;
}

async function init() {
  const h = await window.api.get('/health');
  $('status').textContent = h.ok ? `Python ${h.data.python} · pyodbc ${h.data.pyodbc}` : 'Backend indisponible';
  $('status').classList.add(h.ok ? 'ok' : 'err');

  const d = await window.api.get('/drivers');
  const ul = $('drivers');
  ul.innerHTML = '';
  (d.data.drivers || []).forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.title = 'Cliquer pour utiliser ce pilote';
    li.onclick = () => {
      const conn = $('conn');
      conn.value = conn.value.match(/Driver=\{[^}]*\}/i)
        ? conn.value.replace(/Driver=\{[^}]*\}/i, `Driver={${name}}`)
        : `Driver={${name}};` + conn.value;
    };
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = '<li class="none">Aucun pilote ODBC trouvé</li>';

  const s = await window.api.get('/dsns');
  const names = Object.keys(s.data.dsns || {});
  $('dsns').textContent = names.length ? `DSN disponibles : ${names.join(', ')}` : '';

  const c = await window.api.get('/config');
  if (c.ok && c.data.connection_string) $('conn').value = c.data.connection_string;
}

$('examples').onchange = (e) => {
  if (e.target.value) $('conn').value = e.target.value;
  e.target.value = '';
};

$('btnSave').onclick = async () => {
  const r = await window.api.put('/config', { connection_string: $('conn').value });
  showResult($('testResult'), r.ok, r.ok ? `Enregistré dans ${r.data.path}` : errText(r));
};

$('btnTest').onclick = async () => {
  const btn = $('btnTest');
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  try {
    const r = await window.api.post('/test', { connection_string: $('conn').value });
    if (!r.ok) return showResult($('testResult'), false, errText(r));
    const i = r.data;
    showResult($('testResult'), true,
      `Connexion réussie en ${i.connect_ms} ms\n` +
      `SGBD      : ${i.dbms} ${i.dbms_version}\n` +
      `Pilote    : ${i.driver} ${i.driver_version}\n` +
      `Serveur   : ${i.server}\n` +
      `Base      : ${i.database}\n` +
      `Utilisateur : ${i.user}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tester la connexion';
  }
};

$('btnRun').onclick = async () => {
  const btn = $('btnRun');
  btn.disabled = true;
  $('queryInfo').textContent = 'Exécution…';
  $('grid').innerHTML = '';
  try {
    const r = await window.api.post('/query', { connection_string: $('conn').value, sql: $('sql').value });
    if (!r.ok) {
      $('queryInfo').textContent = errText(r);
      $('queryInfo').className = 'err-text';
      return;
    }
    const { columns, rows, rowcount, elapsed_ms, truncated } = r.data;
    $('queryInfo').className = 'muted';
    $('queryInfo').textContent = columns.length
      ? `${rowcount} ligne(s)${truncated ? ' (tronqué)' : ''} · ${elapsed_ms} ms`
      : `Requête exécutée (${rowcount} ligne(s) affectée(s), annulé) · ${elapsed_ms} ms`;

    const grid = $('grid');
    if (!columns.length) return;
    const thead = grid.createTHead().insertRow();
    columns.forEach((c) => { const th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
    const tbody = grid.createTBody();
    rows.forEach((row) => {
      const tr = tbody.insertRow();
      row.forEach((v) => {
        const td = tr.insertCell();
        if (v === null) { td.textContent = 'NULL'; td.className = 'null'; } else td.textContent = v;
      });
    });
  } finally {
    btn.disabled = false;
  }
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement === $('sql')) $('btnRun').click();
});

init();
