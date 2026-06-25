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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  if (req.method === 'POST' && url.pathname === '/run') {
    const body = await readBody(req);
    const command = body.command || body.raw;
    if (!command || typeof command !== 'string') {
      json(res, 400, { ok: false, error: 'command required (string, in JSON body)' });
      return;
    }
    if (/(^|\s)(rm\s+-rf\s+\/|sudo\s+rm|mkfs\.|dd\s+if=)/i.test(command)) {
      json(res, 403, { ok: false, error: 'Command blocked for safety' });
      return;
    }
    const cwd = resolve(body.cwd || HOME);
    const timeout = Math.min(body.timeout || 300, 900);
    const result = await runCommand(command, cwd, timeout * 1000);
    result.cwd = cwd;
    json(res, 200, result);
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
  process.stdout.write(`  POST /run              — execute terminal command\n`);
  process.stdout.write(`  GET  /platform         — OS details\n`);
});
