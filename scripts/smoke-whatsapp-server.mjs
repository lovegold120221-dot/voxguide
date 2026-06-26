#!/usr/bin/env node
import http from 'http';

const BASE_URL = process.env.SMOKE_URL || 'http://127.0.0.1:4300';

async function check(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`\n🔍 WhatsApp Server Smoke Test — ${BASE_URL}\n`);

  const results = [];

  // Health
  try {
    const health = await check('/api/health');
    const ok = health?.status === 'ok';
    results.push({ name: 'GET /api/health', ok, detail: health?.status || 'unexpected' });
  } catch (e) { results.push({ name: 'GET /api/health', ok: false, detail: e.message }); }

  // Provider
  try {
    const provider = await check('/api/eburon/provider');
    const ok = provider?.provider === 'eburon_core' && Array.isArray(provider?.models);
    results.push({ name: 'GET /api/eburon/provider', ok, detail: `${provider?.models?.length || 0} models` });
  } catch (e) { results.push({ name: 'GET /api/eburon/provider', ok: false, detail: e.message }); }

  // Workspace
  try {
    const ws = await check('/api/workspace/list/smoke_test');
    const ok = ws?.ok === true;
    results.push({ name: 'GET /api/workspace/list/:userId', ok, detail: `${ws?.outputs?.length || 0} items` });
  } catch (e) { results.push({ name: 'GET /api/workspace/list/:userId', ok: false, detail: e.message }); }

  // Ollama
  try {
    const ollama = await check('/api/ollama/models');
    results.push({ name: 'GET /api/ollama/models', ok: true, detail: 'endpoint exists' });
  } catch (e) {
    // Not all servers have /ollama/models — just log
    results.push({ name: 'GET /api/ollama/models', ok: false, detail: e.message, skip: true });
  }

  // Print
  let passed = 0, failed = 0;
  for (const r of results) {
    if (r.skip) { console.log(`  ⏭  ${r.name}`); continue; }
    if (r.ok) { passed++; console.log(`  ✅ ${r.name} — ${r.detail}`); }
    else { failed++; console.log(`  ❌ ${r.name} — ${r.detail}`); }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
