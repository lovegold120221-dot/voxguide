/**
 * CodingAgentRunner — generic multi-provider backend execution layer.
 *
 * Providers are selected server-side only. The frontend never sees which
 * provider, CLI, model, or backend tool is used. All user-visible errors
 * are generic ("The workspace assistant could not complete the task.").
 *
 * Supported providers (env-configured, server-side only):
 *   - opencode  →  opencode run --model <model> --dir <cwd> --dangerously-skip-permissions <prompt>
 *   - gemini    →  gemini -p <prompt>   (headless Gemini CLI)
 *   - freebuff  →  experimental until headless mode confirmed
 *   - codebuff  →  experimental until headless mode confirmed
 *
 * Safety gates:
 *   - permission checks (permissionMode: 'trusted' | 'confirm' | 'sandbox')
 *   - command classifier (blocks destructive commands)
 *   - secret redaction (scrubs API keys, tokens from output)
 *   - timeout handling (per-provider, sliced across fallback chain)
 *   - workspace scope validation (cwd must be inside allowed root)
 */

import { execSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────

export type CodingAgentProvider = 'opencode' | 'gemini' | 'freebuff' | 'codebuff';

export type PermissionMode = 'trusted' | 'confirm' | 'sandbox';

export interface CodingAgentRequest {
  agent?: CodingAgentProvider;
  taskPrompt: string;
  cwd?: string;
  model?: string;
  scope?: string;
  timeout?: number;
  permissionMode?: PermissionMode;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
  skill?: string;
}

export interface CodingAgentResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  fallback?: boolean;
  error?: string;
  appUrl?: string;
  appWorkspace?: string;
  /** Internal-only: which provider actually ran. Never sent to frontend. */
  _provider?: CodingAgentProvider;
  /** Internal-only: which model was used. Never sent to frontend. */
  _model?: string;
}

export interface CodingAgentStatus {
  ok: boolean;
  defaultProvider: CodingAgentProvider;
  providers: Record<CodingAgentProvider, {
    available: boolean;
    path: string;
    version: string | null;
  }>;
}

// ── Provider config (env-driven, server-side only) ─────────────

const DEFAULT_PROVIDER: CodingAgentProvider =
  (process.env.CODING_AGENT_DEFAULT as CodingAgentProvider) || 'opencode';

// Freebuff and Codebuff are the same tool from CodebuffAI.
// Freebuff = free ad-supported version, Codebuff = paid version.
// They share the same CLI binary — FREEBUFF_PATH is the canonical path,
// CODEBUFF_PATH is an alias for the paid version if installed separately.
const FREEBUFF_BINARY = process.env.FREEBUFF_PATH || process.env.CODEBUFF_PATH || 'freebuff';

const PROVIDER_PATHS: Record<CodingAgentProvider, string> = {
  opencode: process.env.OPENCODE_PATH || '/root/.opencode/bin/opencode',
  gemini:   process.env.GEMINI_CLI_PATH || 'gemini',
  freebuff: FREEBUFF_BINARY,
  codebuff: FREEBUFF_BINARY,
};

// OpenCode Zen free-tier model swap chain (server-side only)
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/zenn-ai-large-free';
const OPENCODE_FALLBACK_MODEL = process.env.OPENCODE_FALLBACK_MODEL || 'opencode/deepseek-v4-flash-free';
const OPENCODE_ZEN_CHAIN = (process.env.OPENCODE_ZEN_FREE_MODELS
  || [OPENCODE_MODEL, OPENCODE_FALLBACK_MODEL,
       'opencode/big-pickle',
       'opencode/north-mini-code-free',
       'opencode/mimo-v2.5-free',
       'opencode/nemotron-3-ultra-free',
  ].join(',')
).split(',').map(s => s.trim()).filter(Boolean);

const MAX_OUTPUT = 24_000;

// Patterns that indicate a provider failed due to upstream quota/rate limits
const QUOTA_PATTERNS: RegExp[] = [
  /\b429\b/, /\b402\b/,
  /rate[-_ ]?limit/i, /quota/i, /usage[-_ ]?limit/i, /usage[-_ ]?exceeded/i,
  /out[-_ ]?of[-_ ]?tokens/i, /insufficient[-_ ]?(?:quota|balance|credit)/i,
  /resource[-_ ]?exhaust/i, /too many requests/i, /has been exhausted/i,
  /RESOURCE_EXHAUSTED/,
];

function isQuotaError(stderr: string, stdout: string): boolean {
  const combined = `${stderr || ''}\n${stdout || ''}`;
  return QUOTA_PATTERNS.some(p => p.test(combined));
}

// Slice user timeout across remaining models so quota-storm doesn't blow up
function sliceTimeoutPerModel(userTimeout: number, modelsRemaining: number): number {
  return Math.max(15, Math.floor(userTimeout / Math.max(1, modelsRemaining)));
}

// ── Secret redaction ────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:sk|pk|rk)-[a-zA-Z0-9]{20,}/g,           // API keys
  /ya29\.[a-zA-Z0-9_-]{20,}/g,                 // Google OAuth tokens
  /ghp_[a-zA-Z0-9]{36,}/g,                     // GitHub PATs
  /gho_[a-zA-Z0-9]{36,}/g,                     // GitHub OAuth
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,            // Bearer tokens
  /AIza[a-zA-Z0-9_-]{35}/g,                    // API keys
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ── Destructive command classifier ──────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /(^|\s)(rm\s+-rf\s+\/|sudo\s+rm\s+-rf|mkfs\.|dd\s+if=\/dev\/)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,                  // fork bomb
  /curl\s+.*\|\s*(bash|sh|zsh)\s*$/i,           // pipe-to-shell
];

function isDestructiveCommand(cmd: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
}

// ── Workspace scope validation ──────────────────────────────────

function validateWorkspaceScope(cwd: string, allowedRoot: string): { valid: boolean; error?: string } {
  const resolved = path.resolve(cwd);
  const root = path.resolve(allowedRoot);
  if (!resolved.startsWith(root)) {
    return { valid: false, error: 'Workspace scope violation: target directory is outside the allowed workspace root.' };
  }
  if (!fs.existsSync(resolved)) {
    try { fs.mkdirSync(resolved, { recursive: true }); }
    catch { return { valid: false, error: 'Workspace directory does not exist and could not be created.' }; }
  }
  return { valid: true };
}

// ── Provider availability checks ───────────────────────────────

function checkProviderAvailable(provider: CodingAgentProvider): { available: boolean; path: string; version: string | null } {
  const binPath = PROVIDER_PATHS[provider];
  try {
    // For absolute paths, check file existence; for command names, use which
    if (path.isAbsolute(binPath)) {
      if (!fs.existsSync(binPath)) return { available: false, path: binPath, version: null };
    } else {
      const which = execSync(`which ${binPath} 2>/dev/null || command -v ${binPath} 2>/dev/null || echo ""`, { encoding: 'utf8', timeout: 5_000 }).trim();
      if (!which) return { available: false, path: binPath, version: null };
    }
    const ver = execSync(`"${binPath}" --version 2>&1 || echo "unknown"`, { encoding: 'utf8', timeout: 10_000 }).trim();
    return { available: true, path: binPath, version: ver || 'unknown' };
  } catch {
    return { available: false, path: binPath, version: null };
  }
}

// ── Prompt builder ──────────────────────────────────────────────

function buildPrompt(params: {
  task: string;
  skill?: string;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
}): string {
  const safeTask = String(params.task || '').trim().slice(0, 12_000);
  const safeSkill = String(params.skill || '').trim().slice(0, 80);

  let context = '';
  if (params.workspacePath && params.appName) {
    context = [
      `APP WORKSPACE CONTEXT:`,
      `- You are generating the app "${params.appName}".`,
      `- Save ALL output files to: ${params.workspacePath}/`,
      `- After generation, the app will be served live at: ${params.appUrl}`,
      `- Create a complete standalone app with index.html as the entry point.`,
      `- Use only client-side technologies. No server or build tools.`,
      `- All assets must be inline or use absolute CDN URLs.`,
      `- Create the directory and write files using terminal commands.`,
      ``,
    ].join('\n');
  }

  let promptStr = context ? `${context}\nTASK:\n${safeTask}` : safeTask;
  if (safeSkill) promptStr = `Use the ${safeSkill} skill if it is available, then complete this task:\n\n${promptStr}`;
  return promptStr;
}

// ── Provider executors ──────────────────────────────────────────

function runOpenCode(params: {
  task: string;
  skill?: string;
  timeout: number;
  cwd: string;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
  modelOverride?: string;
  /** Optional emitter for streaming events */
  emitter?: EventEmitter;
  taskId?: string;
}): Promise<CodingAgentResult> {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(params);
    if (!prompt) { reject(new Error('task is required')); return; }

    const binPath = PROVIDER_PATHS.opencode;
    if (!fs.existsSync(binPath)) { reject(new Error('Workspace assistant is not installed.')); return; }

    const model = params.modelOverride || OPENCODE_MODEL;
    const args = ['run', '--model', model, '--dir', params.cwd, '--dangerously-skip-permissions', prompt];
    const child = spawn(binPath, args, {
      cwd: params.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = chunk.toString('utf8');
      const combined = target === 'stdout' ? stdout + next : stderr + next;
      if (combined.length > MAX_OUTPUT) truncated = true;
      const clipped = combined.slice(0, MAX_OUTPUT);
      if (target === 'stdout') stdout = clipped;
      else stderr = clipped;
    };

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      append('stdout', chunk);
      if (params.emitter && params.taskId) {
        params.emitter.emit(`task:${params.taskId}:stdout`, text);
        for (const line of text.split('\n')) {
          const m = line.match(/wrote\s+(.+)|written\s+(?:to\s+)?(.+)|creating\s+(.+)|saved\s+(.+)/i);
          if (m) {
            const fp = m[1] || m[2] || m[3] || m[4];
            if (fp) params.emitter!.emit(`task:${params.taskId}:file_written`, fp.trim());
          }
        }
      }
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      append('stderr', chunk);
      if (params.emitter && params.taskId) {
        params.emitter.emit(`task:${params.taskId}:stderr`, text);
      }
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000).unref();
    }, params.timeout * 1000);

    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      stdout = redactSecrets(stdout);
      stderr = redactSecrets(stderr);
      resolve({
        ok: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        timedOut,
        truncated,
        error: exitCode === 0 && !timedOut ? undefined : (stderr || stdout || 'Execution failed').slice(0, 500),
        _provider: 'opencode',
        _model: model,
      });
    });
  });
}



function runGeminiCLI(params: {
  task: string;
  timeout: number;
  cwd: string;
  model?: string;
}): Promise<CodingAgentResult> {
  return new Promise((resolve, reject) => {
    const prompt = String(params.task || '').trim().slice(0, 12_000);
    if (!prompt) { reject(new Error('task is required')); return; }

    const binPath = PROVIDER_PATHS.gemini;
    // Gemini CLI headless mode flags (from geminicli.com/docs/cli/cli-reference):
    //   -p <prompt>          → non-interactive prompt (forces headless mode)
    //   --approval-mode yolo → auto-approve all tool actions (no confirmation prompts)
    //   --skip-trust         → skip folder trust check (needed for headless)
    //   -m <model>           → model selection (aliases: auto, pro, flash, flash-lite)
    //   -o text              → text output format
    const args = ['-p', prompt, '--approval-mode', 'yolo', '--skip-trust', '-o', 'text'];
    if (params.model) args.push('-m', params.model);

    const child = spawn(binPath, args, {
      cwd: params.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = chunk.toString('utf8');
      const combined = target === 'stdout' ? stdout + next : stderr + next;
      if (combined.length > MAX_OUTPUT) truncated = true;
      const clipped = combined.slice(0, MAX_OUTPUT);
      if (target === 'stdout') stdout = clipped;
      else stderr = clipped;
    };

    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000).unref();
    }, params.timeout * 1000);

    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      stdout = redactSecrets(stdout);
      stderr = redactSecrets(stderr);
      resolve({
        ok: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        timedOut,
        truncated,
        error: exitCode === 0 && !timedOut ? undefined : (stderr || stdout || 'Execution failed').slice(0, 500),
        _provider: 'gemini',
        _model: params.model || 'default',
      });
    });
  });
}

/**
 * Freebuff/Codebuff provider (CodebuffAI).
 * Freebuff is the free ad-supported version; Codebuff is the paid version.
 * Both share the same CLI binary.
 *
 * HEADLESS LIMITATION:
 * The Freebuff/Codebuff CLI is a full TUI (interactive REPL) — it does NOT
 * support headless/non-interactive execution via stdin piping or a -p flag.
 * Piping stdin causes it to hang until timeout.
 *
 * For non-interactive use, Codebuff offers an SDK (@codebuff/sdk) that requires
 * an API key (CODEBUFF_API_KEY). If the SDK + key are available, we use them.
 * Otherwise, we immediately fall back to the OpenCode chain — we do NOT attempt
 * to run the interactive CLI (which would hang for the full timeout).
 *
 * CLI install:  npm install -g freebuff   (or: npm install -g codebuff)
 * SDK install:  npm install @codebuff/sdk
 * SDK docs:     https://www.npmjs.com/package/@codebuff/sdk
 */
async function runFreebuffCodebuff(params: {
  task: string;
  timeout: number;
  cwd: string;
  provider: CodingAgentProvider;
}): Promise<CodingAgentResult> {
  const prompt = String(params.task || '').trim().slice(0, 12_000);
  if (!prompt) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: null,
      timedOut: false, truncated: false,
      error: 'The workspace assistant could not complete the task.',
      _provider: params.provider, _model: 'freebuff',
    };
  }

  // Check if @codebuff/sdk is available + API key is set
  const codebuffApiKey = process.env.CODEBUFF_API_KEY;
  if (codebuffApiKey) {
    try {
      // Dynamic import — @codebuff/sdk is an optional dependency.
      // It's only needed when CODEBUFF_API_KEY is configured.
      // @ts-expect-error - optional dependency, may not be installed
      const sdkModule: any = await import('@codebuff/sdk').catch(() => null);
      if (!sdkModule?.CodebuffClient) throw new Error('SDK not installed');
      const client = new sdkModule.CodebuffClient({
        apiKey: codebuffApiKey,
        cwd: params.cwd,
      });
      const result = await Promise.race([
        client.run({ agent: 'base', prompt }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), params.timeout * 1000)
        ),
      ]);
      const content = typeof result === 'string' ? result : (result as any)?.output || (result as any)?.text || JSON.stringify(result);
      return {
        ok: true,
        stdout: redactSecrets(String(content)),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: String(content).length > MAX_OUTPUT,
        _provider: params.provider,
        _model: 'codebuff-sdk',
      };
    } catch (err: any) {
      console.warn(`[CodingAgent] @codebuff/sdk failed: ${err.message?.slice(0, 100)}`);
      // Fall through to fallback below
    }
  }

  // No SDK or SDK failed — the CLI is interactive-only (TUI), cannot run headless.
  // Immediately return failure so the fallback chain (OpenCode → Cerebras → Ollama)
  // can kick in without wasting the user's timeout budget.
  console.warn(`[CodingAgent] ${params.provider} CLI is interactive-only (no headless mode). Falling back.`);
  return {
    ok: false, stdout: '', stderr: '', exitCode: null,
    timedOut: false, truncated: false,
    error: 'The workspace assistant could not complete the task.',
    _provider: params.provider, _model: 'freebuff',
  };
}

// ── Fallback helpers (internal) ─────────────────────────────────

async function runOllamaFallback(
  params: CodingAgentRequest,
  primary: CodingAgentResult,
  callOllama: (model: string, system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>,
): Promise<CodingAgentResult> {
  const fallbackModel = process.env.OPEN_TERMINAL_FALLBACK_MODEL || 'media-pipe/eburon-sandbox-worker:latest';
  const prompt = buildPrompt({
    task: params.taskPrompt,
    skill: params.skill,
    appName: params.appName,
    workspacePath: params.workspacePath,
    appUrl: params.appUrl,
  });
  const systemPrompt = [
    'You are the local fallback workspace assistant.',
    'Complete the requested task as well as possible from the prompt context.',
    'Be concise, direct, and return only useful final output.',
  ].join('\n');

  try {
    const fallback = await callOllama(fallbackModel, systemPrompt, prompt, Math.min(params.timeout || 60, 180), 1024);
    const content = fallback.content.trim();
    if (!content) throw new Error('Local fallback returned an empty response');
    return {
      ok: true,
      stdout: `${content}\n`,
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      fallback: true,
      _provider: 'opencode' as CodingAgentProvider,
      _model: fallbackModel,
    };
  } catch (err: any) {
    return {
      ...primary,
      error: 'The workspace assistant could not complete the task.',
    };
  }
}

async function runCerebrasFallback(
  params: CodingAgentRequest,
  primary: CodingAgentResult,
  callCerebras: (system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>,
): Promise<CodingAgentResult> {
  const system = [
    'You are the fallback workspace assistant.',
    'Complete the requested coding or terminal-oriented task as well as possible.',
    'Return the output, code, or result the user would expect.',
    'Be concise and direct.',
  ].join('\n');

  try {
    const result = await callCerebras(system, params.taskPrompt, Math.min(params.timeout || 60, 180), 4096);
    const content = result.content.trim();
    if (!content) throw new Error('Fallback returned an empty response');
    return {
      ok: true,
      stdout: `${content}\n`,
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      fallback: true,
      _provider: 'opencode' as CodingAgentProvider,
      _model: 'cerebras',
    };
  } catch {
    return {
      ...primary,
      error: 'The workspace assistant could not complete the task.',
    };
  }
}

// ── Main runner ─────────────────────────────────────────────────

export class CodingAgentRunner extends EventEmitter {
  readonly defaultProvider: CodingAgentProvider = DEFAULT_PROVIDER;
  private allowedRoot: string;
  private callOllama: (model: string, system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>;
  private callCerebras: (system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>;

  constructor(opts: {
    allowedRoot: string;
    callOllama: (model: string, system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>;
    callCerebras: (system: string, prompt: string, timeout: number, maxTokens: number) => Promise<{ content: string }>;
  }) {
    super();
    this.allowedRoot = opts.allowedRoot;
    this.callOllama = opts.callOllama;
    this.callCerebras = opts.callCerebras;
  }

  /** GET /api/coding-agent/status — internal diagnostics only. */
  status(): CodingAgentStatus {
    const providers = {} as CodingAgentStatus['providers'];
    for (const p of ['opencode', 'gemini', 'freebuff', 'codebuff'] as CodingAgentProvider[]) {
      providers[p] = checkProviderAvailable(p);
    }
    return {
      ok: true,
      defaultProvider: this.defaultProvider,
      providers,
    };
  }

  /** POST /api/coding-agent/run — unified execution endpoint. */
  async run(req: CodingAgentRequest): Promise<CodingAgentResult> {
    const safeTimeout = Math.min(Math.max(Number(req.timeout) || 60, 10), 300);
    const safePrompt = String(req.taskPrompt || '').trim();
    if (!safePrompt) {
      return {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false,
        error: 'Task description is required.',
      };
    }

    const cwd = path.resolve(req.cwd || this.allowedRoot);
    const scopeCheck = validateWorkspaceScope(cwd, this.allowedRoot);
    if (!scopeCheck.valid) {
      return {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false,
        error: scopeCheck.error,
      };
    }

    // permissionMode: 'sandbox' blocks destructive commands
    const permMode = req.permissionMode || 'trusted';
    if (permMode === 'sandbox' && isDestructiveCommand(safePrompt)) {
      return {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false,
        error: 'Command blocked for safety.',
      };
    }

    const provider: CodingAgentProvider = req.agent || this.defaultProvider;
    const commonParams = {
      task: safePrompt,
      skill: req.skill,
      timeout: safeTimeout,
      cwd,
      appName: req.appName,
      workspacePath: req.workspacePath,
      appUrl: req.appUrl,
    };

    // ── Dispatch to the selected provider ──
    if (provider === 'opencode') {
      return this.runWithOpenCodeFallback(commonParams);
    } else if (provider === 'gemini') {
      try {
        return await runGeminiCLI({
          task: safePrompt,
          timeout: safeTimeout,
          cwd,
          model: req.model,
        });
      } catch {
        // Gemini failed — try OpenCode fallback chain
        return this.runWithOpenCodeFallback(commonParams);
      }
    } else if (provider === 'freebuff' || provider === 'codebuff') {
      // Freebuff/Codebuff (CodebuffAI) — pipe prompt via stdin for headless execution.
      // If it fails or times out, fall back to the OpenCode chain.
      const result = await runFreebuffCodebuff({
        task: safePrompt,
        timeout: safeTimeout,
        cwd,
        provider,
      });
      if (result.ok) return result;
      return this.runWithOpenCodeFallback(commonParams);
    }

    // Unknown provider — fall back to OpenCode
    return this.runWithOpenCodeFallback(commonParams);
  }

  /**
   * startStreamTask — fire-and-forget streaming execution.
   * Emits events on `this` EventEmitter under namespaced keys:
   *   `task:<taskId>:stdout`      → raw stdout chunk (string)
   *   `task:<taskId>:stderr`      → raw stderr chunk (string)
   *   `task:<taskId>:file_written`→ detected file path (string)
   *   `task:<taskId>:complete`   → final CodingAgentResult
   *
   * The caller (server/index.ts SSE endpoint) subscribes to these events
   * and pushes them to the connected client.
   */
  startStreamTask(req: CodingAgentRequest, taskId: string): void {
    const safeTimeout = Math.min(Math.max(Number(req.timeout) || 60, 10), 300);
    const safePrompt = String(req.taskPrompt || '').trim();
    if (!safePrompt) {
      this.emit(`task:${taskId}:complete`, {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false,
        error: 'The workspace assistant could not complete the task.',
      });
      return;
    }

    const cwd = path.resolve(req.cwd || this.allowedRoot);
    const scopeCheck = validateWorkspaceScope(cwd, this.allowedRoot);
    if (!scopeCheck.valid) {
      this.emit(`task:${taskId}:complete`, {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false,
        error: 'The workspace assistant could not complete the task.',
      });
      return;
    }

    // Run the fallback chain asynchronously, streaming events via `this` emitter
    this.runStreamChain(taskId, safePrompt, req.skill, safeTimeout, cwd, req);
  }

  /**
   * Asynchronous fallback chain for streaming — tries each model in the Zen chain
   * with streaming events, then falls back to Cerebras/Ollama.
   */
  private async runStreamChain(
    taskId: string,
    prompt: string,
    skill: string | undefined,
    timeout: number,
    cwd: string,
    req: CodingAgentRequest,
  ): Promise<void> {
    const chain = OPENCODE_ZEN_CHAIN.length > 0 ? OPENCODE_ZEN_CHAIN : [OPENCODE_MODEL];
    const appName = req.appName;
    const workspacePath = req.workspacePath;
    const appUrl = req.appUrl;
    let lastResult: CodingAgentResult | null = null;
    const triedModels: string[] = [];
    const emit = (event: string, data: any) => this.emit(`task:${taskId}:${event}`, data);

    emit('stdout', `\n[Starting task...]\n`);

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      triedModels.push(model);
      const perModelTimeout = sliceTimeoutPerModel(timeout, chain.length - i);

      emit('stdout', `\n[Using model: ${model}]\n`);

      try {
        const result = await runOpenCode({
          task: prompt,
          skill,
          timeout: perModelTimeout,
          cwd,
          appName,
          workspacePath,
          appUrl,
          modelOverride: model,
          emitter: this,
          taskId,
        });

        if (result.ok) {
          emit('stdout', `\n[Task complete]\n`);
          emit('complete', result);
          return;
        }

        lastResult = result;

        if (!isQuotaError(result.stderr, result.stdout)) {
          // Non-quota error — don't retry with other models
          break;
        }

        emit('stdout', `\n[Model quota exhausted, trying next model...]\n`);
        console.warn(`[CodingAgent] Model ${model} exhausted — swapping to next.`);
      } catch (err: any) {
        console.warn(`[CodingAgent] Model ${model} failed: ${err.message?.slice(0, 100)}`);
        lastResult = {
          ok: false, stdout: '', stderr: String(err.message || ''), exitCode: null,
          timedOut: false, truncated: false,
          error: 'The workspace assistant could not complete the task.',
          _provider: 'opencode', _model: model,
        };
        break;
      }
    }

    // Cerebras fallback
    emit('stdout', `\n[Trying Cerebras fallback...]\n`);
    const cerebrasResult = await runCerebrasFallback(
      { taskPrompt: prompt, skill, timeout, cwd, appName, workspacePath, appUrl },
      lastResult ?? {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false, error: 'No model was attempted.',
      },
      this.callCerebras,
    );
    if (cerebrasResult.ok) {
      emit('stdout', `\n[Task complete]\n`);
      emit('complete', cerebrasResult);
      return;
    }

    // Ollama fallback
    emit('stdout', `\n[Trying Ollama fallback...]\n`);
    const ollamaResult = await runOllamaFallback(
      { taskPrompt: prompt, skill, timeout, cwd, appName, workspacePath, appUrl },
      cerebrasResult,
      this.callOllama,
    );
    if (ollamaResult.ok) {
      emit('stdout', `\n[Task complete]\n`);
      emit('complete', ollamaResult);
      return;
    }

    // Everything failed
    console.warn(`[CodingAgent] All streaming providers exhausted. Tried: ${triedModels.join(', ')}`);
    emit('complete', {
      ...ollamaResult,
      error: 'The workspace assistant could not complete the task.',
    });
  }

  /** OpenCode provider with Zen model swap chain + Cerebras + Ollama fallback. */
  private async runWithOpenCodeFallback(params: {
    task: string;
    skill?: string;
    timeout: number;
    cwd: string;
    appName?: string;
    workspacePath?: string;
    appUrl?: string;
  }): Promise<CodingAgentResult> {
    const chain = OPENCODE_ZEN_CHAIN.length > 0 ? OPENCODE_ZEN_CHAIN : [OPENCODE_MODEL];
    let lastResult: CodingAgentResult | null = null;
    const triedModels: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      triedModels.push(model);
      const perModelTimeout = sliceTimeoutPerModel(params.timeout, chain.length - i);
      try {
        const result = await runOpenCode({
          ...params,
          timeout: perModelTimeout,
          modelOverride: model,
        });
        if (result.ok) return result;
        lastResult = result;
        if (!isQuotaError(result.stderr, result.stdout)) break;
        console.warn(`[CodingAgent] Model ${model} exhausted — swapping to next.`);
      } catch (err: any) {
        console.warn(`[CodingAgent] Model ${model} failed: ${err.message?.slice(0, 100)}`);
        lastResult = {
          ok: false, stdout: '', stderr: String(err.message || ''), exitCode: null,
          timedOut: false, truncated: false,
          error: 'The workspace assistant could not complete the task.',
          _provider: 'opencode', _model: model,
        };
        break;
      }
    }

    // Cerebras fallback
    const cerebrasResult = await runCerebrasFallback(
      { ...params, taskPrompt: params.task },
      lastResult ?? {
        ok: false, stdout: '', stderr: '', exitCode: null,
        timedOut: false, truncated: false, error: 'No model was attempted.',
      },
      this.callCerebras,
    );
    if (cerebrasResult.ok) return cerebrasResult;

    // Ollama fallback
    const ollamaResult = await runOllamaFallback(
      { ...params, taskPrompt: params.task },
      cerebrasResult,
      this.callOllama,
    );
    if (ollamaResult.ok) return ollamaResult;

    // Everything failed — return user-friendly error
    console.warn(`[CodingAgent] All providers exhausted. Tried: ${triedModels.join(', ')}`);
    return {
      ...ollamaResult,
      error: 'The workspace assistant could not complete the task.',
    };
  }
}
