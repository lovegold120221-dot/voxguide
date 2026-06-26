#!/usr/bin/env node
/**
 * Beatrice verify pipeline (cross-platform, hardened).
 *
 * Runs in order, fail-fast:
 *   1. `npm run lint`                       (tsc --noEmit)
 *   2. `npm run check:eburon-branding`      (provider/product token scan)
 *   3. `node --check scripts/*.mjs`         (one per script \u2014 .mjs don't go through tsc)
 *   4. `npm run smoke:whatsapp`             (HTTP smoke against `/api/health`, `/api/eburon/provider`, `/api/workspace/list/:userId`)
 *   5. `npm run smoke:skills-install`       (HTTP smoke against `/api/skills/{caps,install}`)
 *
 * Designed to work in CI (where the backend is up) and locally (where running
 * the smoke steps requires `npm run dev:api` in another terminal, or a real
 * VPS reachable via SMOKE_URL). If a smoke step needs to be skipped (no
 * backend in dev), use SMOKE_SKIP_INSTALL=1 to scope the skills-install
 * smoke to caps + 400 only; smoke:whatsapp has no skip-mode by design.
 *
 * Sample usage:
 *   npm run verify
 *   SMOKE_URL=https://whatsapp.eburon.ai npm run verify
 *   SMOKE_SKIP_INSTALL=1 npm run verify      # run smoke:skills-install without actually cloning
 *
 * Hardening notes:
 *   - Uses execFileSync (NOT execSync+shell:true), so paths with spaces in
 *     scripts/*.mjs filenames are safe and no shell parser is involved.
 *   - npm precondition check at startup so minimal CI images fail fast
 *     with a clear error instead of crashing on the first execFileSync call.
 *   - Failure path prints the last 15 lines of err.stderr or err.stdout so
 *     CI triage can see which assertion tripped a step.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function runNpm(args, opts = {}) {
  return execFileSync('npm', args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function runNodeCheck(scriptPath) {
  return execFileSync('node', ['--check', scriptPath], { stdio: 'inherit', cwd: ROOT });
}

function listMjsScripts() {
  const dir = join(ROOT, 'scripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
}

function ensureNpm() {
  try {
    execFileSync('npm', ['--version'], { stdio: 'ignore' });
  } catch {
    console.error('\u274c `npm` is not on PATH. Run `npm install` first or install Node.js 22+ from https://nodejs.org.');
    process.exit(2);
  }
}

const steps = [
  { name: 'lint', run: () => runNpm(['run', 'lint']) },
  { name: 'check:eburon-branding', run: () => runNpm(['run', 'check:eburon-branding']) },
];

for (const file of listMjsScripts()) {
  const abs = join(ROOT, 'scripts', file);
  steps.push({ name: `node --check scripts/${file}`, run: () => runNodeCheck(abs) });
}

steps.push({ name: 'smoke:whatsapp', run: () => runNpm(['run', 'smoke:whatsapp']) });
steps.push({ name: 'smoke:skills-install', run: () => runNpm(['run', 'smoke:skills-install']) });

function tailText(buf) {
  if (!buf) return '';
  return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
}

function runStep(step, i, total) {
  const banner = `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 ${i + 1}/${total} ${step.name} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
  console.log(`\n${banner}\n`);
  try {
    step.run();
  } catch (err) {
    const stderr = err && err.stderr ? tailText(err.stderr).split('\n').slice(-15).join('\n').trim() : '';
    const stdout = err && err.stdout ? tailText(err.stdout).split('\n').slice(-15).join('\n').trim() : '';
    console.error(`\n\u274c verify failed at step ${i + 1}/${total}: ${step.name}`);
    if (stderr) console.error(`--- last 15 stderr lines ---\n${stderr}`);
    if (stdout) console.error(`--- last 15 stdout lines ---\n${stdout}`);
    if (!stderr && !stdout && err && err.message) console.error(err.message);
    process.exit(1);
  }
}

(function main() {
  ensureNpm();
  console.log(`\ud83d\udd0d Beatrice verify: ${steps.length} step(s)`);
  steps.forEach((s, i) => runStep(s, i, steps.length));
  console.log('\n\u2705 verify complete (all steps green)');
})();
