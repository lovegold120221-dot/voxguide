#!/usr/bin/env node
/**
 * Beatrice Skills Installer — Smoke Test
 *
 * Hits `/api/skills/{caps,install}` against a running Beatrice backend
 * (default `http://127.0.0.1:4300`, override with `SMOKE_URL=https://beatrice.eburon.ai`)
 * and verifies:
 *
 *   1. `GET  /api/skills/caps` returns the expected shape and allowlist.
 *   2. `POST /api/skills/install` rejects an unknown slug with a 400 echoing
 *      the allowlist (defense-in-depth: never silently install arbitrary skill packs).
 *   3. `POST /api/skills/install` for slug='gstack' returns the canonical
 *      response shape consumed by `local_install_skill_pack` in
 *      `src/components/BeatriceAgent.tsx`:
 *         { ok: true, slug, repo, installPath, stdoutTail, durationMs, nextSteps }
 *   4. Same shape check for slug='openmontage-video'.
 *
 * Optional disk verification:
 *   Set `SMOKE_VERIFY_DISK=1` to additionally assert that
 *   `$installPath/.git` and `$installPath/README.md` exist on the test host.
 *   (Only meaningful when the smoke host = server host, i.e. SMOKE_URL is
 *   loopback. Use `SMOKE_SKIP_INSTALL=1` to run the shape/rejection tests
 *   without actually cloning anything.)
 *
 * Sample usage:
 *   npm run smoke:skills-install
 *   SMOKE_URL=https://beatrice.eburon.ai npm run smoke:skills-install
 *   SMOKE_SKIP_INSTALL=1 npm run smoke:skills-install              # caps + 400 only
 *   SMOKE_VERIFY_DISK=1 SMOKE_URL=http://127.0.0.1:4300 npm run smoke:skills-install
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { URL } from 'node:url';

const BASE_URL = process.env.SMOKE_URL || 'http://127.0.0.1:4300';
const VERIFY_DISK = process.env.SMOKE_VERIFY_DISK === '1';
const SKIP_INSTALL = process.env.SMOKE_SKIP_INSTALL === '1';

const ALLOWLIST = ['gstack', 'openmontage-video'];
const EXPECTED_REPO = {
  'gstack': 'https://github.com/garrytan/gstack.git',
  'openmontage-video': 'https://github.com/calesthio/OpenMontage.git',
};

const results = [];
function record(name, ok, detail, opts = {}) {
  results.push({ name, ok, detail, skip: Boolean(opts.skip) });
}

function request(method, pathname, body, timeoutMs = 180_000) {
  const u = new URL(`${BASE_URL}${pathname}`);
  const isHttps = u.protocol === 'https:';
  const opts = {
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: (u.pathname || '/') + (u.search || ''),
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Beatrice-SmokeSkills/1.0',
    },
    timeout: timeoutMs,
  };
  return new Promise((resolve, reject) => {
    const transport = isHttps ? https : http;
    const req = transport.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms on ${method} ${pathname}`));
    });
    if (body !== undefined && body !== null) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }
    req.end();
  });
}

async function main() {
  console.log(`\n🔍 Skills-Installer Smoke Test — ${BASE_URL}\n`);

  // 1. GET /api/skills/caps
  try {
    const res = await request('GET', '/api/skills/caps', undefined, 10_000);
    const data = res.body || {};
    const hasAllowlist = Array.isArray(data.allowlist) && data.allowlist.includes('gstack') && data.allowlist.includes('openmontage-video');
    const hasInstalled = data.installed && typeof data.installed === 'object';
    const shapeOk = res.status === 200 && data.ok === true && hasAllowlist && hasInstalled && typeof data.ready === 'boolean';
    record(
      'GET /api/skills/caps',
      shapeOk,
      shapeOk
        ? `allowlist=[${data.allowlist.join(',')}], ready=${data.ready}, installed.binaries=${Object.keys(data.installed).join(',')}`
        : `status=${res.status}, body=${JSON.stringify(data).slice(0, 240)}`
    );
  } catch (e) {
    record('GET /api/skills/caps', false, e.message || String(e));
  }

  // 2. POST install unknown slug — must 400 with allowlist
  try {
    const res = await request('POST', '/api/skills/install', { slug: 'evil-not-in-allowlist' }, 10_000);
    const data = res.body || {};
    const echoedAllowlist = Array.isArray(data.allowlist) && data.allowlist.includes('gstack') && data.allowlist.includes('openmontage-video');
    const rejected = res.status === 400 && data.ok === false && echoedAllowlist;
    record(
      'POST /api/skills/install {slug:"evil"} \u2192 400',
      rejected,
      rejected ? 'rejected with allowlist echo' : `status=${res.status}, body=${JSON.stringify(data).slice(0, 240)}`
    );
  } catch (e) {
    record('POST /api/skills/install {slug:"evil"} \u2192 400', false, e.message || String(e));
  }

  // 3. POST install gstack + openmontage-video
  for (const slug of ALLOWLIST) {
    if (SKIP_INSTALL) {
      record(`POST /api/skills/install {slug:"${slug}"}`, false, 'SMOKE_SKIP_INSTALL=1 (skipped)', { skip: true });
      continue;
    }
    try {
      const t0 = Date.now();
      const res = await request('POST', '/api/skills/install', { slug }, 180_000);
      const wallMs = Date.now() - t0;
      const data = res.body || {};
      const fieldsOk =
        res.status === 200 &&
        data.ok === true &&
        data.slug === slug &&
        data.repo === EXPECTED_REPO[slug] &&
        typeof data.installPath === 'string' && data.installPath.startsWith('/') &&
        typeof data.stdoutTail === 'string' &&
        Number.isFinite(data.durationMs) &&
        typeof data.nextSteps === 'string';
      const wallOk = Number.isFinite(data.durationMs) ? Math.abs(wallMs - data.durationMs) < 60_000 : true;
      const okShape = fieldsOk && wallOk;
      record(
        `POST /api/skills/install {slug:"${slug}"}`,
        okShape,
        okShape
          ? `\u2192 ${data.installPath} (server reported ${data.durationMs}ms / wall ${wallMs}ms)`
          : `status=${res.status}, wall=${wallMs}ms, fields=${JSON.stringify({
              ok: data.ok, slug: data.slug, repo: data.repo,
              installPathStartsWithSlash: typeof data.installPath === 'string' && data.installPath.startsWith('/'),
              stdoutTailType: typeof data.stdoutTail, durationMs: data.durationMs, nextStepsType: typeof data.nextSteps,
            })}`
      );

      // Optional FS verification
      if (okShape && VERIFY_DISK && typeof data.installPath === 'string') {
        try {
          const hasGit = fs.existsSync(`${data.installPath}/.git`);
          record(`  fs.exists ${data.installPath}/.git`, hasGit, hasGit ? 'yes' : 'no');
        } catch (e) {
          record(`  fs.exists ${data.installPath}/.git`, false, e.message || String(e));
        }
        try {
          const hasReadme = fs.existsSync(`${data.installPath}/README.md`);
          record(`  fs.exists ${data.installPath}/README.md`, hasReadme, hasReadme ? 'yes' : 'no');
        } catch (e) {
          record(`  fs.exists ${data.installPath}/README.md`, false, e.message || String(e));
        }
      }
    } catch (e) {
      record(`POST /api/skills/install {slug:"${slug}"}`, false, e.message || String(e));
    }
  }

  // Summary
  let passed = 0, failed = 0;
  for (const r of results) {
    if (r.skip) { console.log(`  \u23ed  ${r.name}\u2014${r.detail}`); continue; }
    if (r.ok) { passed++; console.log(`  \u2705 ${r.name}\u2014${r.detail}`); }
    else { failed++; console.log(`  \u274c ${r.name}\u2014${r.detail}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e && e.message ? e.message : e);
  process.exit(2);
});
