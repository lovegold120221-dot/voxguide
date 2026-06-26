// src/lib/localTerminal.ts
//
// Typed client for the local daemon running on http://127.0.0.1:55420.
// Same surface as the daemon endpoints; every call returns a tagged
// `LocalResult<T>` so the agent tool-callers can branch on network
// errors vs. 403/412 vs. successful data + metadata.
//
// The browser is exempt from mixed-content blocking for localhost, so
// we hit the daemon directly (no need to proxy via /api/).

import type { CommandClassification } from './commandClassifier';

const DEFAULT_DAEMON_PORT = 55420;

export interface LocalResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** When the daemon returned a classification field (e.g. needs_confirmation). */
  level?: CommandClassification['level'];
  needsConfirmation?: boolean;
  requiresGrant?: string;
  cancelled?: boolean;
}

export type LocalScope = 'selected_folder' | 'whole_computer';

export interface SelectFolderResult {
  ok: boolean;
  name?: string;
  absolutePath?: string;
  isDirectory?: boolean;
  permissionScope?: LocalScope;
  cancelled?: boolean;
  error?: string;
}

export interface ValidatePathResult {
  ok: boolean;
  absolutePath: string;
  exists: boolean;
  isDirectory: boolean;
  size?: number | null;
  name?: string;
}

export interface ToolsStatus {
  ok: boolean;
  platform: 'linux' | 'darwin' | 'win32' | string;
  home: string;
  node: { installed: boolean; version: string | null; ok: boolean };
  opencode: { installed: boolean; version: string | null; path: string | null };
  ollama: { installed: boolean; running: boolean; version: string | null };
  ollamaModels: string[];
  homebrew: boolean;
  git: boolean;
  pnpm: boolean;
  npm: boolean;
  curl: boolean;
  python3: boolean;
  opencodeVersion: string | null;
  primaryModel: string | null;
}

export interface PermissionGrant {
  selectedFolderPath?: string | null;
  selectedFolderReadWrite: boolean;
  selectedFolderTerminal: boolean;
  wholeComputerTerminal: boolean;
  approvedAt: string;
  expiresAt?: string | null;
  approvedByUser: boolean;
}

export interface RunResult {
  ok: boolean;
  cwd?: string;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  level?: CommandClassification['level'];
  durationMs?: number;
  error?: string | null;
}

async function call<T = unknown>(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<LocalResult<T>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return {
      ok: res.ok && (data?.ok !== false),
      status: res.status,
      data: data ?? undefined,
      error: data?.error,
      level: data?.level,
      needsConfirmation: data?.needsConfirmation,
      requiresGrant: data?.requiresGrant,
      cancelled: data?.cancelled,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      error: e?.name === 'AbortError' ? `daemon timeout (${timeoutMs}ms)` : (e?.message || 'daemon unreachable'),
    };
  }
}

export function getLocalDaemonBaseUrl(port: number = DEFAULT_DAEMON_PORT): string {
  if (typeof window === 'undefined') return `http://127.0.0.1:${port}`;
  return `http://127.0.0.1:${port}`;
}

// ── Health ──

export async function health(port?: number): Promise<LocalResult<{ ok: true; version: string; platform: string; home: string; daemonPort: number }>> {
  return call(getLocalDaemonBaseUrl(port), 'GET', '/health', undefined, 3_000);
}

// ── Folder picker + path validation ──

export async function selectFolderNative(port?: number): Promise<LocalResult<SelectFolderResult>> {
  return call<SelectFolderResult>(getLocalDaemonBaseUrl(port), 'POST', '/select-folder', {}, 120_000);
}

export async function validatePath(path: string, port?: number): Promise<LocalResult<ValidatePathResult>> {
  return call<ValidatePathResult>(getLocalDaemonBaseUrl(port), 'POST', '/validate-path', { path }, 5_000);
}

// ── Terminal execution (scope-gated) ──

export interface RunArgs {
  command: string;
  cwd?: string;
  timeout?: number;
  scope: LocalScope;
  userId: string;
  reason?: string;
  confirm?: boolean;
}

export async function runCommandInFolder(args: RunArgs, port?: number): Promise<LocalResult<RunResult>> {
  return call<RunResult>(getLocalDaemonBaseUrl(port), 'POST', '/run', args, (args.timeout ?? 300) * 1000 + 5_000);
}

// ── Opencode delegation ──

export interface OpenCodeRunArgs {
  taskPrompt: string;
  cwd?: string;
  model?: string;
  scope: LocalScope;
  userId: string;
  timeout?: number;
}

export async function runOpenCodeTask(args: OpenCodeRunArgs, port?: number): Promise<LocalResult<RunResult>> {
  return call<RunResult>(getLocalDaemonBaseUrl(port), 'POST', '/opencode/run', args, (args.timeout ?? 600) * 1000 + 5_000);
}

// ── Tools status / install ──

export async function getToolsStatus(port?: number): Promise<LocalResult<ToolsStatus>> {
  return call<ToolsStatus>(getLocalDaemonBaseUrl(port), 'GET', '/tools/status', undefined, 10_000);
}

export async function installOpenCode(port?: number): Promise<LocalResult<unknown>> {
  return call(getLocalDaemonBaseUrl(port), 'POST', '/tools/install-opencode', {}, 300_000);
}

export async function installOllama(port?: number): Promise<LocalResult<unknown>> {
  return call(getLocalDaemonBaseUrl(port), 'POST', '/tools/install-ollama', {}, 600_000);
}

export async function pullOllamaModel(model: string, port?: number): Promise<LocalResult<unknown>> {
  return call(getLocalDaemonBaseUrl(port), 'POST', '/tools/pull-ollama-model', { model }, 900_000);
}

// ── Permission grants ──

export async function fetchGrant(userId: string, port?: number): Promise<LocalResult<{ ok: true; userId: string; grant: PermissionGrant | null }>> {
  const r = await call<{ ok: true; userId: string; grant: PermissionGrant | null }>(
    getLocalDaemonBaseUrl(port), 'GET', `/permissions?userId=${encodeURIComponent(userId)}`, undefined, 5_000,
  );
  return r;
}

export interface GrantArgs {
  userId: string;
  selectedFolderPath?: string | null;
  selectedFolderReadWrite?: boolean;
  selectedFolderTerminal?: boolean;
  wholeComputerTerminal?: boolean;
}

export async function grantPermission(args: GrantArgs, port?: number): Promise<LocalResult<{ ok: true; grant: PermissionGrant }>> {
  return call<{ ok: true; grant: PermissionGrant }>(getLocalDaemonBaseUrl(port), 'POST', '/permissions/grant', args, 5_000);
}

export async function revokePermission(
  userId: string,
  scope: 'selected_folder' | 'whole_computer' | 'all',
  port?: number,
): Promise<LocalResult<unknown>> {
  return call(getLocalDaemonBaseUrl(port), 'POST', '/permissions/revoke', { userId, scope }, 5_000);
}
