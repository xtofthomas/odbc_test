const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const path = require('path');

let backend = null;
let port = null;
const token = crypto.randomBytes(24).toString('hex');

// Dossier où vit config.json :
// - exe portable : à côté du .exe (PORTABLE_EXECUTABLE_DIR est fourni par electron-builder)
// - développement : dossier backend/
function configPath() {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
    || (app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', 'backend'));
  return path.join(dir, 'config.json');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function startBackend() {
  const env = { ...process.env, APP_TOKEN: token, APP_CONFIG: configPath() };
  const args = ['--port', String(port), '--watch-stdin'];

  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, 'backend', 'backend.exe');
    backend = spawn(exe, args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  } else {
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const script = path.join(__dirname, '..', 'backend', 'app.py');
    backend = spawn(py, [script, ...args], { env, windowsHide: true, stdio: ['pipe', 'inherit', 'pipe'] });
  }

  let stderr = '';
  backend.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
  backend.on('exit', (code) => {
    backend = null;
    if (code && !app.isQuitting) {
      dialog.showErrorBox('Backend arrêté', `Le backend Python s'est arrêté (code ${code}).\n\n${stderr}`);
    }
  });
}

async function waitForBackend(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Token': token } });
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Le backend ne répond pas.');
}

// Le renderer n'appelle jamais le backend directement : il passe par ici,
// ce qui évite les soucis CORS et garde le jeton hors de la page.
ipcMain.handle('api', async (_e, { method, url, body }) => {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'ODBC Test',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  try {
    port = await freePort();
    startBackend();
    await waitForBackend();
    await createWindow();
  } catch (err) {
    dialog.showErrorBox('Démarrage impossible', String(err));
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (backend) backend.kill();
});
app.on('window-all-closed', () => app.quit());
