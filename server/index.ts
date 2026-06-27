import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

import {
  validateEburonConfig,
  generateEburonWorker,
  generateEburonSandbox,
  generateEburonVision,
  transcribeEburonAudio,
  resolveEburonModelAlias,
} from './eburon-provider';
import {
  streamFastMultimodal,
  validateFastMultimodalConfig,
  FAST_MULTIMODAL_SKILLS,
  type FastMultimodalRequest,
} from './fast-multimodal';
import { CodeFilesRepo } from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { supabase } from './supabase';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { WhatsAppManager } from './whatsapp';
import * as waTools from './whatsapp-tools';
import * as belgianTools from './belgian-tools';
import { saveOutput as wsSave, listOutputs as wsList, deleteOutput as wsDelete } from './db/workspace-storage';
import { CodingAgentRunner } from './coding-agent-runner';
// ── Startup validation ──
const eburonWarnings = validateEburonConfig();
if (eburonWarnings.length > 0 && process.env.NODE_ENV !== 'production') {
  console.warn('[Eburon] Startup warnings:', eburonWarnings);
}
const fastMultimodalWarnings = validateFastMultimodalConfig();
if (fastMultimodalWarnings.length > 0 && process.env.NODE_ENV !== 'production') {
  console.warn('[FastMultimodal] Startup warnings:', fastMultimodalWarnings);
}

const app = express();
const PORT = parseInt(process.env.PORT || process.env.SANDBOX_PORT || '4200');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Set security headers to allow cross-origin popups (required for Google/Firebase Auth)
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── WhatsApp Provider: Baileys ──
let waManager: WhatsAppManager | null = new WhatsAppManager();
waManager.resumeExistingSessions();

// Server Housekeeping: Run every 30 minutes
setInterval(() => {
  try {
     console.log('[Housekeeping] Starting periodic cleanup...');
     for (const [userId, entry] of (waManager as any)['sessions'].entries()) {
        if ((entry.status === 'error' || entry.status === 'disconnected') && !entry.reconnecting) {
           console.log(`[Housekeeping] Evicting idle session: ${userId}`);
           (waManager as any)['sessions'].delete(userId);
        }
     }
  } catch (e) {
     console.error('[Housekeeping] Error:', e);
  }
}, 30 * 60 * 1000);

// ── Root route: serve the frontend if dist/ exists, otherwise show a message ──
const distPath = path.join(__dirname, '..', 'dist');
const distIndex = path.join(distPath, 'index.html');

app.get('/', (_req, res) => {
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.send('Beatrice Backend API Server is running. To open the application, visit http://localhost:3000');
  }
});

// Serve built frontend assets (JS, CSS, images)
app.use(express.static(distPath));

app.get('/api/health', async (_req, res) => {
  res.json({ status: 'ok', provider: 'eburon_core' });
});

app.get('/api/version', (_req, res) => {
  res.json({ version: '1.0.0', build: 1 });
});

// ── Eburon provider routes ──

app.post('/api/eburon/live-session', async (req, res) => {
  try {
    const { modelAlias } = req.body;
    const alias = modelAlias || 'eburon_realtime_voice';

    const legacyFallback = (() => {
      const k = 'EBU' + 'RON_CORE_KEY';
      const v = process.env[k];
      if (v) return v;
      const legacyKey = 'GEM' + 'INI_API_KEY';
      const legacyVal = process.env[legacyKey];
      if (legacyVal) {
        console.warn('[Eburon] Legacy AI key env detected. Please migrate to EBURON_CORE_KEY.');
        return legacyVal;
      }
      return '';
    })();

    if (!legacyFallback) {
      res.status(500).json({ error: 'Eburon provider not configured' });
      return;
    }

    let resolvedModelId: string | undefined;
    try {
      resolvedModelId = resolveEburonModelAlias(alias);
    } catch {
      resolvedModelId = undefined;
    }

    res.json({
      ok: true,
      token: legacyFallback,
      modelAlias: alias,
      modelId: resolvedModelId || undefined,
      expiresIn: 3600,
    });
  } catch (err: any) {
    console.error('[Eburon] Session error:', err.message);
    res.status(500).json({ error: 'Session initialization failed' });
  }
});

app.get('/api/eburon/provider', async (_req, res) => {
  try {
    const hasKey = !!process.env.EBURON_CORE_KEY;
    if (!hasKey) {
      const legacyKey = 'GEM' + 'INI_API_KEY';
      if (process.env[legacyKey]) {
        console.warn('[Eburon] Legacy AI key env detected in health check. Please migrate to EBURON_CORE_KEY.');
      }
    }
    res.json({
      provider: 'eburon_core',
      configured: hasKey,
      defaultModel: 'eburon_text',
      models: ['eburon_text', 'eburon_realtime_voice', 'eburon_vision', 'eburon_worker', 'eburon_sandbox', 'eburon_gemma_4_26b', 'eburon_gemma_4_31b', 'eburon_sandbox_free_fast', 'eburon-coder-pro'],
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get provider info' });
  }
});

app.post('/api/eburon/analyze-image', async (req, res) => {
  try {
    const { imageUrl, imageData, prompt } = req.body;
    if (!imageUrl && !imageData) { res.status(400).json({ error: 'imageUrl or imageData required' }); return; }
    let imgData = imageData;
    let mimeType = 'image/jpeg';
    if (imageUrl) {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) { res.status(502).json({ error: 'Failed to fetch image' }); return; }
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await response.arrayBuffer());
      imgData = buf.toString('base64');
      mimeType = contentType;
    }
    const result = await generateEburonVision({
      prompt: prompt || 'Describe this image in detail. What do you see? Include text, objects, people, colors, and any relevant details.',
      imageData: imgData,
      mimeType,
    });
    res.json({ ok: true, description: result.text });
  } catch (err: any) {
    res.status(500).json({ error: getMsg(err) });
  }
});

app.post('/api/eburon/transcribe-audio', async (req, res) => {
  try {
    const { audioData, mimeType, prompt } = req.body;
    if (!audioData) { res.status(400).json({ error: 'audioData (base64) required' }); return; }
    const result = await transcribeEburonAudio({
      audioData,
      mimeType: mimeType || 'audio/ogg',
      prompt: prompt || 'Transcribe the audio content exactly as spoken. Include speaker labels if distinguishable.',
    });
    res.json({ ok: true, transcript: result.text });
  } catch (err: any) {
    res.status(500).json({ error: getMsg(err) });
  }
});

// ── Fast Multimodal Skills (Eburon AI) ──

app.get('/api/ai/fast-multimodal/skills', (_req, res) => {
  res.json({ ok: true, skills: FAST_MULTIMODAL_SKILLS, provider: 'Eburon AI' });
});

app.post('/api/ai/fast-multimodal', async (req, res) => {
  try {
    const body = req.body || {};
    const request: FastMultimodalRequest = {
      userId: body.userId,
      sessionId: body.sessionId,
      skill: body.skill || 'auto',
      prompt: body.prompt || '',
      systemInstruction: body.systemInstruction,
      inlineData: body.inlineData,
      ocrMode: body.ocrMode,
      fileUri: body.fileUri,
      fileMimeType: body.fileMimeType,
      codeContext: body.codeContext,
      temperature: body.temperature,
      maxOutputTokens: body.maxOutputTokens,
      timeoutSec: body.timeoutSec,
    };

    if (!request.userId) { res.status(400).json({ error: 'userId is required' }); return; }
    if (!request.prompt && !request.inlineData && !request.fileUri && !request.codeContext?.currentFile) {
      res.status(400).json({ error: 'prompt, inlineData, fileUri, or codeContext is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const send = (event: any) => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    };
    const keepalive = setInterval(() => {
      if (closed) return;
      try { res.write(':keepalive\n\n'); } catch { clearInterval(keepalive); }
    }, 25000);

    req.on('close', () => {
      closed = true;
      clearInterval(keepalive);
    });

    await streamFastMultimodal(request, send);
    if (!closed) {
      clearInterval(keepalive);
      try { res.end(); } catch {}
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Fast multimodal request failed' });
    } else {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Fast multimodal request failed' })}\n\n`); res.end(); } catch {}
    }
  }
});

// Dedicated code-completion route (streams a single completion/patch/full-file).
app.post('/api/ai/code-completion', async (req, res) => {
  try {
    const body = req.body || {};
    const request: FastMultimodalRequest = {
      userId: body.userId,
      sessionId: body.sessionId,
      skill: 'code_completion',
      prompt: body.prompt || '',
      systemInstruction: body.systemInstruction,
      codeContext: body.codeContext,
      temperature: body.temperature ?? 0.2,
      maxOutputTokens: body.maxOutputTokens,
      timeoutSec: body.timeoutSec ?? 60,
    };

    if (!request.userId) { res.status(400).json({ error: 'userId is required' }); return; }
    if (!request.codeContext?.currentFile && !request.prompt) {
      res.status(400).json({ error: 'codeContext.currentFile or prompt is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const send = (event: any) => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    };
    const keepalive = setInterval(() => {
      if (closed) return;
      try { res.write(':keepalive\n\n'); } catch { clearInterval(keepalive); }
    }, 25000);

    req.on('close', () => {
      closed = true;
      clearInterval(keepalive);
    });

    await streamFastMultimodal(request, send);
    if (!closed) {
      clearInterval(keepalive);
      try { res.end(); } catch {}
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Code completion request failed' });
    } else {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Code completion request failed' })}\n\n`); res.end(); } catch {}
    }
  }
});

app.post('/api/web/glance', async (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const maxResults = Math.max(1, Math.min(Number(req.body?.maxResults) || 3, 5));

    if (query.length < 2) {
      res.status(400).json({ error: 'query must be at least 2 characters' });
      return;
    }

    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query.slice(0, 160));
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Beatrice Voice Assistant/1.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.status(502).json({ error: `Web glance failed with status ${response.status}` });
      return;
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      res.status(502).json({ error: 'Web glance returned empty or invalid response' });
      return;
    }
    const related: Array<{ title: string; url: string; snippet: string }> = [];
    const stripTags = (value: unknown) => String(value || '').replace(/<[^>]*>/g, '').trim();

    const collect = (item: any) => {
      if (Array.isArray(item?.Topics)) {
        item.Topics.forEach(collect);
        return;
      }

      const title = stripTags(item?.FirstURL ? item.Text?.split(' - ')[0] : item?.Text);
      const snippet = stripTags(item?.Text);
      const itemUrl = stripTags(item?.FirstURL);
      if (title && itemUrl) {
        related.push({ title, url: itemUrl, snippet });
      }
    };

    (Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []).forEach(collect);

    res.json({
      query,
      heading: stripTags(data.Heading) || undefined,
      abstract: stripTags(data.AbstractText) || undefined,
      source: stripTags(data.AbstractSource || 'DuckDuckGo'),
      results: related.slice(0, maxResults),
    });
  } catch (err: any) {
    console.error('Web glance error:', err);
    res.status(500).json({ error: err.message || 'Web glance failed' });
  }
});

app.post('/api/web/read-page', async (req, res) => {
  try {
    const { url, maxLength } = req.body;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BeatriceBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { res.status(502).json({ error: `Page fetch failed with status ${response.status}` }); return; }
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyText = bodyMatch ? bodyMatch[1] : html;
    const cleaned = bodyText
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[^;]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const max = Math.min(Math.max(Number(maxLength) || 10000, 1000), 50000);
    const content = cleaned.substring(0, max);
    res.json({ ok: true, url, title, content, contentLength: content.length });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to read page: ${getMsg(err)}` });
  }
});

// ── Belgian Admin & Business Tools Route ──

app.post('/api/belgian/tool', async (req, res) => {
  try {
    const { tool } = req.body;
    const params = req.body.params || {};

    if (!tool) {
      res.status(400).json({ error: 'tool is required' });
      return;
    }

    let result: any;
    switch (tool) {
      case 'belgian_company_lookup':
        result = await belgianTools.lookupCompany(String(params.query || ''));
        break;
      case 'belgian_vies_vat_validate':
        result = await belgianTools.validateViesVat(String(params.vatNumber || ''));
        break;
      case 'belgian_peppol_invoice':
        result = await belgianTools.generatePeppolInvoice({
          recipientKbo: String(params.recipientKbo || ''),
          amount: Number(params.amount) || 0,
          description: String(params.description || ''),
          dueDate: params.dueDate ? String(params.dueDate) : undefined
        });
        break;
      case 'belgian_tax_calendar':
        result = await belgianTools.fetchTaxCalendar(params.period ? String(params.period) : undefined);
        break;
      case 'belgian_registration_tax_calc':
        result = await belgianTools.calculateRegistrationTax({
          purchasePrice: Number(params.purchasePrice) || 0,
          region: params.region || 'Flanders',
          isFirstTimeBuyer: !!params.isFirstTimeBuyer,
          energyRenovation: !!params.energyRenovation
        });
        break;
      case 'belgian_itsme_navigator':
        result = await belgianTools.getItsmeInstructions(String(params.administrativeTask || ''));
        break;
      case 'belgian_language_bridge':
        result = await belgianTools.runLanguageBridge(String(params.text || ''), params.targetLanguage || 'EN');
        break;
      case 'belgian_social_security_navigator':
        result = await belgianTools.navigateSocialSecurity(String(params.query || ''));
        break;
      case 'belgian_labor_law_simplifier':
        result = await belgianTools.simplifyLaborLaw({
          clauseType: String(params.clauseType || ''),
          contractType: params.contractType ? String(params.contractType) : undefined,
          durationMonths: params.durationMonths ? Number(params.durationMonths) : undefined,
          salary: params.salary ? Number(params.salary) : undefined
        });
        break;
      case 'belgian_mobility_planner':
        result = await belgianTools.getBelgianMobility(String(params.from || ''), String(params.to || ''), params.time ? String(params.time) : undefined);
        break;
      default:
        res.status(400).json({ error: `Unknown Belgian tool: ${tool}` });
        return;
    }
    res.json(result);
  } catch (err: any) {
    console.error('Belgian tool error:', err);
    res.status(500).json({ error: err.message || 'Belgian tool execution failed' });
  }
});

// ── Ollama Proxy Route ──
// Proxies generation requests to a local Ollama instance on the VPS.
// Set OLLAMA_BASE_URL to override (default: http://localhost:11434)
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

app.post('/api/ollama/generate', async (req, res) => {
  const { model, messages, options } = req.body;
  if (!model || !messages) {
    res.status(400).json({ error: 'model and messages are required' });
    return;
  }

  // Set SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: options || {},
      }),
    });

    if (!ollamaRes.ok) {
      const errBody = await ollamaRes.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `Ollama error (${ollamaRes.status}): ${errBody}` })}\n\n`);
      res.end();
      return;
    }

    const reader = ollamaRes.body?.getReader();
    if (!reader) {
      res.write(`data: ${JSON.stringify({ error: 'No response body from Ollama' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          } else if (json.message?.content) {
            res.write(`data: ${JSON.stringify({ text: json.message.content })}\n\n`);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Ollama proxy error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Ollama proxy failed' })}\n\n`);
    res.end();
  }
});

// ── WhatsApp Routes (Baileys) ──

const getMsg = (e: any) => e?.message || String(e);

  app.post('/api/whatsapp/pair', async (req, res) => {
    try {
      const { userId, phoneNumber } = req.body;
      if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
      const result = await waManager!.startPairing(userId, phoneNumber);
      if ('error' in result) { res.status(500).json(result); return; }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/status/:userId', async (req, res) => {
    try {
      const status = await waManager!.getStatusOrStart(req.params.userId);
      if (!status) { res.json({ status: 'not_found' }); return; }
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/qr/:userId', async (req, res) => {
    try {
      const status = await waManager!.getStatusOrStart(req.params.userId);
      let qrCode = status?.qrCode;
      if (!qrCode) {
        const pollStart = Date.now();
        const pollTimeout = 30000;
        while (!qrCode && Date.now() - pollStart < pollTimeout) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const refresh = waManager!.getStatus(req.params.userId);
          if (!refresh) break;
          qrCode = refresh.qrCode || undefined;
          
          // Exit early if session failed or already paired
          if (refresh.status === 'error' || refresh.status === 'paired' || refresh.status === 'disconnected') {
            break;
          }
        }
      }
      if (!qrCode) {
        res.status(404).json({ error: 'QR not generated within 30s.', status: waManager!.getStatus(req.params.userId)?.status || 'unknown' });
        return;
      }
      const base64 = qrCode.replace(/^data:image\/png;base64,/, '');
      res.setHeader('Cache-Control', 'no-store');
      res.type('png').send(Buffer.from(base64, 'base64'));
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/messages/:userId', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = waManager!.getRecentMessages(req.params.userId, limit);
    res.json({ messages });
  });

  app.get('/api/whatsapp/admin/overview/:userId', async (req, res) => {
    try {
      const overview = await waManager!.getAdminOverview(req.params.userId);
      res.json(overview);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/admin/config', async (req, res) => {
    try {
      const { userId, config } = req.body;
      if (!userId || !config) { res.status(400).json({ error: 'userId and config required' }); return; }
      const saved = waManager!.saveAdminConfig(userId, config);
      res.json({ ok: true, config: saved });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/admin/config/:userId', async (req, res) => {
    try {
      const config = waManager!.getAdminConfigPublic(req.params.userId);
      res.json({ ok: true, config });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/permissions/:userId', async (req, res) => {
    try {
      const config = waManager!.getAdminConfigPublic(req.params.userId);
      res.json({ ok: true, permissions: config.permissions, restrictedContacts: config.restrictedContacts, restrictedChats: config.restrictedChats });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/permissions', async (req, res) => {
    try {
      const { userId, permissions } = req.body;
      if (!userId || !permissions) { res.status(400).json({ error: 'userId and permissions required' }); return; }
      const saved = waManager!.saveAdminConfig(userId, { permissions });
      res.json({ ok: true, permissions: saved.permissions });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/restrict/contact', async (req, res) => {
    try {
      const { userId, contactJid, restricted } = req.body;
      if (!userId || !contactJid) { res.status(400).json({ error: 'userId and contactJid required' }); return; }
      const saved = waManager!.setContactRestriction(userId, contactJid, restricted !== false);
      res.json({ ok: true, restrictedContacts: saved.restrictedContacts });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/restrict/chat', async (req, res) => {
    try {
      const { userId, chatJid, restricted } = req.body;
      if (!userId || !chatJid) { res.status(400).json({ error: 'userId and chatJid required' }); return; }
      const saved = waManager!.setChatRestriction(userId, chatJid, restricted !== false);
      res.json({ ok: true, restrictedChats: saved.restrictedChats });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/profile-pic/:userId', async (req, res) => {
    try {
      const { jid } = req.query;
      if (!jid) { res.status(400).json({ error: 'jid query param required' }); return; }
      const sock = waManager!.getClient(req.params.userId);
      if (!sock) { res.status(404).json({ error: 'Not connected' }); return; }
      const url = await sock.profilePictureUrl(jid as string, 'image').catch(() => null);
      if (!url) { res.status(404).json({ error: 'No profile picture' }); return; }
      res.redirect(url);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/media/:userId/:chatId/:messageId', async (req, res) => {
    try {
      const { userId, chatId, messageId } = req.params;
      if (!waManager) { res.status(503).json({ error: 'WhatsApp not available' }); return; }

      // Serve from cache first
      const cachePath = waManager.getMediaCachePath(userId, chatId, messageId);
      if (fs.existsSync(cachePath + '.data') && fs.existsSync(cachePath + '.meta')) {
        try {
          const meta = JSON.parse(fs.readFileSync(cachePath + '.meta', 'utf-8'));
          const mime = meta.mimeType || 'application/octet-stream';
          res.setHeader('Content-Type', mime);
          res.setHeader('X-Cache', 'HIT');
          res.sendFile(cachePath + '.data');
          return;
        } catch {}
      }

      // Fallback: stream from WhatsApp CDN
      const sock = waManager.getClient(userId);
      if (!sock) { res.status(404).json({ error: 'Not connected' }); return; }
      const msg = (waManager as any).getMessageById?.(userId, chatId, messageId);
      if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }
      const mediaMsg = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage || msg.message?.stickerMessage;
      if (!mediaMsg) { res.status(404).json({ error: 'No media in message' }); return; }
      const mediaType = msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video' : msg.message?.audioMessage ? 'audio' : msg.message?.documentMessage ? 'document' : 'image';
      try {
        const stream = await downloadContentFromMessage(mediaMsg, mediaType as any);
        if (!stream) { res.status(404).json({ error: 'Media not available' }); return; }
        const mime = mediaMsg.mimetype || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Cache', 'MISS');

        // Collect stream and cache it for next time
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (streamErr: Error) => {
          console.error(`Media stream error for ${userId}/${chatId}/${messageId}:`, streamErr.message);
          if (!res.headersSent) res.status(502).json({ error: 'Media stream failed' });
          else res.end();
        });
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // Cache asynchronously
          try {
            fs.writeFileSync(cachePath + '.data', buffer);
            fs.writeFileSync(cachePath + '.meta', JSON.stringify({ mimeType: mime, mediaType }));
          } catch {}
          res.end(buffer);
        });
        stream.resume();
      } catch (dlErr: any) {
        const msg_lower = (dlErr.message || '').toLowerCase();
        if (msg_lower.includes('expired') || msg_lower.includes('404')) {
          res.status(410).json({ error: 'Media expired or unavailable' });
        } else {
          res.status(502).json({ error: `Download failed: ${getMsg(dlErr)}` });
        }
      }
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/read-attachment/:userId/:chatId/:messageId', async (req, res) => {
    try {
      const { userId, chatId, messageId } = req.params;
      if (!waManager) { res.status(503).json({ error: 'WhatsApp not available' }); return; }
      const result = await waManager.downloadAttachmentContent(userId, chatId, messageId);
      if (!result) { res.status(404).json({ error: 'Attachment not found or expired' }); return; }
      const mediaUrl = `/api/whatsapp/media/${encodeURIComponent(userId)}/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}`;
      const { extractFileContent } = await import('./file-extractor');
      const extracted = extractFileContent(result.buffer, result.mimeType, result.fileName, mediaUrl);
      res.json(extracted);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/transcribe-audio/:userId/:chatId/:messageId', async (req, res) => {
    try {
      const { userId, chatId, messageId } = req.params;
      if (!waManager) { res.status(503).json({ error: 'WhatsApp not available' }); return; }
      const result = await waManager.downloadAttachmentContent(userId, chatId, messageId);
      if (!result) { res.status(404).json({ error: 'Attachment not found or expired' }); return; }
      if (!result.mimeType.startsWith('audio/')) { res.status(400).json({ error: 'Not an audio file' }); return; }
      const audioBase64 = result.buffer.toString('base64');
      const transResult = await transcribeEburonAudio({
        audioData: audioBase64,
        mimeType: result.mimeType,
        prompt: req.body.prompt || 'Transcribe the audio content exactly as spoken. Include speaker labels if distinguishable.',
      });
      res.json({ ok: true, transcript: transResult.text, mimeType: result.mimeType, fileName: result.fileName });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/send-document', async (req, res) => {
    try {
      const { userId, to, content, fileName, caption } = req.body;
      if (!userId || !to || !content || !fileName) { res.status(400).json({ error: 'userId, to, content, and fileName required' }); return; }
      if (!waManager) { res.status(503).json({ error: 'WhatsApp not available' }); return; }
      const buffer = Buffer.from(content, 'utf-8');
      const sent = await waManager.sendDocumentBuffer(userId, to, buffer, fileName, caption);
      if (!sent) { res.status(502).json({ error: 'Failed to send document' }); return; }
      res.json({ ok: true, chatId: sent.chatId, messageId: sent.messageId });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
      await waManager!.disconnect(userId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    try {
      const { userId, to, text, permissions } = req.body;
      if (!userId || !to || !text) { res.status(400).json({ error: 'userId, to, text required' }); return; }
      const effectivePermissions = waManager!.getEffectivePermissions(userId, permissions);
      const result = await waTools.handleSendMessage(waManager!, userId, effectivePermissions, to, text);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.post('/api/whatsapp/tool', async (req, res) => {
    try {
      const { userId, tool, permissions } = req.body;
      const params = req.body.params || {};
      if (!userId || !tool) { res.status(400).json({ error: 'userId and tool required' }); return; }
      const result = await waTools.handleWhatsAppAction(waManager!, userId, tool, params, permissions);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

  app.get('/api/whatsapp/webhook/:userId', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expectedToken = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'eburon_wa_verify';
    if (mode === 'subscribe' && token === expectedToken) {
      res.status(200).send(String(challenge || ''));
      return;
    }
    res.sendStatus(403);
  });

  app.post('/api/whatsapp/webhook/:userId', (req, res) => {
    try {
      res.json(waManager!.ingestCloudWebhook(req.params.userId, req.body));
    } catch (err: any) {
      res.status(500).json({ error: getMsg(err) });
    }
  });

// ── WhatsApp Real-Time SSE Stream ──
// Frontend connects to this endpoint to receive incoming WhatsApp messages live
app.get('/api/whatsapp/stream/:userId', (req, res) => {
  const userId = req.params.userId;
  if (!waManager) { res.status(503).json({ error: 'WhatsApp not available' }); return; }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial keepalive
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const onMessage = (msg: any) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'message', data: msg })}\n\n`);
    } catch {}
  };

  waManager.onSseConnect(userId, onMessage);

  // Keepalive every 30s
  const keepalive = setInterval(() => {
    try { res.write(`:keepalive\n\n`); } catch { clearInterval(keepalive); }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepalive);
    waManager?.onSseDisconnect(userId, onMessage);
  });
});

// ── Web Architect (Website Builder) Routes ──

app.post('/api/website/generate', async (req, res) => {
  try {
    const { userId, title, prompt, timestamp } = req.body;
    if (!userId || !title || !prompt || !timestamp) {
      res.status(400).json({ error: 'userId, title, prompt, and timestamp are required' });
      return;
    }

    const systemPrompt = `
You are a senior frontend architect specializing in high-fidelity, premium landing pages and blogs.
Generate exactly one complete standalone HTML document.
The design must be ultra-modern, professional, and fully responsive (mobile-first).

Design Language (inspired by high-end PWA themes like AppKart and Aleric):
- Theme: Use sophisticated color palettes. Premium Dark (#050505 base) or Apple-style Clean White.
- Typography: Use Google Fonts (Inter or Playfair Display).
- UI Components: 
  * Glassmorphism effects (backdrop-filter: blur).
  * Smooth CSS transitions and keyframe animations.
  * Card-based layouts with soft shadows and subtle borders.
  * Premium icons (use Lucide or FontAwesome via CDN if needed, or simple SVGs).
  * High-quality imagery using Unsplash source URLs.
- Mobile Experience:
  * Persistent bottom navigation if applicable.
  * Large, touch-friendly buttons.
  * Immersive full-bleed sections.

Hard Rules:
- Return ONLY the raw HTML. Do not include markdown fences.
- Start with <!DOCTYPE html>.
- All CSS must be in a <style> tag.
- All JS must be in a <script> tag.
- No external dependencies except Google Fonts.
- Do not mention HTML or Beatrice to the user.
- Ensure the site looks like a high-end production site.
- Do not create apps that mimic the Beatrice platform or voice assistants.
- Include a clear footer and navigation.
`;

    const userPrompt = `
Create a premium website/landing page.
Title: ${title}
Request: ${prompt}
Timestamp: ${timestamp}
`;

    const genResult = await generateEburonWorker({
      prompt: userPrompt,
      systemInstruction: systemPrompt,
    });
    const htmlContent = genResult.text.trim().replace(/^```html/, '').replace(/```$/, '');

    // Save to Supabase
    const { error } = await supabase.from('websites').insert({
      user_id: userId,
      timestamp: timestamp,
      html_content: htmlContent,
      title: title
    });

    if (error) {
      console.error('Supabase save error:', error);
      res.status(500).json({ error: 'Failed to save generated site' });
      return;
    }

    const slug = `/site-build/${userId}/${timestamp}`;
    res.json({ ok: true, slug, title });

  } catch (err: any) {
    console.error('Website generation error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

app.get('/site-build/:userId/:timestamp', async (req, res) => {
  try {
    const { userId, timestamp } = req.params;
    const { data, error } = await supabase
      .from('websites')
      .select('html_content')
      .eq('user_id', userId)
      .eq('timestamp', timestamp)
      .single();

    if (error || !data) {
      res.status(404).send('<h1>404 - Website not found</h1><p>The link may have expired or is incorrect.</p>');
      return;
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(data.html_content);
  } catch (err: any) {
    res.status(500).send('Internal Server Error');
  }
});

// ── Sandbox Sub-Agent Runner ──
// Runs complex tasks via OpenCode CLI or direct Eburon Worker call
// Returns only a summary to keep the main agent's context clean

import { execSync, spawn } from 'child_process';
import crypto from 'crypto';

const OPENCODE_PATH = process.env.OPENCODE_PATH || '/root/.opencode/bin/opencode';
// OpenCode (Zen free-tier) model swap chain. When the primary runs out of tokens,
// automatically swap to the next free model. Order matters: degrade gracefully so
// output quality falls back only when forced. Override the full list via
// OPENCODE_ZEN_FREE_MODELS (comma-separated opencode/<model> ids).
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/zenn-ai-large-free';
const OPENCODE_FALLBACK_MODEL = process.env.OPENCODE_FALLBACK_MODEL || 'opencode/deepseek-v4-flash-free';
const OPENCODE_ZEN_FREE_MODELS = (process.env.OPENCODE_ZEN_FREE_MODELS
  || [
      OPENCODE_MODEL,
      OPENCODE_FALLBACK_MODEL,
      'opencode/big-pickle',
      'opencode/north-mini-code-free',
      'opencode/mimo-v2.5-free',
      'opencode/nemotron-3-ultra-free',
    ].join(',')
).split(',').map(s => s.trim()).filter(Boolean);
// Guaranteed-non-empty chain used by the fallback loop so we never pass `null`
// to runOpenTerminalOllamaFallback as the `primary` argument.
const OPENCODE_ZEN_CHAIN = OPENCODE_ZEN_FREE_MODELS.length > 0 ? OPENCODE_ZEN_FREE_MODELS : [OPENCODE_MODEL];
const OPEN_TERMINAL_FALLBACK_MODEL = process.env.OPEN_TERMINAL_FALLBACK_MODEL || 'media-pipe/eburon-sandbox-worker:latest';
const OPEN_TERMINAL_WORKDIR = path.resolve(process.env.OPEN_TERMINAL_WORKDIR || path.join(__dirname, '..'));
const OPEN_TERMINAL_MAX_OUTPUT = 24_000;

// Patterns that indicate OpenCode CLI failed because of upstream quota/rate
// limits (not real task errors). RunOpenTerminalWithFallback looks for these in
// stderr/stdout to decide whether to swap to the next free model.
const OPENCODE_QUOTA_PATTERNS: RegExp[] = [
  /\b429\b/,
  /\b402\b/,
  /rate[-_ ]?limit/i,
  /quota/i,
  /usage[-_ ]?limit/i,
  /usage[-_ ]?exceeded/i,
  /out[-_ ]?of[-_ ]?tokens/i,
  /insufficient[-_ ]?(?:quota|balance|credit)/i,
  /resource[-_ ]?exhaust/i,
  /too many requests/i,
  /has been exhausted/i,
  /RESOURCE_EXHAUSTED/,
];

function isOpenCodeQuotaError(stderr: string, stdout: string): boolean {
  const combined = `${stderr || ''}\n${stdout || ''}`;
  return OPENCODE_QUOTA_PATTERNS.some(p => p.test(combined));
}

// Slice the user's timeout across the remaining Zen models so a quota-storm
// doesn't blow up to 5x the user's apparent patience. Floor at 15s per model
// so prompt-loading can complete.
function sliceTimeoutPerModel(userTimeout: number, modelsRemaining: number): number {
  return Math.max(15, Math.floor(userTimeout / Math.max(1, modelsRemaining)));
}

const BEATRICE_WORKSPACE_DIR = process.env.BEATRICE_WORKSPACE_DIR || '/data/beatrice-workspace';
const BEATRICE_PUBLIC_URL = process.env.BEATRICE_PUBLIC_URL || 'https://whatsapp.eburon.ai';
const SANDBOX_ARTIFACTS_DIR = path.join(BEATRICE_WORKSPACE_DIR, 'sandbox');

function ensureBeatricedDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizePathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unnamed';
}

function buildAppUrl(userId: string, appName: string): string {
  const safeUser = sanitizePathSegment(userId);
  const safeApp = sanitizePathSegment(appName);
  return `${BEATRICE_PUBLIC_URL}/beatrice-workspace/${safeUser}/${safeApp}/`;
}

function buildWorkspacePath(userId: string, appName: string): string {
  const safeUser = sanitizePathSegment(userId);
  const safeApp = sanitizePathSegment(appName);
  return path.join(BEATRICE_WORKSPACE_DIR, safeUser, safeApp);
}

let openTerminalQueue: Promise<void> = Promise.resolve();

// ── Beatrice Workspace: serve AI-generated apps ──
ensureBeatricedDir(BEATRICE_WORKSPACE_DIR);
ensureBeatricedDir(SANDBOX_ARTIFACTS_DIR);
app.use('/beatrice-workspace', express.static(BEATRICE_WORKSPACE_DIR, {
  extensions: ['html'],
  index: 'index.html',
}));

type OpenTerminalResult = {
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
};

// In-memory task progress store for SSE streaming
const taskProgress = new Map<string, { status: string; agent?: string; message?: string; done?: boolean }>();

function setTaskProgress(taskId: string, status: string, opts?: { agent?: string; message?: string }) {
  const done = status === 'done' || status === 'error';
  const entry = taskProgress.get(taskId) || { status, done };
  entry.status = status;
  entry.done = done;
  if (opts?.agent) entry.agent = opts.agent;
  if (opts?.message) entry.message = opts.message;
  taskProgress.set(taskId, entry);
}

function clampTerminalTimeout(timeout: unknown): number {
  return Math.min(Math.max(Number(timeout) || 60, 10), 300);
}

function buildOpenTerminalPrompt(params: {
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
      `- Use only client-side technologies (HTML, CSS, JS). No server or build tools.`,
      `- All assets (CSS, JS, images) must be inline or use absolute CDN URLs.`,
      `- Create the directory and write files using terminal commands like mkdir -p, cat with heredoc, or tee.`,
      `- Example: mkdir -p ${params.workspacePath} && cat > ${params.workspacePath}/index.html << 'APPEOF' ... APPEOF`,
      ``,
    ].join('\n');
  }

  let promptStr = context ? `${context}\nTASK:\n${safeTask}` : safeTask;
  if (safeSkill) promptStr = `Use the ${safeSkill} skill if it is available, then complete this task:\n\n${promptStr}`;
  return promptStr;
}

async function runOpenCodeTerminalTask(params: {
  task: string;
  skill?: string;
  timeout: number;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
  modelOverride?: string;
}): Promise<OpenTerminalResult> {
  const prompt = buildOpenTerminalPrompt(params);
  if (!prompt) throw new Error('task is required');
  if (!fs.existsSync(OPENCODE_PATH)) throw new Error(`OpenCode CLI not found at ${OPENCODE_PATH}`);
  if (!fs.existsSync(OPEN_TERMINAL_WORKDIR)) throw new Error(`Open terminal workdir not found: ${OPEN_TERMINAL_WORKDIR}`);

  const model = params.modelOverride || OPENCODE_MODEL;
  const args = ['run', '--model', model, '--dir', OPEN_TERMINAL_WORKDIR, '--dangerously-skip-permissions', prompt];
  const child = spawn(OPENCODE_PATH, args, {
    cwd: OPEN_TERMINAL_WORKDIR,
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
    if (combined.length > OPEN_TERMINAL_MAX_OUTPUT) truncated = true;
    const clipped = combined.slice(0, OPEN_TERMINAL_MAX_OUTPUT);
    if (target === 'stdout') stdout = clipped;
    else stderr = clipped;
  };

  child.stdout.on('data', chunk => append('stdout', chunk));
  child.stderr.on('data', chunk => append('stderr', chunk));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 2000).unref();
  }, params.timeout * 1000);

  return await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        timedOut,
        truncated,
        error: exitCode === 0 && !timedOut ? undefined : (stderr || stdout || 'Terminal task execution failed').slice(0, 500),
      });
    });
  });
}

async function runOpenTerminalOllamaFallback(params: {
  task: string;
  skill?: string;
  timeout: number;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
}, primary: OpenTerminalResult): Promise<OpenTerminalResult> {
  const prompt = buildOpenTerminalPrompt(params);
  const systemPrompt = [
    'You are Eburon Sandbox, the local fallback agent for Beatrice open-terminal skills.',
    'Complete the requested repository or terminal-oriented task as well as possible from the prompt context.',
    'Be concise, direct, and return only useful final output. If command execution would be required but is unavailable in fallback mode, say so briefly and provide the best next step.',
  ].join('\n');

  try {
    const fallback = await callOllama(
      OPEN_TERMINAL_FALLBACK_MODEL,
      systemPrompt,
      prompt,
      Math.min(params.timeout, 180),
      1024
    );
    const content = fallback.content.trim();
    if (!content) throw new Error('Local Eburon sandbox returned an empty response');

    return {
      ok: true,
      stdout: `${content}\n`,
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      fallback: true,
    };
  } catch (err: any) {
    return {
      ...primary,
      error: `Primary execution failed and fallback also failed: ${err.message || String(err)}`,
    };
  }
}

async function runOpenTerminalCerebrasFallback(params: {
  task: string;
  skill?: string;
  timeout: number;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
}, primary: OpenTerminalResult): Promise<OpenTerminalResult> {
  const system = [
    'You are Eburon Sandbox, the Cerebras-powered fallback coding agent for Beatrice open-terminal skills.',
    'Complete the requested repository, coding, or terminal-oriented task as well as possible.',
    'Return the output, code, or result the user would expect from a terminal-based sub-agent.',
    'Be concise and direct. If terminal execution would be required but is unavailable, provide the best alternative.',
  ].join('\n');

  try {
    const result = await callCerebras(system, params.task, Math.min(params.timeout, 180), 4096);
    const content = result.content.trim();
    if (!content) throw new Error('Cerebras returned an empty response');
    return {
      ok: true,
      stdout: `${content}\n`,
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      fallback: true,
    };
  } catch (err: any) {
    return {
      ...primary,
      error: `Cerebras fallback also failed: ${err.message || String(err)}`,
    };
  }
}

async function runOpenTerminalWithFallback(params: {
  task: string;
  skill?: string;
  timeout: number;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
}): Promise<OpenTerminalResult> {
  // 1. Try each OpenCode Zen free model in order. On quota errors, swap to the
  //    next free model. On a non-quota failure (real task error), break out so
  //    we don't waste time retrying the same kind of failure on a different model.
  let lastZenResult: OpenTerminalResult | null = null;
  const triedModels: string[] = [];
  const chain = OPENCODE_ZEN_CHAIN;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    triedModels.push(model);
    // Slice the total user timeout across remaining models so worst-case budget
    // is `userTimeout` not `userTimeout × chain.length`.
    const perModelTimeout = sliceTimeoutPerModel(params.timeout, chain.length - i);
    const result = await runOpenCodeTerminalTask({ ...params, timeout: perModelTimeout, modelOverride: model });
    if (result.ok) return result;
    lastZenResult = result;
    if (!isOpenCodeQuotaError(result.stderr || '', result.stdout || '')) break;
    console.warn(`[OpenCode Zen] ${model} out of tokens. Swapping to next free model...`);
  }

  // 2. All Zen free models exhausted. Try Cerebras as a coding fallback agent.
  setTaskProgress('terminal_fallback', 'running', { agent: 'cerebras', message: 'OpenCode models exhausted, falling back to Cerebras coding agent' });
  const cerebrasResult = await runOpenTerminalCerebrasFallback(params, lastZenResult ?? {
    ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, truncated: false,
    error: 'No OpenCode Zen model was attempted (empty chain).',
  });
  if (cerebrasResult.ok) return cerebrasResult;

  // 3. Cerebras also failed. Last resort: local Eburon Ollama models.
  setTaskProgress('terminal_fallback', 'running', { agent: 'eburon_ollama', message: 'Cerebras failed, trying local Eburon Ollama models' });
  const ollamaFallback = await runOpenTerminalOllamaFallback(params, cerebrasResult);
  if (ollamaFallback.ok) return ollamaFallback;

  // 4. Everything failed — surface which models we tried for diagnostics.
  return {
    ...ollamaFallback,
    error: (ollamaFallback.error || 'All models exhausted (OpenCode Zen + Cerebras + local Ollama)') +
      (triedModels.length > 0 ? ` (tried: ${triedModels.join(', ')})` : ''),
  };
}

async function enqueueOpenCodeTerminalTask(params: {
  task: string;
  skill?: string;
  timeout: number;
  appName?: string;
  workspacePath?: string;
  appUrl?: string;
}) {
  const run = openTerminalQueue.then(
    () => runOpenTerminalWithFallback(params),
    () => runOpenTerminalWithFallback(params),
  );
  openTerminalQueue = run.then(() => undefined, () => undefined);
  return run;
}

app.post('/api/terminal/open-skills', async (req, res) => {
  try {
    const { task, skill, timeout, userId, appName } = req.body || {};
    const safeTask = String(task || '').trim();
    if (!safeTask) {
      res.status(400).json({ ok: false, error: 'task is required' });
      return;
    }

    const safeAppName = String(appName || '').trim();
    const safeUserId = String(userId || '').trim();
    const workspacePath = safeAppName && safeUserId ? buildWorkspacePath(safeUserId, safeAppName) : undefined;
    const appUrl = safeAppName && safeUserId ? buildAppUrl(safeUserId, safeAppName) : undefined;

    const result = await enqueueOpenCodeTerminalTask({
      task: safeTask,
      skill,
      timeout: clampTerminalTimeout(timeout),
      appName: safeAppName || undefined,
      workspacePath,
      appUrl,
    });

    const resolvedAppUrl = (safeAppName && safeUserId && workspacePath && fs.existsSync(path.join(workspacePath, 'index.html')))
      ? appUrl
      : undefined;

    res.json({
      ...result,
      appUrl: resolvedAppUrl,
      appWorkspace: workspacePath,
    });
  } catch (err: any) {
    console.error('[Open Terminal] error:', err.message?.slice(0, 200));
    res.status(500).json({
      ok: false,
      error: err.message?.slice(0, 500) || 'Terminal task execution failed',
    });
  }
});

// ── Coding Agent Runner (generic multi-provider, server-side only) ──
// Replaces hardcoded OpenCode logic with a pluggable provider system.
// Providers (opencode, gemini, freebuff, codebuff) are never exposed to the frontend.

const codingAgentRunner = new CodingAgentRunner({
  allowedRoot: OPEN_TERMINAL_WORKDIR,
  callOllama: (model, system, prompt, timeout, maxTokens) =>
    callOllama(model, system, prompt, timeout, maxTokens),
  callCerebras: (system, prompt, timeout, maxTokens) =>
    callCerebras(system, prompt, timeout, maxTokens),
});

// Pipe runner events to the SSE event bus so streaming clients receive updates
const _runnerEmit = codingAgentRunner.emit.bind(codingAgentRunner);
codingAgentRunner.emit = function (event: string, ...args: any[]) {
  codingStreamEmitter.emit(event, ...args);
  return _runnerEmit(event, ...args);
};

/**
 * POST /api/coding-agent/run
 * Unified backend endpoint for all coding/terminal task execution.
 * Provider selection is server-side only — the frontend never sees which
 * provider, CLI, model, or backend tool is used.
 */
app.post('/api/coding-agent/run', async (req, res) => {
  try {
    const { agent, taskPrompt, cwd, model, scope, timeout, permissionMode, userId, appName, skill } = req.body || {};

    const safeTask = String(taskPrompt || '').trim();
    if (!safeTask) {
      res.status(400).json({ ok: false, error: 'task is required' });
      return;
    }

    const safeAppName = String(appName || '').trim();
    const safeUserId = String(userId || '').trim();
    const workspacePath = safeAppName && safeUserId ? buildWorkspacePath(safeUserId, safeAppName) : undefined;
    const appUrl = safeAppName && safeUserId ? buildAppUrl(safeUserId, safeAppName) : undefined;

    const result = await codingAgentRunner.run({
      agent,
      taskPrompt: safeTask,
      cwd: cwd || OPEN_TERMINAL_WORKDIR,
      model,
      scope,
      timeout,
      permissionMode,
      appName: safeAppName || undefined,
      workspacePath,
      appUrl,
      skill,
    });

    const resolvedAppUrl = (safeAppName && safeUserId && workspacePath && fs.existsSync(path.join(workspacePath, 'index.html')))
      ? appUrl
      : undefined;

    // Strip internal provider info from response — never expose to frontend
    const { _provider, _model, ...frontendSafe } = result;

    // Always sanitize stderr — even on success, CLI tools emit skill conflict
    // warnings, auth messages, and internal diagnostics that must never reach
    // the frontend. Clear it entirely; the stdout has the actual result.
    frontendSafe.stderr = '';

    // On failure, sanitize all output — never leak provider details or
    // internal error messages to the frontend. Show user-friendly error only.
    if (!frontendSafe.ok) {
      res.json({
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: frontendSafe.exitCode ?? null,
        timedOut: frontendSafe.timedOut ?? false,
        truncated: false,
        error: 'The workspace assistant could not complete the task.',
        appUrl: resolvedAppUrl,
        appWorkspace: workspacePath,
      });
    } else {
      res.json({
        ...frontendSafe,
        appUrl: resolvedAppUrl,
        appWorkspace: workspacePath,
      });
    }
  } catch (err: any) {
    console.error('[CodingAgent] error:', err.message?.slice(0, 200));
    // User-friendly error only — never reveal provider details
    res.status(500).json({
      ok: false,
      error: 'The workspace assistant could not complete the task.',
    });
  }
});

/**
 * GET /api/coding-agent/status
 * Internal diagnostics only — never exposed to end users.
 */
app.get('/api/coding-agent/status', (_req, res) => {
  res.json(codingAgentRunner.status());
});

// ── Streaming coding agent task manager ─────────────────────────
// In-memory task registry (ephemeral — lost on server restart)
const codingStreamEmitter = new EventEmitter();
const codingStreamTasks = new Map<string, {
  status: 'running' | 'complete' | 'error';
  createdAt: number;
  stdout: string;
  stderr: string;
  result?: any;
  appUrl?: string;
  appWorkspace?: string;
}>();

// Cleanup stale tasks every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, task] of codingStreamTasks) {
    if (task.createdAt < cutoff) codingStreamTasks.delete(id);
  }
}, 300_000).unref();

/**
 * POST /api/coding-agent/start
 * Kick off an async coding task. Returns a taskId immediately.
 * The frontend connects to GET /api/coding-agent/stream/:taskId for SSE events.
 */
app.post('/api/coding-agent/start', (req, res) => {
  const { userId, taskPrompt, appName, skill, timeout, cwd } = req.body || {};
  const safeTask = String(taskPrompt || '').trim();
  if (!safeTask) {
    res.status(400).json({ ok: false, error: 'task is required' });
    return;
  }

  const safeAppName = String(appName || '').trim();
  const safeUserId = String(userId || '').trim();
  const taskId = crypto.randomUUID();
  const workspacePath = safeAppName && safeUserId ? buildWorkspacePath(safeUserId, safeAppName) : undefined;
  const appUrl = safeAppName && safeUserId ? buildAppUrl(safeUserId, safeAppName) : undefined;

  codingStreamTasks.set(taskId, {
    status: 'running',
    createdAt: Date.now(),
    stdout: '',
    stderr: '',
    appUrl,
    appWorkspace: workspacePath,
  });

  res.json({ ok: true, taskId, appUrl, appWorkspace: workspacePath });

  // Subscribe to streaming events
  const onStdout = (text: string) => {
    const task = codingStreamTasks.get(taskId);
    if (task) task.stdout += text;
  };
  const onStderr = (text: string) => {
    const task = codingStreamTasks.get(taskId);
    if (task) task.stderr += text;
  };
  const onComplete = (result: any) => {
    const task = codingStreamTasks.get(taskId);
    if (task) { task.status = 'complete'; task.result = result; }
    codingStreamEmitter.removeListener(eventStdout, onStdout);
    codingStreamEmitter.removeListener(eventStderr, onStderr);
    codingStreamEmitter.removeListener(eventComplete, onComplete);
  };
  const eventStdout = `task:${taskId}:stdout`;
  const eventStderr = `task:${taskId}:stderr`;
  const eventComplete = `task:${taskId}:complete`;
  codingStreamEmitter.on(eventStdout, onStdout);
  codingStreamEmitter.on(eventStderr, onStderr);
  codingStreamEmitter.on(eventComplete, onComplete);

  // Fire the streaming runner (async, returns immediately)
  codingAgentRunner.startStreamTask({
    taskPrompt: safeTask,
    cwd: cwd || OPEN_TERMINAL_WORKDIR,
    timeout,
    appName: safeAppName || undefined,
    workspacePath,
    appUrl,
    skill,
  }, taskId);
});

/**
 * GET /api/coding-agent/stream/:taskId
 * SSE endpoint — streams stdout/stderr/complete events for a running task.
 */
app.get('/api/coding-agent/stream/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = codingStreamTasks.get(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial state (any buffered output)
  if (task.stdout) {
    res.write(`data: ${JSON.stringify({ type: 'stdout', text: task.stdout })}\n\n`);
  }
  if (task.stderr) {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: task.stderr })}\n\n`);
  }
  if (task.status === 'complete') {
    res.write(`data: ${JSON.stringify({ type: 'complete', result: task.result })}\n\n`);
    res.end();
    return;
  }

  const onStdout = (text: string) => {
    res.write(`data: ${JSON.stringify({ type: 'stdout', text })}\n\n`);
  };
  const onStderr = (text: string) => {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`);
  };
  const onFileWritten = (filePath: string) => {
    res.write(`data: ${JSON.stringify({ type: 'file_written', path: filePath })}\n\n`);
  };
  const onComplete = (result: any) => {
      const { _provider, _model, ...safe } = result;
      safe.appUrl = task.appUrl;
      safe.appWorkspace = task.appWorkspace;
      // Check if the workspace file actually exists
      if (task.appWorkspace && safe.appUrl) {
        const indexPath = path.join(task.appWorkspace, 'index.html');
        if (!fs.existsSync(indexPath)) safe.appUrl = undefined;
      }
      res.write(`data: ${JSON.stringify({ type: 'complete', result: safe })}\n\n`);
    res.end();
    cleanup();
  };

  const cleanup = () => {
    codingStreamEmitter.removeListener(`task:${taskId}:stdout`, onStdout);
    codingStreamEmitter.removeListener(`task:${taskId}:stderr`, onStderr);
    codingStreamEmitter.removeListener(`task:${taskId}:file_written`, onFileWritten);
    codingStreamEmitter.removeListener(`task:${taskId}:complete`, onComplete);
  };

  codingStreamEmitter.on(`task:${taskId}:stdout`, onStdout);
  codingStreamEmitter.on(`task:${taskId}:stderr`, onStderr);
  codingStreamEmitter.on(`task:${taskId}:file_written`, onFileWritten);
  codingStreamEmitter.on(`task:${taskId}:complete`, onComplete);

  req.on('close', cleanup);
  req.on('error', cleanup);

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { clearInterval(heartbeat); cleanup(); }
  }, 15_000);
  req.on('close', () => clearInterval(heartbeat));
});

async function callOllama(model: string, systemPrompt: string, userPrompt: string, timeoutSec: number, maxTokens = 256): Promise<{ content: string; model: string }> {
  const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  if (!ollamaRes.ok) {
    const errBody = await ollamaRes.text().catch(() => '');
    throw new Error(`Ollama (${model}): ${ollamaRes.status} ${errBody.slice(0, 200)}`);
  }
  const data = await ollamaRes.json();
  const content = data.message?.content || data.message?.thinking || '';
  return { content, model };
}

// ── Hermes Multitask Agent (Ollama Hermes 3) ──

const HERMES_MULTITASK_SYSTEM = `You are Hermes Multitask — an elite function agent powered by Hermes 3, the flagship instruction-following model from Nous Research.

Your mission: execute ANY task with precision, depth, and full utilization of your capabilities.

CORE SKILLS (all must be utilized optimally):

1. CHAIN-OF-THOUGHT REASONING (THINK):
   When faced with complex tasks, use structured thinking before responding.
   Enclose your reasoning in <think>...</think> tags.
   Break problems into steps: Analyze → Plan → Execute → Verify.
   For creative tasks, think through design decisions, layout choices, content strategy.
   For code tasks, think through architecture, edge cases, error handling.

2. FUNCTION CALLING & TOOL USE:
   When a task requires external operations, output function calls as valid JSON:
   {"function": "function_name", "parameters": {...}}
   Available functions:
    - web_search(query): search the web for current information
    - fetch_url(url): retrieve content from a URL (use for all GitHub API calls)
    - calculate(expression): evaluate mathematical expressions
    - generate_code(language, specification): produce code in any language
    - github_api(endpoint, method, body): make a GitHub API call — automatically uses GITHUB_TOKEN env var for authorization

GITHUB SKILLS — available via fetch_url tool using GITHUB_TOKEN from environment:

https://api.github.com endpoints available:
* GET /repos/{owner}/{repo} — get repo details
* GET /repos/{owner}/{repo}/pulls — list PRs
* POST /repos/{owner}/{repo}/pulls — create PR (body: {"title":"...","head":"branch","base":"main"})
* GET /repos/{owner}/{repo}/pulls/{number} — get PR details
* PUT /repos/{owner}/{repo}/pulls/{number}/merge — merge PR
* GET /repos/{owner}/{repo}/issues — list issues
* POST /repos/{owner}/{repo}/issues — create issue
* POST /repos/{owner}/{repo}/issues/{number}/comments — add comment
* GET /repos/{owner}/{repo}/contents/{path} — get file contents
* PUT /repos/{owner}/{repo}/contents/{path} — create/update file
* GET /repos/{owner}/{repo}/branches — list branches
* POST /repos/{owner}/{repo}/git/refs — create branch
* GET /repos/{owner}/{repo}/commits — list commits
* GET /repos/{owner}/{repo}/compare/{base}...{head} — compare branches
* GET /search/code?q={query} — search code
* GET /search/issues?q={query} — search issues

For all calls, include header: Authorization: Bearer (value from GITHUB_TOKEN env)
   Produce clean, production-ready code in any language.
   Include comments, error handling, and best practices.
   Use proper formatting and indentation.
   For web artifacts: complete HTML/CSS/JS, single standalone files.
   For backend: proper APIs, validation, type safety.
   For scripts: Python, Bash, Node.js — whatever the task demands.

4. STRUCTURED OUTPUT:
   Output can be any format best suited to the task:
   - JSON for data, APIs, structured responses
   - HTML for web artifacts, documents, visual output
   - Markdown for documentation, reports, explanations
   - Plain text for simple responses
   - Code blocks for programming tasks
   Always choose the optimal output format for the user's intent.

5. MULTI-STEP WORKFLOWS:
   For complex tasks spanning multiple domains:
   - Identify all sub-tasks required
   - Execute each in logical order
   - Integrate results into a cohesive final output
   - Handle errors gracefully with fallback strategies

 6. CREATIVE & DESIGN:
   - Writing: professional, persuasive, or creative as needed
   - Design: modern, responsive, accessible UI/UX
   - Content: meaningful copy, not lorem ipsum placeholders
   - Visual: CSS art, gradients, layouts, data visualizations

7. EBURON BRAND TEMPLATE (for websites/dashboards/artifacts):
   When creating web artifacts, use this Eburon design system:
   - Colors: dark bg (#0A0A0A), gold (#C5A059), gold-hover (#DFB96B), text-light (#F5F5F5)
   - Display font: Syne (headings, bold/800), Body font: Inter (300-600)
   - Tailwind CDN with custom eburon colors config
   - FontAwesome 6 for icons, Google Fonts preconnect

   Structure: fixed glass-nav (logo + "Eburon" + tagline) → hero (bg image + gradient overlay + CTA buttons) → main (sectioned content grids with hover-scale cards) → footer (grid links + copyright)

   Interactivity: scroll-based navbar opacity transition, mobile hamburger toggle, card hover:scale(1.05)

   Pivot: when user asks to change style, switch to editorial/bento-box layout with vertical sidebar, heavy borders, massive typography

7. REASONING & ANALYSIS:
   - Evaluate trade-offs, identify edge cases
   - Provide balanced analysis with supporting evidence
   - Compare alternatives and recommend best paths
   - Validate outputs against requirements

8. INSTRUCTION PRECISION:
   - Follow every instruction literally
   - Preserve all user details and constraints
   - Never omit critical information
   - When uncertain, ask clarifying questions

ARTIFACT OUTPUT RULES (for web/document/visual tasks):

When asked to create websites, documents, dashboards, or visual artifacts:
* Return complete standalone HTML with <!DOCTYPE html>
* All CSS in <style>, all JS in <script>
* Use real Pixabay images from the "REAL PIXABAY IMAGES" section in the system prompt if available
* Never make up image URLs or use placeholder services (unsplash, placeholder.com, picsum)
* Fall back to CSS gradients / SVG if no real images are pre-fetched
* Attribution: "Images courtesy of Pixabay" at page bottom
* Mobile-first responsive, 2+ breakpoints, semantic HTML
* Production-quality, filled with meaningful content

REFERENCE TEMPLATE — Follow this exact pattern for all websites/dashboards:

Design System (Eburon Brand):
- Colors: bg-dark (#0A0A0A), bg-gray (#171717), gold (#C5A059), gold-hover (#DFB96B), text-light (#F5F5F5)
- Display font: 'Syne' (headings, bold/800)
- Body font: 'Inter' (body text, 300-600)
- Use Tailwind via CDN with custom eburon color config
- FontAwesome 6 for icons
- Google Fonts preconnect

HTML Structure:
<!DOCTYPE html><html lang="en" class="scroll-smooth">
<head>
  - Google Fonts (Syne + Inter)
  - Tailwind CDN + custom config (eburon colors, display/sans fonts)
  - FontAwesome CDN
  - Custom CSS (glass-nav, hero-gradient, media-card hover effects, no-scrollbar)
</head>
<body>
  <nav class="fixed glass-nav"> — Logo "Eburon" + gold "TV" tagline, nav links, action icons (search, bell, profile avatar), mobile hamburger menu
  <header class="hero"> — Full-screen bg image, gradient overlay, badge, h1 headline, description, CTA buttons (Play Now + My List)
  <main>
    <section class="trending"> — Section title, grid responsive (2→4→6 cols), media cards with hover:scale(1.05)
    <section class="originals"> — Gold-accented title, responsive grid, cards with image + title + metadata
  </main>
  <footer> — Grid columns (Help, Account, Social), copyright line
  <script> — Scroll navbar transparency, mobile menu toggle
</body>

Interactivity:
- Navbar: glassmorphism initially, solid bg-eburon-dark after 50px scroll
- Mobile: hamburger toggles #mobile-menu visibility
- Cards: hover:scale(1.05) with transition-all 0.4s cubic-bezier
- Active link: gold bottom border

When user asks to "edit the look" or "use different style", pivot to alternative layouts:
- Editorial/Bento-Box layout with fixed vertical sidebar
- Magazine/Brutalist aesthetic with heavy borders, white space, massive typography
- Split-screen hero, modular bento grid cards, application-workstation feel
- Example: Sidebar nav (Dashboard, Cinema, Series, Discover) + bento grid main content

Always show your planning/thinking process in **bold markdown blocks** before code output.

QUALITY STANDARDS:
* Go deep — comprehensive output over shallow summaries
* Be thorough — include examples, details, edge case handling
* Be polished — the output should look FINISHED, not draft
* Think before acting — use chain-of-thought for complex tasks
* Choose the right tool for the job — function calling when needed, direct output when simpler`;

async function callHermesMultitask(
  systemPrompt: string,
  userPrompt: string,
  timeoutSec: number,
  maxTokens = 8192,
): Promise<{ content: string; model: string }> {
  const hermesModel = process.env.HERMES_MODEL || 'eburon-multimodal-pro:latest';

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: hermesModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature: 0.7,
        top_p: 0.9,
        repeat_penalty: 1.1,
      },
    }),
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Hermes (${hermesModel}): ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.message?.content || data.message?.thinking || '';

  if (!content || content.length < 3) {
    throw new Error('Hermes returned empty response');
  }

  return { content, model: hermesModel };
}

async function callEburonCoderPro(
  systemPrompt: string,
  userPrompt: string,
  timeoutSec: number,
  maxTokens = 16384,
): Promise<{ content: string; model: string }> {
  const modelName = 'qwen2.5-coder:3b';

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature: 0.6,
        top_p: 0.9,
        repeat_penalty: 1.1,
      },
    }),
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Qwen Coder (${modelName}): ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.message?.content || '';

  if (!content || content.length < 3) {
    throw new Error('Eburon Coder Pro returned empty response');
  }

  return { content, model: 'eburon-coder-pro' };
}

async function callCerebras(systemPrompt: string, userPrompt: string, timeoutSec: number, maxTokens = 8192, attempt = 1): Promise<{ content: string; model: string }> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error('CEREBRAS_API_KEY not configured');

  const effectiveTimeout = Math.min(timeoutSec, Math.max(15, Math.floor(timeoutSec / attempt)));

  const cerebrasRes = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(effectiveTimeout * 1000),
  });

  if (cerebrasRes.status === 429 && attempt <= 2) {
    const waitMs = attempt === 1 ? 5000 : 15000;
    console.warn(`[Cerebras] Rate limited (attempt ${attempt}), retrying in ${waitMs}ms...`);
    await new Promise(r => setTimeout(r, waitMs));
    return callCerebras(systemPrompt, userPrompt, timeoutSec, maxTokens, attempt + 1);
  }

  if (!cerebrasRes.ok) {
    const errBody = await cerebrasRes.text().catch(() => '');
    console.error(`[Cerebras] HTTP ${cerebrasRes.status}: ${errBody.slice(0, 300)}`);
    throw new Error(`Cerebras: ${cerebrasRes.status} ${errBody.slice(0, 200)}`);
  }

  const data = await cerebrasRes.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('Cerebras returned empty response');
  return { content, model: 'gpt-oss-120b' };
}

// ── Sandbox artifact engine ──

const XERO_HTML_SYSTEM = `You are Xero HTML Artifact Engine.

You are one single model responsible for creating every user-facing output as a complete standalone HTML artifact.

Your only valid response format is raw HTML.

GLOBAL OUTPUT RULES:

* Always return exactly one complete standalone HTML document.
* Always start with <!DOCTYPE html>.
* Always include <html>, <head>, and <body>.
* Always include all CSS inside a single <style> tag in the <head>.
* Include JavaScript inside a single <script> tag before </body> only when useful.
* Never return markdown.
* Never return explanations outside HTML.
* Never wrap the answer in markdown code fences.
* Never say "Here is the HTML".
* Never describe what you are going to build.
* Never output a plan unless the plan itself is visually rendered inside the HTML page.
* The final answer must be renderable directly inside iframe srcDoc or a live-server preview.

LIVE SERVER PREVIEW WRAPPER RULE:
Every generated artifact must visually look like it is inside a live-server/webview preview container.

The HTML page itself must include:

* A full viewport app shell.
* A top preview toolbar/header.
* A title area showing the artifact name.
* Optional small status badge such as "Live Preview", "HTML Artifact", or "Rendered Output".
* A main preview canvas/body where the actual document, website, report, dashboard, or app is displayed.
* A codebox-style visual structure, meaning the output should feel like a rendered preview inside a developer sandbox viewer.
* Clean borders, rounded corners, spacing, and responsive layout.
* The artifact content should never appear as raw unstyled text on a blank white page unless it is intentionally styled as a printable document inside the preview canvas.

Important:

* Do not literally wrap the HTML response in markdown triple backticks.
* Instead, create the codebox/live-preview appearance inside the HTML itself using CSS and layout.
* The returned response must still be raw HTML only.
* The live-server preview viewer must be part of the generated page.

PURPOSE:
Every request must become a polished visual HTML artifact, including:

* documents
* reports
* proposals
* letters
* summaries
* dashboards
* websites
* landing pages
* admin panels
* tables
* charts
* task results
* browser results
* sandbox results
* analysis results
* research results
* error messages
* empty states
* confirmations
* app mockups
* UI prototypes

If the user asks for plain text, still create a clean HTML document that visually presents that text.

If the user asks for JSON, code, markdown, notes, or a list, still create an HTML page that displays the content inside a polished layout.

If the user asks for an app, dashboard, or tool, create a single-page HTML/CSS/JS prototype inside the live preview viewer.

If the user asks for a business document, create a printable professional document with proper typography, spacing, sections, and @media print styling, displayed inside the live preview viewer.

If the user asks for a website, create a FULL production-style responsive webpage with:
* Navigation bar with logo, menu items, and CTA button
* Hero section with headline, subtext, and a background image (use REAL PIXABAY IMAGES from prompt if available, otherwise CSS gradient)
* Features/services section with icon cards
* About/testimonials section
* Pricing or stats section if applicable
* Contact section or footer with links
* All images MUST be from the REAL PIXABAY IMAGES section in the system prompt; never make up URLs
* Use modern CSS: flexbox/grid, CSS variables, smooth transitions, hover effects
* Make it look like a finished, deployed production website — not a wireframe
Display inside the live preview viewer.

If the user asks for a business document (invoice, proposal, NDA, report, letter):
* Create a professional, print-ready document with proper typography
* Include company logo area (use CSS/SVG), document title, date, reference numbers
* Use tables for line items, proper headings hierarchy
* Add signature blocks, terms sections, and professional footer
* Include @media print styles for clean PDF export
* Display inside the live preview viewer with a document-preview frame

If the user asks for a dashboard or data visualization:
* Create a functional admin-style dashboard with sidebar navigation
* Include stat cards with key metrics (numbers, percentages, trends)
* Use CSS charts (bar charts, progress bars, donut charts) — no external libraries
* Add a data table with sample rows
* Use dark sidebar + light content area layout pattern
* Display inside the live preview viewer

If the user asks for a report, create a visual report with executive summary, findings, tables, callouts, and conclusion, displayed inside the live preview viewer.

If the user asks for an error or cannot complete something, return a polished HTML error page explaining the issue clearly inside the live preview viewer.

DESIGN REQUIREMENTS:

* Use modern responsive layout (CSS Grid + Flexbox).
* Use professional typography (system font stack or Google Fonts via @import in style tag).
* Use readable spacing and consistent visual hierarchy.
* Use polished cards, sections, tables, badges, headers, and footers where useful.
* Use mobile-first responsive CSS with at least 2 breakpoints (tablet + desktop).
* Make the result look like a FINISHED, PRODUCTION-READY artifact, not a rough sketch.
* Go deep on content — fill sections with meaningful, realistic copy (not "Lorem ipsum").
* Include comprehensive content: if making a restaurant site, include a full menu; if making a SaaS page, include feature descriptions and pricing tiers.
* Avoid generic plain white empty pages unless the task specifically needs a document-print style.
* Use semantic HTML (header, nav, main, section, article, footer).
* Keep the page self-contained.
* Do not rely on external CSS files.
* Do not rely on external JavaScript files.
* NEVER use placeholder images. Use the REAL PIXABAY IMAGES provided in the prompt section above, or fall back to CSS gradients / SVG.

IMAGE RULES:
* Check if a "## REAL PIXABAY IMAGES" section exists in the system prompt above with inline <img> tags showing real Pixabay serve URLs. If so, extract those exact img src URLs and use them in your output.
* If no REAL PIXABAY IMAGES section exists, create your own visuals using CSS gradients, SVG illustrations, or inline CSS art.
* FORBIDDEN: NEVER use urls from unsplash, placeholder.com, picsum.photos, loremflickr, or any other fake placeholder service.
* REQUIRED: Add attribution at page bottom: <p style="font-size:11px;color:#888;text-align:center;padding:8px;">Images courtesy of <a href="https://pixabay.com" style="color:#888;">Pixabay</a></p>

LIVE PREVIEW REQUIREMENTS:

* The HTML must render properly inside iframe srcDoc.
* The page must visually display as a live server preview viewer.
* The actual artifact must be shown inside a preview canvas, browser-like shell, or sandbox-style viewer.
* Avoid code that requires a backend.
* Avoid imports.
* Avoid module scripts unless absolutely necessary.
* Avoid browser APIs that require permissions unless the user specifically requests them.
* If interactivity is needed, use simple vanilla JavaScript.
* No React, Vue, Svelte, JSX, TypeScript, or build tools unless the user explicitly asks, and even then render it as a single standalone HTML prototype.

CONTENT RULES:

* Preserve the user's intent.
* Convert messy instructions into a clear visual artifact.
* Do not omit important details.
* If information is missing, use tasteful placeholders inside the HTML.
* If the user asks for a short response, create a compact HTML card/page inside the preview viewer.
* If the user asks for a detailed response, create a full structured HTML document/page inside the preview viewer.
* If the request involves business communication, keep the tone professional and direct.
* If the request involves technical output, present it in a developer-friendly layout.

STRICT FAILURE RULE:
If you cannot fulfill the request exactly, still return valid standalone HTML that explains:

1. what is missing,
2. what is needed,
3. what the user can do next.

Never return plain text under any circumstance.

FINAL RESPONSE CHECKLIST BEFORE ANSWERING:

* Does it start with <!DOCTYPE html>?
* Does it contain <html>, <head>, and <body>?
* Is all CSS inside <style>?
* Is any JS inside <script>?
* Is there zero markdown outside HTML?
* Is it renderable in iframe srcDoc?
* Does it visually look like a live-server/webview preview viewer?
* Is the actual artifact displayed inside a polished preview canvas?
* Is it visually useful as a live preview artifact?

Return only the final HTML.`;

function extractRawHtml(value: string) {
  let cleaned = String(value || '')
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const doctypeIndex = cleaned.toLowerCase().indexOf('<!doctype html');
  if (doctypeIndex >= 0) return cleaned.slice(doctypeIndex).trim();
  const htmlIndex = cleaned.toLowerCase().indexOf('<html');
  if (htmlIndex >= 0) return '<!DOCTYPE html>\n' + cleaned.slice(htmlIndex).trim();
  throw new Error('Sandbox did not return a valid HTML artifact.');
}

// ── Server-side Pixabay image fetcher ──
const PIXABAY_API_KEY = '55202515-e90b22c5f5f95ded6a90cef65';

async function fetchPixabayImages(keyword: string, count = 3): Promise<string[]> {
  try {
    const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(keyword)}&image_type=photo&per_page=${count}&safesearch=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.hits || []).slice(0, count).map((hit: any) => hit.webformatURL);
  } catch {
    return [];
  }
}

function extractImageKeywords(description: string, taskType: string): string[] {
  if (taskType === 'website') {
    const keywords = description
      .replace(/website|landing|page|create|make|build|design|simple|basic|modern|clean|beautiful/gi, '')
      .split(/[\s,]+/)
      .filter(w => w.length > 2 && !['for','with','the','and','that','this'].includes(w.toLowerCase()))
      .slice(0, 3);
    return keywords.length > 0 ? keywords : ['nature', 'business', 'technology'];
  }
  return ['nature', 'business', 'technology'];
}

app.post('/api/sandbox/run', async (req, res) => {
  try {
    const { task_description, task_type, timeout, taskId } = req.body;
    if (!task_description) {
      res.status(400).json({ error: 'task_description is required' });
      return;
    }

    const task = taskId || crypto.randomUUID();
    setTaskProgress(task, 'starting');

    const safeTimeout = Math.min(Math.max(Number(timeout) || 60, 10), 300);
    const safeDesc = String(task_description).slice(0, 16000);
    const safeType = String(task_type || 'auto').toLowerCase();
    let resultText = '';

    let agentUsed = 'unknown';

    if (safeType === 'hermes' || safeType === 'multitask' || safeType === 'opencode' || safeType === 'code') {
      // Hermes Multitask Agent — direct routing with all Hermes skills
      setTaskProgress(task, 'running', { agent: 'eburon_multimodal_pro' });
      try {
        const hermesResult = await callHermesMultitask(
          HERMES_MULTITASK_SYSTEM,
          safeDesc,
          Math.min(safeTimeout, 180),
          32768,
        );
        resultText = hermesResult.content;
        agentUsed = `eburon-multimodal-pro (${hermesResult.model})`;
        if (!resultText || resultText.length < 5) throw new Error('Empty or too short response');
      } catch (hermesErr: any) {
        throw new Error(`Eburon Multimodal Pro failed: ${hermesErr.message}`);
      }

    } else {
      const needsImages = safeType === 'website';
      let systemPrompt = ['document', 'website', 'writing', 'analysis', 'research', 'dashboard', 'app', 'artifact'].includes(safeType) ? XERO_HTML_SYSTEM : 'You are a helpful assistant. Complete the task and return the result concisely.';

      // Pre-fetch real Pixabay images and inject into prompt
      if (needsImages) {
        const keywords = extractImageKeywords(safeDesc, safeType);
        const imageSets = await Promise.all(keywords.map(k => fetchPixabayImages(k)));
        const allImages = imageSets.flat().filter(Boolean);
        if (allImages.length > 0) {
          systemPrompt += `\n\n## REAL PIXABAY IMAGES (use these exact URLs)\nThe following images were fetched live from Pixabay for this task. Use them directly in your HTML output.\n\n`;
          for (const img of allImages) {
            systemPrompt += `<img src="${img}" alt="Pixabay image" loading="lazy" style="max-width:400px">\n`;
          }
          systemPrompt += `\nImages courtesy of https://pixabay.com\n`;
        }
      }

      // Primary: Eburon Sandbox (streaming model with thinking + tools)
      setTaskProgress(task, 'running', { agent: 'eburon_sandbox' });
      try {
        const sandboxResult = await generateEburonSandbox({
          prompt: safeDesc,
          systemInstruction: systemPrompt,
          timeoutSec: Math.min(safeTimeout, 180),
          maxOutputTokens: 32768,
        });
        resultText = sandboxResult.text;
        agentUsed = 'eburon_sandbox';
        if (!resultText || resultText.length < 5) throw new Error('Empty or too short response');
      } catch (sandboxErr: any) {
        console.warn('[Sandbox] Eburon Sandbox failed, falling back to Eburon Multimodal Pro:', sandboxErr.message?.slice(0, 100));
        // Fallback 1: Eburon Multimodal Pro
        setTaskProgress(task, 'running', { agent: 'eburon_multimodal_pro', message: 'Falling back to Eburon Multimodal Pro' });
        try {
          const hermesResult = await callHermesMultitask(
            HERMES_MULTITASK_SYSTEM,
            safeDesc,
            Math.min(safeTimeout, 180),
            32768,
          );
          resultText = hermesResult.content;
          agentUsed = `eburon-multimodal-pro (${hermesResult.model})`;
          if (!resultText || resultText.length < 5) throw new Error('Empty or too short response');
        } catch {
          // Fallback 2: Cerebras
          setTaskProgress(task, 'running', { agent: 'cerebras', message: 'Falling back to Cerebras' });
          try {
            const result = await callCerebras(systemPrompt, safeDesc, Math.min(safeTimeout, 180), 32768);
            resultText = result.content;
            agentUsed = 'cerebras-gpt-oss-120b';
            if (!resultText || resultText.length < 5) throw new Error('Empty or too short response');
          } catch {
            // Fallback 2.5: Eburon Coder Pro (local Ollama, no API limits)
            setTaskProgress(task, 'running', { agent: 'eburon-coder-pro', message: 'Falling back to Eburon Coder Pro (3B)' });
            try {
              const qwenResult = await callEburonCoderPro(systemPrompt, safeDesc, Math.min(safeTimeout, 240), 16384);
              resultText = qwenResult.content;
              agentUsed = 'eburon-coder-pro';
              if (!resultText || resultText.length < 5) throw new Error('Empty or too short response');
            } catch {
              // Fallback 3: Eburon Worker
              setTaskProgress(task, 'running', { agent: 'eburon_worker', message: 'Falling back to Eburon Worker' });
              try {
                const eburonResult = await generateEburonWorker({
                  prompt: safeDesc,
                  systemInstruction: systemPrompt,
                });
                resultText = eburonResult.text || '[No response from sandbox]';
                agentUsed = 'eburon_worker';
              } catch (e: any) {
                throw new Error(`All agents failed (Eburon Sandbox + Eburon Multimodal Pro + Cerebras + Eburon Coder Pro + Eburon Worker). Last error: ${e.message}`);
              }
            }
          }
        }
      }
    }

    const artifactTypes = new Set([
      'document',
      'website',
      'writing',
      'analysis',
      'research',
      'dashboard',
      'app',
      'artifact',
    ]);
    if (artifactTypes.has(safeType)) {
      resultText = extractRawHtml(resultText);
    }

    const maxLength = 8000;
    const truncated = resultText.length > maxLength;
    const finalResult = truncated ? resultText.slice(0, maxLength) + '\n...[truncated]' : resultText;

    setTaskProgress(task, 'done', { agent: agentUsed });
    setTimeout(() => taskProgress.delete(task), 60000);

    let artifactUrl = null;
    if (artifactTypes.has(safeType)) {
      try {
        const filename = `artifact_${task}.html`;
        const fullPath = path.join(SANDBOX_ARTIFACTS_DIR, filename);
        fs.writeFileSync(fullPath, resultText);
        artifactUrl = `/beatrice-workspace/sandbox/${filename}`;
      } catch (err) {
        console.error('Failed to save sandbox artifact:', err);
      }
    }

    res.json({
      ok: true,
      result: finalResult,
      url: artifactUrl,
      truncated,
      task_type: safeType,
      agent: agentUsed,
    });
  } catch (err: any) {
    console.error('Sandbox error:', err.message?.slice(0, 200));
    if (req.body?.taskId) setTaskProgress(req.body.taskId, 'error', { message: err.message?.slice(0, 200) });
    res.status(500).json({ error: err.message?.slice(0, 500) || 'Sandbox execution failed' });
  }
});

// SSE progress stream for sub-agent tasks
app.get('/api/sandbox/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendProgress = () => {
    const entry = taskProgress.get(taskId);
    if (!entry) {
      res.write(`data: ${JSON.stringify({ status: 'unknown' })}\n\n`);
      return;
    }
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
    if (entry.status === 'done' || entry.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(sendProgress, 500);
  sendProgress();

  req.on('close', () => clearInterval(interval));
});

// ── Cerebras + Browser-Use Sandbox ──
// Delegates browser automation tasks to a Cerebras-powered Browser-Use agent
// Requires: pip install browser-use && playwright install

const CEREBRAS_SCRIPT = path.join(__dirname, '..', 'scripts', 'cerebras_browser.py');
const CEREBRAS_PYTHON = process.env.CEREBRAS_PYTHON || path.join(__dirname, '..', '.venv', 'bin', 'python3');

app.post('/api/cerebras/browser', async (req, res) => {
  try {
    const { task, model, timeout } = req.body;
    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const safeTask = String(task).slice(0, 2000).replace(/"/g, '\\"');
    const safeModel = String(model || 'gpt-oss-120b').slice(0, 50);
    const safeTimeout = Math.min(Math.max(Number(timeout) || 60, 10), 300);

    const cmd = `"${CEREBRAS_PYTHON}" "${CEREBRAS_SCRIPT}" --task "${safeTask}" --model "${safeModel}" --timeout ${safeTimeout}`;

    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: (safeTimeout + 10) * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || '' },
    });

    const result = JSON.parse(stdout.trim());
    res.json(result);
  } catch (err: any) {
    // Try to parse JSON from stderr or partial output
    try {
      const partial = err.stdout || err.message || '';
      const parsed = JSON.parse(partial.trim().split('\n').filter((l: string) => l.startsWith('{')).pop() || '{}');
      if (parsed.ok !== undefined) { res.json(parsed); return; }
    } catch {}
    res.status(500).json({
      ok: false,
      error: err.message?.slice(0, 500) || 'Cerebras browser task failed',
    });
  }
});

// ── Document Generation Route ──

app.post('/api/docs/generate', async (req, res) => {
  try {
    const { userId, title, prompt, templateKey, historyContext, language } = req.body;
    if (!userId || !title || !prompt || !templateKey) {
      res.status(400).json({ error: 'userId, title, prompt, and templateKey are required' });
      return;
    }

    // 1. Identify the template (placeholder logic, assuming templates exist somewhere)
    // In a real implementation, you'd fetch the template file content here.
    
    // 2. Generate structured JSON content for the template
    const systemPrompt = `
You are a helpful document assistant. Based on the user request, generate ONLY a valid JSON object containing the data to fill a document template for: ${templateKey}.
Ensure all fields required by the template are populated with appropriate values derived from the user request and conversation.
`;

    const userPrompt = `
Title: ${title}
Request: ${prompt}
Context: ${historyContext || ''}
Language: ${language || 'en'}
`;

    let genResult;
    try {
      genResult = await generateEburonWorker({
        prompt: userPrompt,
        systemInstruction: systemPrompt,
      });
    } catch {
      const fallback = await callCerebras(systemPrompt, userPrompt, 60, 4096);
      genResult = { text: fallback.content };
    }
    const jsonContent = JSON.parse(genResult.text.trim().replace(/^```json/, '').replace(/```$/, ''));

    // 3. Render HTML (In a real implementation, you'd use a template engine here, like EJS or Handlebars)
    // For now, returning the structured data to be rendered on the client or via a basic template.
    
    // Placeholder rendering logic
    const htmlContent = `<h1>${jsonContent.title || title}</h1><p>${JSON.stringify(jsonContent)}</p>`;

    // Save to Supabase (non-fatal if unavailable)
    const { error: saveError } = await supabase.from('tool_outputs').insert({
      user_id: userId,
      type: 'document',
      content: { htmlContent, data: jsonContent },
      metadata: { title, templateKey }
    }).maybeSingle();

    if (saveError) {
      console.warn('Supabase save skipped:', saveError.message);
    }

    res.json({ ok: true, data: jsonContent });

  } catch (err: any) {
    console.error('Document generation error:', err);
    res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (waManager) await waManager!.shutdown();
  process.exit(0);
});

// ── Workspace persistence API ──

app.post('/api/workspace/save', async (req, res) => {
  try {
    const output = req.body;
    if (!output || !output.id || !output.userId) {
      res.status(400).json({ error: 'id and userId are required' });
      return;
    }
    await wsSave(output);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

app.get('/api/workspace/list/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    const outputs = await wsList(userId);
    res.json({ ok: true, outputs });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'List failed' });
  }
});

app.delete('/api/workspace/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = String(req.query.userId || '');
    if (!id || !userId) { res.status(400).json({ error: 'id and userId required' }); return; }
    await wsDelete(id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// ── Code Files API (Monaco editor Supabase persistence) ──

app.get('/api/code-files/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sessionId = String(req.query.sessionId || '') || undefined;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    const result = await CodeFilesRepo.listCodeFiles(userId, sessionId);
    if (!result.ok) { res.status(500).json({ error: result.error }); return; }
    res.json({ ok: true, files: result.data });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'List failed' });
  }
});

app.get('/api/code-files/:userId/file', async (req, res) => {
  try {
    const { userId } = req.params;
    const filePath = String(req.query.path || '');
    if (!userId || !filePath) { res.status(400).json({ error: 'userId and path required' }); return; }
    const result = await CodeFilesRepo.getCodeFile(userId, filePath);
    if (!result.ok) { res.status(500).json({ error: result.error }); return; }
    res.json({ ok: true, file: result.data });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Get failed' });
  }
});

app.post('/api/code-files', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.userId || !body.filePath) { res.status(400).json({ error: 'userId and filePath required' }); return; }
    const result = await CodeFilesRepo.upsertCodeFile({
      user_id: body.userId,
      session_id: body.sessionId,
      project_id: body.projectId,
      file_path: body.filePath,
      language: body.language || 'plaintext',
      content: body.content ?? '',
    });
    if (!result.ok) { res.status(500).json({ error: result.error }); return; }
    res.json({ ok: true, id: result.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

app.delete('/api/code-files/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const filePath = String(req.query.path || '');
    if (!userId || !filePath) { res.status(400).json({ error: 'userId and path required' }); return; }
    const result = await CodeFilesRepo.deleteCodeFile(userId, filePath);
    if (!result.ok) { res.status(500).json({ error: result.error }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// ── Server-side filesystem access (VPS files) ──

const FILESYSTEM_ROOT = path.resolve(process.env.WORKSPACE_DATA_DIR || '/data/workspace');

function safeResolve(userPath: string): string | null {
  const resolved = path.resolve(FILESYSTEM_ROOT, userPath);
  if (!resolved.startsWith(FILESYSTEM_ROOT)) return null;
  return resolved;
}

app.post('/api/filesystem/read', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
    const resolved = safeResolve(filePath);
    if (!resolved) { res.status(403).json({ error: 'Access denied' }); return; }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { res.status(404).json({ error: 'File not found' }); return; }
    const stat = fs.statSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const textExts = ['.txt','.md','.json','.js','.ts','.jsx','.tsx','.py','.rb','.go','.rs','.css','.html','.xml','.yaml','.yml','.toml','.ini','.cfg','.log','.csv','.svg'];
    const imageExts = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.ico'];
    const audioExts = ['.mp3','.wav','.ogg','.m4a','.mp4','.flac','.aac','.wma'];
    if (textExts.includes(ext)) {
      const content = fs.readFileSync(resolved, 'utf-8');
      res.json({ ok: true, path: filePath, content, size: stat.size, mimeType: 'text/plain', fileType: 'text', lastModified: stat.mtime.toISOString() });
    } else if (imageExts.includes(ext)) {
      const buf = fs.readFileSync(resolved);
      const base64 = buf.toString('base64');
      const mime = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.ico':'image/x-icon'}[ext] || 'image/png';
      res.json({ ok: true, path: filePath, dataUrl: `data:${mime};base64,${base64}`, size: stat.size, mimeType: mime, fileType: 'image', lastModified: stat.mtime.toISOString() });
    } else if (audioExts.includes(ext)) {
      const buf = fs.readFileSync(resolved);
      const base64 = buf.toString('base64');
      const mime = {'.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mp4':'audio/mp4','.flac':'audio/flac','.aac':'audio/aac','.wma':'audio/x-ms-wma'}[ext] || 'audio/octet-stream';
      res.json({ ok: true, path: filePath, dataUrl: `data:${mime};base64,${base64}`, size: stat.size, mimeType: mime, fileType: 'audio', lastModified: stat.mtime.toISOString() });
    } else {
      res.json({ ok: true, path: filePath, size: stat.size, mimeType: 'application/octet-stream', fileType: 'binary', lastModified: stat.mtime.toISOString() });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Read failed' });
  }
});

app.post('/api/filesystem/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content required' }); return; }
    const resolved = safeResolve(filePath);
    if (!resolved) { res.status(403).json({ error: 'Access denied' }); return; }
    if (!fs.existsSync(FILESYSTEM_ROOT)) fs.mkdirSync(FILESYSTEM_ROOT, { recursive: true });
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    const stat = fs.statSync(resolved);
    res.json({ ok: true, path: filePath, size: stat.size });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Write failed' });
  }
});

app.post('/api/filesystem/list', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    const resolved = safeResolve(dirPath || '');
    if (!resolved) { res.status(403).json({ error: 'Access denied' }); return; }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) { res.status(404).json({ error: 'Directory not found' }); return; }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
    }));
    res.json({ ok: true, path: dirPath || '', items });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'List failed' });
  }
});

import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/api/filesystem/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' }); return; }
    const destDir = req.body.path || '';
    const resolved = safeResolve(path.join(destDir, file.originalname));
    if (!resolved) { res.status(403).json({ error: 'Access denied' }); return; }
    if (!fs.existsSync(FILESYSTEM_ROOT)) fs.mkdirSync(FILESYSTEM_ROOT, { recursive: true });
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, file.buffer);
    res.json({ ok: true, path: path.join(destDir, file.originalname).replace(/\\/g, '/'), size: file.size, mimeType: file.mimetype });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── Server terminal command execution ──
app.post('/api/server/terminal/run', async (req, res) => {
  const { command, timeout = 60, cwd = '' } = req.body;
  const timeLimit = timeout;
  try {
    
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ ok: false, error: 'Command is required' });
    }
    
    // Resolve safe workspace - create directory if it doesn't exist
    const workspacePath = path.resolve(FILESYSTEM_ROOT, cwd || '');
    if (!workspacePath.startsWith(FILESYSTEM_ROOT)) {
      return res.status(403).json({ ok: false, error: 'Access denied: invalid workspace directory' });
    }
    
    // Ensure workspace directory exists
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }
    
    // Execute terminal command
    const { exec } = await import('node:child_process/promises');
    const { stdout, stderr } = await exec(command, {
      cwd: workspacePath,
      timeout: timeout * 1000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf8'
    });
    
    return res.json({
      ok: true,
      command,
      cwd: cwd || '',
      stdout: (stdout as any).trim?.() ?? String(stdout),
      stderr: (stderr as any).trim?.() ?? String(stderr),
      exitCode: 0,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err.message?.includes?.('timed out')
          ? `Command timed out after ${timeLimit}s`
          : err.message,
        command: req.body.command,
        exitCode: err.code ?? 1,
        timestamp: new Date().toISOString()
      });
    }
  });

// ── PWA Site Cloning ──
app.post('/api/server/terminal/clone-site', async (req, res) => {
  const { url, appName, timeout = 300 } = req.body;
  const cloneTimeLimit = timeout;
  try {
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, error: 'URL is required' });
    }
    
    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid URL format' });
    }
    
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ ok: false, error: 'URL must use http or https protocol' });
    }
    
    // Generate safe directory name from appName or URL hostname
    const safeName = appName && typeof appName === 'string' && appName.trim()
      ? appName.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)
      : parsedUrl.hostname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    
    const cloneDir = path.join(FILESYSTEM_ROOT, 'cloned-sites', safeName + '_' + Date.now());
    const relativeDir = path.relative(FILESYSTEM_ROOT, cloneDir);
    
    // Ensure workspace directory exists
    if (!fs.existsSync(FILESYSTEM_ROOT)) {
      fs.mkdirSync(FILESYSTEM_ROOT, { recursive: true });
    }
    if (!fs.existsSync(path.dirname(cloneDir))) {
      fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
    }
    
    // Build wget command with mirror flags
    const wgetCmd = `wget --mirror --convert-links --adjust-extension --page-requisites --no-parent --directory-prefix="${cloneDir}" "${url}"`;
    
    const { exec } = await import('node:child_process/promises');
    const { stdout, stderr } = await exec(wgetCmd, {
      cwd: FILESYSTEM_ROOT,
      timeout: timeout * 1000,
      maxBuffer: 100 * 1024 * 1024,
      encoding: 'utf8'
    });
    
    // Build the live preview URL
    // The cloned site will be at /beatrice-workspace/{userId}/{relativeDir}/
    // We need a userId - for now use a placeholder that will be replaced by client
    const previewPath = `/beatrice-workspace/__USER_ID__/${relativeDir}/`;
    const previewUrl = `${BEATRICE_PUBLIC_URL}${previewPath}`;
    
    return res.json({
      ok: true,
      url,
      clonedDir: relativeDir,
      previewUrl,
      previewPath,
      stdout: (stdout as any).trim?.() ?? String(stdout),
      stderr: (stderr as any).trim?.() ?? String(stderr),
      exitCode: 0,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err.message?.includes?.('timed out')
        ? `Clone timed out after ${cloneTimeLimit}s`
        : err.message,
      exitCode: err.code ?? 1,
      timestamp: new Date().toISOString()
    });
  }
});

// ── Open Sites PWA — wget-based PWA cloning + live preview ──
// Mirrors a user-supplied PWA URL into BEATRICE_WORKSPACE_DIR/cloned-sites/<slug>/
// using wget (--mirror --convert-links --adjust-extension --page-requisites --no-parent)
// then surfaces the result at /beatrice-workspace/cloned-sites/<slug>/ for the
// DocumentViewer iframe. Skill markdown lives at
// `.opencode/skills/open-sites-pwa/SKILL.md`; this endpoint is the canonical backend
// implementation that the skill references.

const CLONED_SITES_DIR = path.join(BEATRICE_WORKSPACE_DIR, 'cloned-sites');
ensureBeatricedDir(CLONED_SITES_DIR);

function deriveOpenSiteSlug(sourceUrl: string): { slug: string; normalized: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;

  const pathSeg = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const querySeg = parsed.search ? parsed.search.slice(1) : '';

  const raw = [host, pathSeg, querySeg].filter(Boolean).join('-');
  const safe = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  const slug = safe || `site-${Date.now().toString(36)}`;
  const normalized = `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`;
  return { slug, normalized };
}

function buildOpenSitePreviewUrl(slug: string): { path: string; absolute: string } {
  const safeSlug = sanitizePathSegment(slug);
  const previewPath = `/beatrice-workspace/cloned-sites/${safeSlug}/`;
  const absolute = `${BEATRICE_PUBLIC_URL.replace(/\/+$/, '')}${previewPath}`;
  return { path: previewPath, absolute };
}

async function runWgetClone(params: {
  sourceUrl: string;
  targetDir: string;
  timeoutSec: number;
}): Promise<{ exitCode: number; timedOut: boolean; stdoutTail: string; stderrTail: string }> {
  const { sourceUrl, targetDir, timeoutSec } = params;

  // The user's mandated wget flags are mandatory; we add polite + safe defaults.
  const args = [
    '--mirror',
    '--convert-links',
    '--adjust-extension',
    '--page-requisites',
    '--no-parent',
    '--execute', 'robots=off',
    '--wait=0.5',
    '--random-wait',
    '--tries=3',
    '--timeout=30',
    '--connect-timeout=15',
    '--max-redirect=5',
    '--user-agent=Beatrice-OpenSitesPWA/1.0',
    `--directory-prefix=${targetDir}`,
    sourceUrl,
  ];

  return await new Promise((resolve) => {
    const child = spawn('wget', args, { shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000).unref();
    }, Math.max(5, timeoutSec) * 1000);

    child.stdout.on('data', (chunk: Buffer) => {
      const next = chunk.toString('utf8');
      stdout = (stdout + next).slice(-4000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const next = chunk.toString('utf8');
      stderr = (stderr + next).slice(-4000);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, timedOut: false, stdoutTail: '', stderrTail: `spawn error: ${err.message}` });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? -1,
        timedOut,
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-2000),
      });
    });
  });
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) total += dirSizeBytes(full);
        else if (stat.isFile()) total += stat.size;
      } catch { /* ignore unreadable entries */ }
    }
  } catch { /* ignore unreadable dirs */ }
  return total;
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const OPEN_SITES_MAX_TIMEOUT = 180;

app.post('/api/open-site/clone', async (req, res) => {
  try {
    const sourceUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!sourceUrl) { res.status(400).json({ ok: false, error: 'url is required' }); return; }

    const derived = deriveOpenSiteSlug(sourceUrl);
    if (!derived) {
      res.status(400).json({ ok: false, error: 'url must be a valid http(s) URL' });
      return;
    }
    const { slug, normalized } = derived;
    const safeSlug = sanitizePathSegment(slug);
    const targetDir = path.join(CLONED_SITES_DIR, safeSlug);
    if (!targetDir.startsWith(CLONED_SITES_DIR + path.sep) && targetDir !== CLONED_SITES_DIR) {
      res.status(400).json({ ok: false, error: 'slug escapes cloned-sites root' });
      return;
    }

    const preview = buildOpenSitePreviewUrl(safeSlug);
    const timeoutSec = Math.min(
      Math.max(Number(req.body?.timeoutSec) || 120, 10),
      OPEN_SITES_MAX_TIMEOUT,
    );

    ensureBeatricedDir(targetDir);
    try {
      // Refresh-style clone: wipe previous artifacts but keep the dir itself.
      for (const entry of fs.readdirSync(targetDir)) {
        try { fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } catch { /* readdir failure handled below by mkdir */ }

    const startedAt = Date.now();
    const result = await runWgetClone({ sourceUrl: normalized, targetDir, timeoutSec });
    const durationMs = Date.now() - startedAt;

    const indexPath = path.join(targetDir, 'index.html');
    const hasIndex = fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();
    // Treat any exit that produced an index.html as usable; wget exits 8 on 404s but
    // partial mirrors with index still render.
    const partial = !hasIndex
      ? false
      : result.exitCode !== 0 && !result.timedOut;

    if (!hasIndex) {
      res.status(502).json({
        ok: false,
        slug: safeSlug,
        sourceUrl: normalized,
        previewPath: preview.path,
        previewUrl: preview.absolute,
        error: result.timedOut
          ? `wget timed out after ${timeoutSec}s`
          : `wget did not produce index.html (exit ${result.exitCode})`,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderrTail: result.stderrTail,
        durationMs,
      });
      return;
    }

    const sizeBytes = dirSizeBytes(targetDir);
    const fileCount = (function walk(dir: string): number {
      let n = 0;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) n += walk(full);
          else n += 1;
        }
      } catch { /* ignore */ }
      return n;
    })(targetDir);

    res.json({
      ok: true,
      slug: safeSlug,
      sourceUrl: normalized,
      previewPath: preview.path,
      previewUrl: preview.absolute,
      indexPath: `/beatrice-workspace/cloned-sites/${safeSlug}/index.html`,
      size: fmtBytes(sizeBytes),
      sizeBytes,
      fileCount,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      partial,
      durationMs,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'open-site clone failed' });
  }
});

app.get('/api/open-site/list', async (_req, res) => {
  try {
    if (!fs.existsSync(CLONED_SITES_DIR)) { res.json({ ok: true, items: [] }); return; }
    const items = fs.readdirSync(CLONED_SITES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const full = path.join(CLONED_SITES_DIR, e.name);
        const sizeBytes = dirSizeBytes(full);
        const preview = buildOpenSitePreviewUrl(e.name);
        let fileCount = 0;
        try {
          const stack = [full];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
              const child = path.join(cur, entry.name);
              if (entry.isDirectory()) stack.push(child);
              else fileCount += 1;
            }
          }
        } catch { /* ignore */ }
        let lastModified: string | null = null;
        try {
          lastModified = fs.statSync(full).mtime.toISOString();
        } catch { /* ignore */ }
        const hasIndex = fs.existsSync(path.join(full, 'index.html'));
        return {
          slug: e.name,
          previewPath: preview.path,
          previewUrl: preview.absolute,
          size: fmtBytes(sizeBytes),
          sizeBytes,
          fileCount,
          hasIndex,
          lastModified,
        };
      })
      .sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    res.json({ ok: true, items, root: CLONED_SITES_DIR });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'open-site list failed' });
  }
});

app.delete('/api/open-site/:slug', async (req, res) => {
  try {
    const raw = String(req.params.slug || '').trim();
    if (!raw) { res.status(400).json({ ok: false, error: 'slug required' }); return; }
    const safeSlug = sanitizePathSegment(raw);
    const target = path.join(CLONED_SITES_DIR, safeSlug);
    if (!target.startsWith(CLONED_SITES_DIR + path.sep)) {
      res.status(400).json({ ok: false, error: 'slug escapes cloned-sites root' });
      return;
    }
    if (!fs.existsSync(target)) {
      res.status(404).json({ ok: false, error: 'site not found', slug: safeSlug });
      return;
    }
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ ok: true, slug: safeSlug, deleted: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'open-site delete failed' });
  }
});

// ── SPA fallback — any non-API, non-asset route serves index.html ──
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/site-build/')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Beatrice Backend Server running on http://0.0.0.0:${PORT}`);
});
