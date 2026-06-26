const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const { exec, execSync } = require('child_process');
const { homedir, platform: osPlatform } = require('os');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const PROD_URL = 'https://whatsapp.eburon.ai';
const HOME = homedir();
const OS = osPlatform();

let mainWindow = null;

// ── IPC: Run terminal command ──
ipcMain.handle('run-terminal', async (_event, { command, cwd, timeout = 120 }) => {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: cwd || HOME,
      timeout: Math.min(timeout, 900) * 1000,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').slice(-100000),
        stderr: (stderr || '').slice(-100000),
        exitCode: error?.code || 0,
        error: error ? (error.killed ? 'Command timed out' : error.message?.slice(0, 500)) : null,
      });
    });
  });
});

// ── IPC: Check OpenCode installation ──
ipcMain.handle('check-opencode', async () => {
  try {
    const bin = execSync('which opencode 2>/dev/null || command -v opencode 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (!bin) return { installed: false, path: null, version: null };
    const ver = execSync('opencode --version 2>&1 || echo "unknown"', { encoding: 'utf8', timeout: 10000 }).trim();
    return { installed: true, path: bin, version: ver || 'unknown' };
  } catch {
    return { installed: false, path: null, version: null };
  }
});

// ── IPC: Check Ollama ──
ipcMain.handle('check-ollama', async () => {
  try {
    const bin = execSync('which ollama 2>/dev/null || command -v ollama 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (!bin) return { installed: false, running: false };
    const ver = execSync('ollama --version 2>&1 || echo "unknown"', { encoding: 'utf8', timeout: 10000 }).trim();
    let running = false;
    try { execSync('curl -s http://127.0.0.1:11434/api/tags', { encoding: 'utf8', timeout: 5000 }); running = true; } catch {}
    return { installed: true, version: ver, running };
  } catch {
    return { installed: false, running: false };
  }
});

// ── IPC: Check Node.js ──
ipcMain.handle('check-node', async () => {
  try {
    const v = execSync('node --version', { encoding: 'utf8' }).trim();
    const major = parseInt(v.replace('v', '').split('.')[0], 10);
    return { installed: true, version: v, ok: major >= 22 };
  } catch {
    return { installed: false, version: null, ok: false };
  }
});

// ── IPC: Get health / daemon info ──
ipcMain.handle('health', async () => {
  return { ok: true, platform: OS, home: HOME, isElectron: true };
});

// ── IPC: Set up workspace ──
ipcMain.handle('setup-workspace', async () => {
  const results = [];
  const OLLAMA_MODEL = 'media-pipe/eburon-sandbox-worker';

  // Check Node
  const node = (() => {
    try {
      const v = execSync('node --version', { encoding: 'utf8' }).trim();
      return { installed: true, version: v, ok: parseInt(v.replace('v','').split('.')[0]) >= 22 };
    } catch { return { installed: false, version: null, ok: false }; }
  })();
  results.push({ name: 'nodejs', ...node });

  // Check OpenCode
  const opencode = (() => {
    try {
      const bin = execSync('which opencode 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
      if (!bin) return { installed: false };
      const ver = execSync('opencode --version 2>&1', { encoding: 'utf8', timeout: 10000 }).trim();
      return { installed: true, version: ver };
    } catch { return { installed: false }; }
  })();
  results.push({ name: 'opencode', ...opencode });

  // Check Ollama
  const ollama = (() => {
    try {
      const bin = execSync('which ollama 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
      if (!bin) return { installed: false, running: false };
      let running = false;
      try { execSync('curl -s http://127.0.0.1:11434/api/tags', { encoding: 'utf8', timeout: 3000 }); running = true; } catch {}
      return { installed: true, running };
    } catch { return { installed: false, running: false }; }
  })();
  results.push({ name: 'ollama', ...ollama });

  // Check model
  let modelPulled = false;
  try {
    const list = execSync('ollama list 2>&1', { encoding: 'utf8', timeout: 10000 });
    modelPulled = list.includes(OLLAMA_MODEL);
  } catch {}
  results.push({ name: 'model', model: OLLAMA_MODEL, pulled: modelPulled });

  const allOk = node.ok && opencode.installed && ollama.installed && ollama.running && modelPulled;

  return {
    ok: allOk,
    results,
    summary: allOk ? 'Workspace ready' : 'Some components not installed',
    nextSteps: allOk ? [`OpenCode ready: opencode --model ${OLLAMA_MODEL}`] : [],
  };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: 'Beatrice - Eburon AI',
    icon: path.join(__dirname, '../public/icon-eburon.svg'),
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(PROD_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Beatrice',
      submenu: [
        { label: 'About Beatrice', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
