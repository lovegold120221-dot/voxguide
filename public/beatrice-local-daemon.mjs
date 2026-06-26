#!/usr/bin/env node
/**
 * Beatrice Local Daemon — lets Beatrice run terminal commands and install
 * the full local AI stack on your machine when a local folder is connected.
 *
 * Usage:
 *   node beatrice-local-daemon.mjs
 *   node beatrice-local-daemon.mjs --port=55420
 *
 * Listens on http://127.0.0.1:55420 — Beatrice's browser client connects
 * via fetch() (localhost is exempt from mixed-content blocking).
 *
 * Local AI stack (installed by POST /setup):
 *   Node.js 22  →  OpenCode CLI  →  Ollama  →  eburon-sandbox-worker
 *                  (with Zen free    (local    (media-pipe model
 *                   model chain)     LLM)      for workspace AI)
 */

import http from 'node:http';
import { exec, execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = parseInt(process.env.BEATRICE_DAEMON_PORT || process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '55420', 10);
const HOME = homedir();
const OS = platform(); // 'linux' | 'darwin' | 'win32'
const OLLAMA_MODEL = 'media-pipe/eburon-sandbox-worker';

// ── Permission grants filesystem (per-OS user, durable across restarts) ──
//
// Stored at ~/.beatrice/permissions.json — flat JSON keyed by user id.
// Shape matches the LocalPermissionGrant type declared in the frontend:
//   { [userId]: { selectedFolderPath, selectedFolderReadWrite,
//                 selectedFolderTerminal, wholeComputerTerminal,
//                 approvedAt, expiresAt?, approvedByUser } }
const PERMISSIONS_DIR = resolve(HOME, '.beatrice');
const PERMISSIONS_PATH = resolve(PERMISSIONS_DIR, 'permissions.json');

function readPermissions() {
  try {
    if (!existsSync(PERMISSIONS_PATH)) return {};
    const raw = readFileSync(PERMISSIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writePermissions(map) {
  try {
    if (!existsSync(PERMISSIONS_DIR)) mkdirSync(PERMISSIONS_DIR, { recursive: true });
    writeFileSync(PERMISSIONS_PATH, JSON.stringify(map, null, 2));
    return true;
  } catch {
    return false;
  }
}

function getGrant(userId) {
  if (!userId) return null;
  return readPermissions()[userId] || null;
}

function setGrant(userId, patch) {
  const map = readPermissions();
  const prev = map[userId] || {};
  map[userId] = { ...prev, ...patch, approvedByUser: true, approvedAt: new Date().toISOString() };
  writePermissions(map);
  return map[userId];
}

function deleteGrant(userId) {
  const map = readPermissions();
  if (!map[userId]) return null;
  delete map[userId];
  writePermissions(map);
  return true;
}

// ── Command classifier — single source of truth for the daemon's safety gate ──
//
// Levels: safe_readonly, safe_project_write, needs_confirmation, blocked.
// Named-blocklist keywords are surfaced back to the agent so it can explain
// the refusal. Path-based heuristics keep `rm -rf node_modules` allowed
// inside an approved project but block `rm -rf /`.
const COMMANDS_NEEDS_CONFIRMATION = [
  /\brm\b(?!\s+-[^\s]*\s+\/)/i,                    // rm (never root)
  /\bsudo\b/i,
  /\bchmod\s+-[rR]\b/i,
  /\bchown\s+-[rR]\b/i,
  /\bdiskutil\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fdx\b/i,
  /\bgit\s+push\b[^\n]*--force\b/i,
  /\bgit\s+push\b[^\n]*-f\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bterraform\s+(apply|destroy)\b/i,
  /\bkubectl\s+delete\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\bdelete\s+from\b[^\n]*\b(?!where\b)/i,         // DELETE FROM without WHERE
  /\bcurl\b[^\n]*\|\s*(bash|sh|zsh)\b/i,         // curl | bash
  /\bvercel\b[^\n]*--prod\b/i,
  /\brailway\s+up\b/i,
  /\bfly\s+deploy\b/i,
  /\bgcloud\s+run\s+deploy\b/i,
  /\baws\b[^\n]*\b(delete|terminate|destroy)\b/i,
];

const COMMANDS_BLOCKED = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\s+rm\s+-rf\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:(){ :\|:& };:/,                                 // fork bomb
  /\bchmod\s+777\s+\//i,
];

const COMMANDS_SAFE_READONLY = [
  /^\s*pwd\b/i,
  /^\s*ls\b/i,
  /^\s*tree\b/i,
  /^\s*cat\b/i,
  /^\s*head\b/i,
  /^\s*tail\b/i,
  /^\s*rg\b/i,
  /^\s*fd\b/i,
  /^\s*grep\b/i,
  /^\s*git\s+status\b/i,
  /^\s*git\s+log\b/i,
  /^\s*git\s+diff\b/i,
  /^\s*git\s+show\b/i,
  /^\s*node\s+--?version\b/i,
  /^\s*npm\s+test\b/i,
  /^\s*pnpm\s+test\b/i,
  /^\s*yarn\s+test\b/i,
];

function classifyCommand(commandString) {
  if (typeof commandString !== 'string' || commandString.trim().length === 0) {
    return { level: 'blocked', reason: 'empty command' };
  }
  for (const re of COMMANDS_BLOCKED) {
    if (re.test(commandString)) return { level: 'blocked', reason: re.toString() };
  }
  for (const re of COMMANDS_NEEDS_CONFIRMATION) {
    if (re.test(commandString)) return { level: 'needs_confirmation', reason: re.toString() };
  }
  for (const re of COMMANDS_SAFE_READONLY) {
    if (re.test(commandString)) return { level: 'safe_readonly', reason: re.toString() };
  }
  return { level: 'safe_project_write', reason: 'not matched by block or confirm lists' };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Private-Network': 'true',
};

function json(res, status, data) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({ raw: body }); }
    });
  });
}

function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: cwd || HOME,
      timeout: timeoutMs || 300_000,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').slice(-100_000),
        stderr: (stderr || '').slice(-100_000),
        exitCode: error?.code || 0,
        error: error ? (error.killed ? 'Command timed out' : error.message?.slice(0, 500)) : null,
      });
    });
  });
}

// ── Status checks ──────────────────────────────────────────────

function checkNodeVersion() {
  try {
    const v = execSync('node --version', { encoding: 'utf8' }).trim();
    const major = parseInt(v.replace('v', '').split('.')[0], 10);
    return { installed: true, version: v, ok: major >= 22 };
  } catch {
    return { installed: false, version: null, ok: false };
  }
}

function checkOpenCode() {
  try {
    const bin = execSync('which opencode 2>/dev/null || command -v opencode 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (!bin) return { installed: false, path: null, version: null };
    const ver = execSync('opencode --version 2>&1 || echo "unknown"', { encoding: 'utf8', timeout: 10_000 }).trim();
    return { installed: true, path: bin, version: ver || 'unknown' };
  } catch {
    return { installed: false, path: null, version: null };
  }
}

function checkOllama() {
  try {
    const bin = execSync('which ollama 2>/dev/null || command -v ollama 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (!bin) return { installed: false, path: null, version: null, running: false };
    const ver = execSync('ollama --version 2>&1 || echo "unknown"', { encoding: 'utf8', timeout: 10_000 }).trim();
    let running = false;
    try { execSync('ollama list 2>&1', { encoding: 'utf8', timeout: 5_000 }); running = true; } catch { /* 404 on empty list is ok, connection refused means not running */ }
    // Try to check if the API is actually up
    try {
      const http = require('node:http');
      const check = new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(3000, () => { req.destroy(); resolve(null); });
      });
      // This won't work synchronously, so just check with exec
    } catch {}
    return { installed: true, path: bin, version: ver || 'unknown', running };
  } catch {
    return { installed: false, path: null, version: null, running: false };
  }
}

function checkOllamaModel(model) {
  try {
    const list = execSync('ollama list 2>&1', { encoding: 'utf8', timeout: 10_000 });
    return list.includes(model);
  } catch {
    return false;
  }
}

// ── Installers ─────────────────────────────────────────────────

async function installNode() {
  const results = [];
  const current = checkNodeVersion();
  if (current.ok) return { ...current, results };

  const isMac = OS === 'darwin';
  const isLinux = OS === 'linux';
  const shell = isMac
    ? `export HOMEBREW_NO_AUTO_UPDATE=1 && export NONINTERACTIVE=1 && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22`
    : `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22`;

  if (isMac || isLinux) {
    const r = await runCommand(shell, HOME, 180_000);
    results.push({ step: 'install_node', ok: r.ok, summary: r.stdout.slice(0, 2000) + r.stderr.slice(0, 2000) });
  }

  const verify = checkNodeVersion();
  return { ...verify, results };
}

async function installOpenCodeCLI() {
  const results = [];
  const isMac = OS === 'darwin';
  const cmd = isMac
    ? 'export NONINTERACTIVE=1 && curl -fsSL https://get.opencode.ai | sh'
    : 'export NONINTERACTIVE=1 && curl -fsSL https://get.opencode.ai | sh';

  try {
    const r = await runCommand(cmd, HOME, 180_000);
    results.push({ step: 'install_opencode', ok: r.ok, summary: (r.stdout + r.stderr).slice(0, 3000) });
  } catch (e) {
    results.push({ step: 'install_opencode', ok: false, error: e.message });
  }

  const verify = checkOpenCode();
  return { ...verify, results };
}

async function installOllama() {
  const results = [];
  const isMac = OS === 'darwin';
  const isLinux = OS === 'linux';

  if (checkOllama().installed) {
    const v = checkOllama();
    return { ...v, results: [{ step: 'ollama_already_installed', version: v.version }] };
  }

  let cmd;
  if (isMac) {
    cmd = 'export NONINTERACTIVE=1 && export HOMEBREW_NO_AUTO_UPDATE=1 && (command -v brew >/dev/null && brew install ollama) || (curl -fsSL https://ollama.com/install.sh | sh)';
  } else if (isLinux) {
    cmd = 'curl -fsSL https://ollama.com/install.sh | sh';
  } else {
    return { installed: false, error: 'Windows not supported for automatic Ollama installation. Install from https://ollama.com' };
  }

  try {
    const r = await runCommand(cmd, HOME, 300_000);
    results.push({ step: 'install_ollama', ok: r.ok, summary: (r.stdout + r.stderr).slice(0, 3000) });
  } catch (e) {
    results.push({ step: 'install_ollama', ok: false, error: e.message });
  }

  // Start Ollama in background
  try {
    if (isMac) {
      await runCommand('open -a Ollama 2>/dev/null || ollama serve > /dev/null 2>&1 &', HOME, 10_000);
    } else {
      await runCommand('ollama serve > /dev/null 2>&1 &', HOME, 10_000);
    }
    results.push({ step: 'start_ollama', ok: true });
    // Wait for it to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch {
    results.push({ step: 'start_ollama', ok: false, error: 'Ollama may need to be started manually: ollama serve' });
  }

  const verify = checkOllama();
  return { ...verify, results };
}

async function pullOllamaModel(model) {
  const results = [];

  if (!checkOllama().installed) {
    return { ok: false, error: 'Ollama is not installed. Install it first.' };
  }

  if (checkOllamaModel(model)) {
    return { ok: true, model, alreadyPulled: true, message: `Model ${model} is already pulled.` };
  }

  try {
    const r = await runCommand(`ollama pull ${model}`, HOME, 600_000);
    results.push({ step: 'pull_model', ok: r.ok, summary: (r.stdout + r.stderr).slice(0, 3000) });
  } catch (e) {
    results.push({ step: 'pull_model', ok: false, error: e.message });
  }

  const pulled = checkOllamaModel(model);
  return { ok: pulled, model, results, message: pulled ? `Model ${model} is ready.` : `Failed to pull ${model}.` };
}

// ── OpenCode configuration ─────────────────────────────────────

const OPENCODE_CONFIG_PATH = resolve(HOME, '.opencode', 'config.json');
const ZEN_FREE_MODELS = [
  'opencode/zenn-ai-large-free',
  'opencode/deepseek-v4-flash-free',
  'opencode/big-pickle',
  'opencode/north-mini-code-free',
  'opencode/mimo-v2.5-free',
  'opencode/nemotron-3-ultra-free',
];

function configureOpenCode() {
  try {
    const configDir = resolve(HOME, '.opencode');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

    let config = {};
    if (existsSync(OPENCODE_CONFIG_PATH)) {
      try { config = JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, 'utf8')); } catch { /* start fresh */ }
    }

    // Set Ollama-hosted workspace model as primary
    config.default_model = `ollama/${OLLAMA_MODEL}`;
    // Zen free model swap chain (tried in order when primary runs out of free tokens)
    config.fallback_models = ZEN_FREE_MODELS;
    // Launch command: opencode --model media-pipe/eburon-sandbox-worker
    config.launch_command = `opencode --model ${OLLAMA_MODEL}`;

    writeFileSync(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    return {
      ok: true,
      configPath: OPENCODE_CONFIG_PATH,
      primaryModel: config.default_model,
      fallbackModels: config.fallback_models,
      launchCommand: config.launch_command,
      message: `OpenCode configured: primary=${config.default_model}, fallback=${config.fallback_models.length} Zen free models`,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Full workspace setup ───────────────────────────────────────

async function setupWorkspace() {
  const steps = [];

  // 1. Node.js 22
  let node = checkNodeVersion();
  steps.push({ name: 'nodejs', installed: node.installed, ok: node.ok, version: node.version, status: node.ok ? 'ok' : 'needs_install' });
  if (!node.ok) {
    node = await installNode();
    steps.push({ name: 'nodejs', installed: node.installed, ok: node.ok, version: node.version, status: node.ok ? 'installed' : 'failed' });
  }

  // 2. OpenCode CLI
  let opencode = checkOpenCode();
  steps.push({ name: 'opencode', installed: opencode.installed, version: opencode.version, status: opencode.installed ? 'ok' : 'needs_install' });
  if (!opencode.installed) {
    opencode = await installOpenCodeCLI();
    steps.push({ name: 'opencode', installed: opencode.installed, version: opencode.version, status: opencode.installed ? 'installed' : 'failed' });
  }

  // 3. Ollama
  let ollama = checkOllama();
  steps.push({ name: 'ollama', installed: ollama.installed, running: ollama.running, version: ollama.version, status: ollama.installed ? (ollama.running ? 'ok' : 'needs_start') : 'needs_install' });
  if (!ollama.installed) {
    ollama = await installOllama();
    steps.push({ name: 'ollama', installed: ollama.installed, running: ollama.running, version: ollama.version, status: ollama.installed ? (ollama.running ? 'ok' : 'needs_start') : 'failed' });
  } else if (ollama.installed && !ollama.running) {
    try {
      if (OS === 'darwin') {
        await runCommand('open -a Ollama 2>/dev/null || ollama serve > /dev/null 2>&1 &', HOME, 10_000);
      } else {
        await runCommand('ollama serve > /dev/null 2>&1 &', HOME, 10_000);
      }
      await new Promise(r => setTimeout(r, 5000));
      ollama = checkOllama();
      steps.push({ name: 'ollama', installed: ollama.installed, running: ollama.running, status: ollama.running ? 'started' : 'start_failed' });
    } catch {
      steps.push({ name: 'ollama', installed: true, running: false, status: 'start_failed' });
    }
  }

  // 4. Pull the workspace model
  let modelPulled = checkOllamaModel(OLLAMA_MODEL);
  steps.push({ name: 'model', model: OLLAMA_MODEL, pulled: modelPulled, status: modelPulled ? 'ok' : 'needs_pull' });
  if (!modelPulled && ollama.installed && ollama.running) {
    const pullResult = await pullOllamaModel(OLLAMA_MODEL);
    modelPulled = pullResult.ok;
    steps.push({ name: 'model', model: OLLAMA_MODEL, pulled: pullResult.ok, status: pullResult.ok ? 'pulled' : 'pull_failed', details: pullResult.results?.[0]?.summary });
  }

  // 5. Configure OpenCode to use the Ollama model with Zen fallback chain
  if (opencode.installed) {
    const config = configureOpenCode();
    steps.push({ name: 'opencode_config', configured: config.ok, primaryModel: OLLAMA_MODEL, fallbackCount: ZEN_FREE_MODELS.length, status: config.ok ? 'configured' : 'config_failed', launchCommand: `opencode --model ${OLLAMA_MODEL}` });
  }

  const allOk = node.ok && opencode.installed && ollama.installed && ollama.running && checkOllamaModel(OLLAMA_MODEL);

  return {
    ok: allOk,
    steps,
    summary: allOk
      ? `Full workspace is ready. Launch: opencode --model ${OLLAMA_MODEL}`
      : 'Some components are not ready. Check each step above.',
    nextSteps: allOk ? [
      `Launch OpenCode with: opencode --model ${OLLAMA_MODEL}`,
      `Ollama model ${OLLAMA_MODEL} runs locally on port 11434`,
      `OpenCode config at ${OPENCODE_CONFIG_PATH} sets ${OLLAMA_MODEL} as primary with ${ZEN_FREE_MODELS.length} Zen free model fallbacks`,
    ] : [],
  };
}

function getSetupStatus() {
  const node = checkNodeVersion();
  const opencode = checkOpenCode();
  const ollama = checkOllama();
  const model = checkOllamaModel(OLLAMA_MODEL);

  return {
    ok: true,
    nodejs: { installed: node.installed, ok: node.ok, version: node.version },
    opencode: { installed: opencode.installed, version: opencode.version, path: opencode.path },
    ollama: { installed: ollama.installed, running: ollama.running, version: ollama.version },
    model: { name: OLLAMA_MODEL, pulled: model },
    allReady: node.ok && opencode.installed && ollama.installed && ollama.running && model,
  };
}

// ── HTTP Server ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  // ── GET /health ──
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      version: '2.0.0',
      platform: OS,
      home: HOME,
      daemonPort: PORT,
    });
    return;
  }

  // ── GET /setup-status ──
  if (req.method === 'GET' && url.pathname === '/setup-status') {
    json(res, 200, getSetupStatus());
    return;
  }

  // ── POST /setup ──
  if (req.method === 'POST' && url.pathname === '/setup') {
    const result = await setupWorkspace();
    json(res, result.ok ? 200 : 200, result); // always 200, check .ok
    return;
  }

  // ── GET /opencode ──
  if (req.method === 'GET' && url.pathname === '/opencode') {
    json(res, 200, { ok: true, ...checkOpenCode() });
    return;
  }

  // ── POST /install-opencode ──
  if (req.method === 'POST' && url.pathname === '/install-opencode') {
    const result = await installOpenCodeCLI();
    json(res, 200, result);
    return;
  }

  // ── GET /ollama ──
  if (req.method === 'GET' && url.pathname === '/ollama') {
    json(res, 200, { ok: true, ...checkOllama() });
    return;
  }

  // ── POST /install-ollama ──
  if (req.method === 'POST' && url.pathname === '/install-ollama') {
    const result = await installOllama();
    json(res, 200, result);
    return;
  }

  // ── GET /ollama-models ──
  if (req.method === 'GET' && url.pathname === '/ollama-models') {
    try {
      const list = execSync('ollama list 2>&1', { encoding: 'utf8', timeout: 10_000 });
      json(res, 200, { ok: true, models: list.trim() });
    } catch (e) {
      json(res, 200, { ok: false, error: e.message || 'Cannot list models — is Ollama running?' });
    }
    return;
  }

  // ── POST /pull-model ──
  if (req.method === 'POST' && url.pathname === '/pull-model') {
    const body = await readBody(req);
    const model = body.model || OLLAMA_MODEL;
    const result = await pullOllamaModel(model);
    json(res, 200, result);
    return;
  }

  // ── POST /configure-opencode ──
  if (req.method === 'POST' && url.pathname === '/configure-opencode') {
    const result = configureOpenCode();
    json(res, 200, result);
    return;
  }

  // ── POST /run ──
  // Body: { command, cwd?, timeout?, scope?: 'selected_folder'|'whole_computer', userId?, reason? }
  // Returns extra fields: level (safe_readonly | safe_project_write | needs_confirmation | blocked),
  // needsConfirmation (true when level=needs_confirmation), granted (false when blocked).
  if (req.method === 'POST' && url.pathname === '/run') {
    const body = await readBody(req);
    const command = body.command || body.raw;
    if (!command || typeof command !== 'string') {
      json(res, 400, { ok: false, error: 'command required (string, in JSON body)' });
      return;
    }

    const classification = classifyCommand(command);

    // Permission gates — require userId + scope so we can enforce grants.
    const scope = body.scope || 'selected_folder';
    const userId = body.userId || null;
    if (!userId) {
      json(res, 401, { ok: false, error: 'userId required for /run', level: classification.level });
      return;
    }
    const grant = getGrant(userId);

    if (scope === 'whole_computer') {
      if (!grant?.wholeComputerTerminal) {
        json(res, 403, {
          ok: false, error: 'whole_computer_terminal permission not granted',
          level: classification.level, requiresGrant: 'wholeComputerTerminal',
        });
        return;
      }
    } else {
      // selected_folder / default
      if (!grant?.selectedFolderPath) {
        json(res, 403, {
          ok: false, error: 'selected folder not registered',
          level: classification.level, requiresGrant: 'selectedFolderTerminal',
        });
        return;
      }
      if (!grant?.selectedFolderTerminal) {
        json(res, 403, {
          ok: false, error: 'terminal access inside selected folder not granted',
          level: classification.level, requiresGrant: 'selectedFolderTerminal',
        });
        return;
      }
    }

    // Refuse hard-blocked commands even with whole-computer consent.
    if (classification.level === 'blocked') {
      json(res, 403, {
        ok: false, granted: false, error: `Command blocked for safety: ${classification.reason}`,
        level: classification.level,
      });
      return;
    }

    // Only auto-execute safe_readonly / safe_project_write; the frontend
    // must ECHO a confirmable needs_confirmation token via header or by
    // sending confirm=true in the body (server treats that as proof the
    // user has clicked through a UI gate).
    if (classification.level === 'needs_confirmation' && body.confirm !== true) {
      json(res, 409, {
        ok: false, needsConfirmation: true, level: classification.level,
        reason: classification.reason,
        commandPreview: command.slice(0, 240),
        hint: 'Re-send with confirm:true after the user clicks through the safety prompt.',
      });
      return;
    }

    let cwd;
    if (scope === 'whole_computer') {
      cwd = body.cwd ? resolve(body.cwd) : HOME;
    } else {
      cwd = resolve(body.cwd || grant.selectedFolderPath);
      // Sanity-check: refuse if cwd escapes the approved folder.
      const approved = resolve(grant.selectedFolderPath);
      if (!cwd.startsWith(approved)) {
        json(res, 403, {
          ok: false, error: 'cwd escapes approved selected folder',
          approved, requested: cwd, level: classification.level,
        });
        return;
      }
    }
    if (!existsSync(cwd)) {
      json(res, 400, { ok: false, error: `cwd does not exist: ${cwd}`, level: classification.level, cwd });
      return;
    }

    const startedAt = Date.now();
    const timeout = Math.min(body.timeout || 300, 900);
    const result = await runCommand(command, cwd, timeout * 1000);
    result.cwd = cwd;
    result.command = command;
    result.level = classification.level;
    result.durationMs = Date.now() - startedAt;
    json(res, 200, { ok: result.ok, ...result });
    return;
  }

  // ── POST /select-folder (native picker per OS) ──
  if (req.method === 'POST' && url.pathname === '/select-folder') {
    let pickerCmd;
    if (OS === 'darwin') {
      // AppleScript choose folder — returns POSIX path of selected folder.
      pickerCmd = `osascript -e 'set theFolder to choose folder with prompt "Select a folder for Beatrice"' -e 'POSIX path of theFolder' 2>/dev/null`;
    } else if (OS === 'linux') {
      // Try zenity first, then kdialog, then xdg-portal fallback.
      pickerCmd = `(command -v zenity >/dev/null && zenity --file-selection --directory --title="Select a folder for Beatrice" 2>/dev/null) || (command -v kdialog >/dev/null && kdialog --getexistingdirectory "$HOME" 2>/dev/null) || echo ""`;
    } else if (OS === 'win32') {
      // PowerShell FolderBrowserDialog — much slower but native.
      pickerCmd = `powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Select a folder for Beatrice'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"`;
    } else {
      json(res, 400, { ok: false, error: `Native picker not supported on ${OS}. Use POST /validate-path instead.` });
      return;
    }
    try {
      const r = await runCommand(pickerCmd, HOME, 120_000);
      const raw = (r.stdout || '').trim();
      if (!raw) {
        json(res, 200, { ok: false, cancelled: true, message: 'User cancelled picker' });
        return;
      }
      const abs = resolve(raw.replace(/\\$/, ''));
      // Validate exists + is directory
      if (!existsSync(abs)) {
        json(res, 200, { ok: false, error: `Selected path does not exist: ${abs}`, absolutePath: abs });
        return;
      }
      const statOut = execSync(`stat -c '%F' "${abs}" 2>/dev/null || stat -f '%HT' "${abs}" 2>/dev/null || echo ""`, { encoding: 'utf8', timeout: 5_000 }).trim().toLowerCase();
      const isDir = statOut.includes('directory') || statOut === '';
      const name = abs.split(/[\\/]/).filter(Boolean).pop() || abs;
      json(res, 200, {
        ok: true,
        name,
        absolutePath: abs,
        isDirectory: isDir,
        permissionScope: 'selected_folder',
      });
    } catch (e) {
      json(res, 500, { ok: false, error: 'Native picker failed', detail: e?.message });
    }
    return;
  }

  // ── POST /validate-path ──
  // Body: { path }
  if (req.method === 'POST' && url.pathname === '/validate-path') {
    const body = await readBody(req);
    const raw = body.path;
    if (!raw || typeof raw !== 'string') {
      json(res, 400, { ok: false, error: 'path required (string, in JSON body)' });
      return;
    }
    const abs = resolve(raw);
    let exists = false;
    let isDirectory = false;
    let size = null;
    try {
      const s = execSync(`stat -c '%F %s' "${abs}" 2>/dev/null || stat -f '%HT %z' "${abs}" 2>/dev/null || echo ""`, { encoding: 'utf8', timeout: 5_000 }).trim();
      if (s) {
        exists = true;
        isDirectory = s.toLowerCase().startsWith('directory');
        const parts = s.split(/\s+/);
        const n = Number(parts[1]);
        if (Number.isFinite(n)) size = n;
      }
    } catch {
      exists = false;
    }
    json(res, 200, {
      ok: true,
      absolutePath: abs,
      exists,
      isDirectory,
      size,
      name: abs.split(/[\\/]/).filter(Boolean).pop() || abs,
    });
    return;
  }

  // ── GET /tools/status ──
  // Returns full env inspection for the UI panel.
  if (req.method === 'GET' && url.pathname === '/tools/status') {
    const node = checkNodeVersion();
    const opencode = checkOpenCode();
    const ollama = checkOllama();
    let ollamaModels = [];
    if (ollama.running) {
      try {
        const list = execSync('ollama list 2>&1', { encoding: 'utf8', timeout: 10_000 });
        ollamaModels = list.split('\n').slice(1).map(line => line.split(/\s+/)[0]).filter(Boolean);
      } catch { /* ollama not running */ }
    }
    function probe(label) {
      try {
        const v = execSync(`command -v ${label} 2>/dev/null || which ${label} 2>/dev/null || echo ""`, { encoding: 'utf8', timeout: 4_000 }).trim();
        return !!v;
      } catch { return false; }
    }
    json(res, 200, {
      ok: true,
      platform: OS,
      home: HOME,
      node,
      opencode,
      ollama,
      ollamaModels,
      homebrew: probe('brew'),
      git: probe('git'),
      pnpm: probe('pnpm'),
      npm: probe('npm'),
      curl: probe('curl'),
      python3: probe('python3'),
      opencodeVersion: opencode.installed ? opencode.version : null,
      primaryModel: ollamaModels.find(m => m === OLLAMA_MODEL) || ollamaModels[0] || null,
    });
    return;
  }

  // ── POST /tools/install-opencode ──
  if (req.method === 'POST' && url.pathname === '/tools/install-opencode') {
    const result = await installOpenCodeCLI();
    const cfg = configureOpenCode();
    json(res, 200, { ...result, opencodeConfig: cfg });
    return;
  }

  // ── POST /tools/install-ollama ──
  if (req.method === 'POST' && url.pathname === '/tools/install-ollama') {
    const result = await installOllama();
    json(res, 200, result);
    return;
  }

  // ── POST /tools/pull-ollama-model ──
  // Body: { model? }
  if (req.method === 'POST' && url.pathname === '/tools/pull-ollama-model') {
    const body = await readBody(req);
    const model = body.model || OLLAMA_MODEL;
    const result = await pullOllamaModel(model);
    json(res, 200, result);
    return;
  }

  // ── POST /opencode/run ──
  // Body: { taskPrompt, cwd?, model?, scope?: 'selected_folder'|'whole_computer', userId?, timeout? }
  // Executes `opencode run "<taskPrompt>"` (or `opencode --model <m> run`) inside the approved scope,
  // captures stdout/stderr, returns the structured result.
  if (req.method === 'POST' && url.pathname === '/opencode/run') {
    const body = await readBody(req);
    const taskPrompt = body.taskPrompt;
    const scope = body.scope || 'selected_folder';
    const userId = body.userId || null;
    if (!taskPrompt || typeof taskPrompt !== 'string') {
      json(res, 400, { ok: false, error: 'taskPrompt required (string)' });
      return;
    }
    if (!userId) {
      json(res, 401, { ok: false, error: 'userId required for /opencode/run' });
      return;
    }

    // Permission gate (same model as /run)
    const grant = getGrant(userId);
    if (scope === 'whole_computer' && !grant?.wholeComputerTerminal) {
      json(res, 403, { ok: false, error: 'whole_computer_terminal permission required for OpenCode scope' });
      return;
    }
    if (scope !== 'whole_computer' && !grant?.selectedFolderPath) {
      json(res, 403, { ok: false, error: 'selected folder not registered' });
      return;
    }

    // Tool availability pre-check
    const oc = checkOpenCode();
    if (!oc.installed) {
      json(res, 412, {
        ok: false,
        error: 'OpenCode is not installed on this machine',
        remediation: 'POST /tools/install-opencode',
      });
      return;
    }

    let cwd;
    if (scope === 'whole_computer') {
      cwd = body.cwd ? resolve(body.cwd) : HOME;
    } else {
      cwd = resolve(body.cwd || grant.selectedFolderPath);
      const approved = resolve(grant.selectedFolderPath);
      if (!cwd.startsWith(approved)) {
        json(res, 403, { ok: false, error: 'cwd escapes approved selected folder' });
        return;
      }
    }
    if (!existsSync(cwd)) {
      json(res, 400, { ok: false, error: `cwd does not exist: ${cwd}` });
      return;
    }

    // Build the opencode command — escape the prompt for shell safety.
    //
    // Two injection vectors are explicitly closed:
    // 1. `body.model` is validated against /^[A-Za-z0-9._:@/+-]{1,64}$/ — no shell metacharacters.
    // 2. `taskPrompt` is sanitized by refusing command-substitution tokens (`$(`, backticks),
    //    heredocs (`<<`), and output redirects (`>`, `<`). Any match returns 400.
    // The remaining flat text is then single-quote escaped before being interpolated.
    if (typeof body.model === 'string' && body.model.length > 0 &&
        !/^[A-Za-z0-9._:@/+-]{1,64}$/.test(body.model)) {
      json(res, 400, {
        ok: false, error: 'model must match /^[A-Za-z0-9._:@/+-]{1,64}$/ (no shell metacharacters)',
      });
      return;
    }
    if (/[`]|\$\(|<<|>|<\s|&|\|/.test(taskPrompt)) {
      json(res, 400, {
        ok: false,
        error: 'taskPrompt contains shell metacharacters (`` ` ``, $( ), <<, >, <, &, |). Refusing to execute.',
        hint: 'Pass the prompt in plain text; do not include shell substitution or redirection.',
      });
      return;
    }
    const escapedPrompt = taskPrompt.replace(/'/g, "'\\''");
    let cmd;
    if (body.model) {
      cmd = `opencode --model ${body.model} run '${escapedPrompt}'`;
    } else {
      cmd = `opencode run '${escapedPrompt}'`;
    }
    const startedAt = Date.now();
    const timeout = Math.min(body.timeout || 600, 1800) * 1000; // 10 min default, 30 min cap
    const result = await runCommand(cmd, cwd, timeout);
    json(res, 200, {
      ok: result.ok,
      cwd,
      command: cmd,
      level: 'safe_project_write',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      error: result.error,
    });
    return;
  }

  // ── GET /permissions ── ?userId=xxx ──
  if (req.method === 'GET' && url.pathname === '/permissions') {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      json(res, 400, { ok: false, error: 'userId query param required' });
      return;
    }
    json(res, 200, { ok: true, userId, grant: getGrant(userId) || null });
    return;
  }

  // ── POST /permissions/grant ──
  // Body: { userId, selectedFolderPath?, selectedFolderReadWrite?, selectedFolderTerminal?, wholeComputerTerminal? }
  if (req.method === 'POST' && url.pathname === '/permissions/grant') {
    const body = await readBody(req);
    if (!body.userId) {
      json(res, 400, { ok: false, error: 'userId required' });
      return;
    }
    const grant = setGrant(body.userId, {
      selectedFolderPath: body.selectedFolderPath ?? getGrant(body.userId)?.selectedFolderPath,
      selectedFolderReadWrite: body.selectedFolderReadWrite ?? true,
      selectedFolderTerminal: body.selectedFolderTerminal ?? !!body.selectedFolderPath,
      wholeComputerTerminal: body.wholeComputerTerminal ?? false,
    });
    json(res, 200, { ok: true, grant });
    return;
  }

  // ── POST /permissions/revoke ──
  // Body: { userId, scope: 'selected_folder'|'whole_computer'|'all' }
  if (req.method === 'POST' && url.pathname === '/permissions/revoke') {
    const body = await readBody(req);
    if (!body.userId) {
      json(res, 400, { ok: false, error: 'userId required' });
      return;
    }
    if (!body.scope || body.scope === 'all') {
      deleteGrant(body.userId);
      json(res, 200, { ok: true, message: 'All grant scopes revoked' });
      return;
    }
    const prev = getGrant(body.userId);
    if (!prev) {
      json(res, 200, { ok: true, grant: null, message: 'No grant to revoke' });
      return;
    }
    if (body.scope === 'selected_folder') {
      setGrant(body.userId, { selectedFolderPath: null, selectedFolderTerminal: false });
    } else if (body.scope === 'whole_computer') {
      setGrant(body.userId, { wholeComputerTerminal: false });
    }
    json(res, 200, { ok: true, grant: getGrant(body.userId) });
    return;
  }

  // ── GET /platform ──
  if (req.method === 'GET' && url.pathname === '/platform') {
    json(res, 200, { ok: true, platform: OS, home: HOME, tmpdir: process.env.TMPDIR || '/tmp' });
    return;
  }

  json(res, 404, { ok: false, error: `Unknown endpoint: ${req.method} ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[beatrice-daemon] v2.0.0 listening on http://127.0.0.1:${PORT}\n`);
  process.stdout.write(`[beatrice-daemon] Platform: ${OS}  Home: ${HOME}\n`);
  process.stdout.write(`[beatrice-daemon] Endpoints:\n`);
  process.stdout.write(`  GET  /health          — daemon liveness\n`);
  process.stdout.write(`  GET  /setup-status    — full stack status (Node, OpenCode, Ollama, model)\n`);
  process.stdout.write(`  POST /setup           — one-shot full workspace setup\n`);
  process.stdout.write(`  GET  /opencode        — check OpenCode installation\n`);
  process.stdout.write(`  POST /install-opencode — install OpenCode CLI\n`);
  process.stdout.write(`  GET  /ollama          — check Ollama installation\n`);
  process.stdout.write(`  POST /install-ollama   — install Ollama\n`);
  process.stdout.write(`  GET  /ollama-models    — list pulled models\n`);
  process.stdout.write(`  POST /pull-model       — pull an Ollama model\n`);
  process.stdout.write(`  POST /configure-opencode — set OpenCode to use Ollama model + Zen fallbacks\n`);
process.stdout.write(`  POST /run              — execute terminal command (scope-gated)\n`);
process.stdout.write(`  POST /select-folder    — native folder picker (Returns absolute path)\n`);
process.stdout.write(`  POST /validate-path    — validate { path } exists + is-directory\n`);
process.stdout.write(`  GET  /tools/status     — full env: node/opencode/ollama/homebrew/git/pnpm\n`);
process.stdout.write(`  POST /tools/install-opencode — install + auto-configure OpenCode CLI\n`);
process.stdout.write(`  POST /tools/install-ollama   — install + start Ollama\n`);
process.stdout.write(`  POST /tools/pull-ollama-model — { model? }\n`);
process.stdout.write(`  POST /opencode/run     — delegated opencode run (scope-gated)\n`);
process.stdout.write(`  GET  /permissions?userId=xxx — fetch grant\n`);
process.stdout.write(`  POST /permissions/grant   — { userId, selectedFolderPath?, ... }\n`);
process.stdout.write(`  POST /permissions/revoke  — { userId, scope }\n`);
process.stdout.write(`  GET  /platform         — OS details\n`);
});
