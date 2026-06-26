// src/lib/commandClassifier.ts
//
// Client-side safety gate that mirrors classifyCommand() in
// public/beatrice-local-daemon.mjs. The agent tool callers use this to
// pre-classify commands and decide whether to ECHO a "needs_confirmation"
// confirmation card to the user BEFORE hitting the daemon. The daemon
// re-runs the same classifier so this is a UX hint, not a bypass.
//
// Safety levels (ordered by trust):
//   safe_readonly       — visible inspection only, auto-run
//   safe_project_write  — modifies files inside the approved scope, auto-run
//   needs_confirmation  — UI gate MUST appear before re-send with confirm:true
//   blocked             — refuse even with whole-computer consent
//
// Patterns are case-insensitive; the daemon uses identical patterns so a
// drift between the two classifiers is a regression bug.

export type CommandLevel =
  | 'safe_readonly'
  | 'safe_project_write'
  | 'needs_confirmation'
  | 'blocked';

export interface CommandClassification {
  level: CommandLevel;
  reason: string;
  matchedPattern?: string;
}

const NEEDS_CONFIRMATION: RegExp[] = [
  /\brm\b(?!\s+-[^\s]*\s+\/)/i,
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
  /\bdelete\s+from\b[^\n]*\b(?!where\b)/i,
  /\bcurl\b[^\n]*\|\s*(bash|sh|zsh)\b/i,
  /\bvercel\b[^\n]*--prod\b/i,
  /\brailway\s+up\b/i,
  /\bfly\s+deploy\b/i,
  /\bgcloud\s+run\s+deploy\b/i,
  /\baws\b[^\n]*\b(delete|terminate|destroy)\b/i,
];

const BLOCKED: RegExp[] = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\s+rm\s+-rf\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:(){ :\|:& };:/,
  /\bchmod\s+777\s+\//i,
];

const SAFE_READONLY: RegExp[] = [
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

export function classifyCommand(command: string): CommandClassification {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { level: 'blocked', reason: 'empty command' };
  }
  for (const re of BLOCKED) {
    if (re.test(command)) {
      return { level: 'blocked', reason: 'dangerous pattern', matchedPattern: re.toString() };
    }
  }
  for (const re of NEEDS_CONFIRMATION) {
    if (re.test(command)) {
      return { level: 'needs_confirmation', reason: 'high-risk pattern', matchedPattern: re.toString() };
    }
  }
  for (const re of SAFE_READONLY) {
    if (re.test(command)) {
      return { level: 'safe_readonly', reason: 'read-only inspection' };
    }
  }
  return { level: 'safe_project_write', reason: 'not matched by block or confirm lists' };
}

// Redact obvious secret values (API keys, tokens, passwords) from a stream
// of output before showing it back to the user. Best-effort only.
const SECRET_PREFIXES = [
  /sk-[A-Za-z0-9_-]{20,}/g,            // OpenAI-style keys
  /ghp_[A-Za-z0-9]{20,}/g,             // GitHub PAT
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,     // Slack tokens
  /AIza[A-Za-z0-9_-]{30,}/g,           // Google API keys
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /password\s*[:=]\s*[^\s]+/gi,
  /secret\s*[:=]\s*[^\s]+/gi,
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of SECRET_PREFIXES) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}
