// ── Fast Multimodal Skills (Eburon AI) ──
// Server-side multimodal skill router built on the fast model flow.
// Streams responses via REST streamGenerateContent (SSE).
// No upstream provider/model brand names are exposed to clients.

import { resolveEburonModelAlias } from './eburon-provider';
import { MessagesRepo, MemoryRepo, EburonRepo } from './db';

// ── Public types ──

export type FastMultimodalSkill =
  | 'url_context'
  | 'google_grounding'
  | 'youtube_analysis'
  | 'ocr'
  | 'code_completion'
  | 'auto';

export type FastMultimodalOcrMode = 'ocr_only' | 'visual_analysis';
export type FastMultimodalCodeIntent = 'completion' | 'patch' | 'full_file';

export interface FastMultimodalCodeContext {
  currentFile?: { path: string; language: string; content: string };
  cursorPosition?: { line: number; column: number };
  selectedText?: string;
  projectContext?: string;
  intent?: FastMultimodalCodeIntent;
}

export interface FastMultimodalRequest {
  userId: string;
  sessionId?: string;
  skill: FastMultimodalSkill;
  prompt: string;
  systemInstruction?: string;
  /** Base64 image/PDF for OCR. */
  inlineData?: { mimeType: string; data: string };
  ocrMode?: FastMultimodalOcrMode;
  /** Video / YouTube URL sent as fileData. */
  fileUri?: string;
  fileMimeType?: string;
  codeContext?: FastMultimodalCodeContext;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutSec?: number;
}

export interface FastMultimodalSource {
  uri: string;
  title?: string;
}

export type FastMultimodalSseEvent =
  | { type: 'start'; skill: Exclude<FastMultimodalSkill, 'auto'>; requestId: string }
  | { type: 'chunk'; text: string }
  | { type: 'sources'; sources: FastMultimodalSource[] }
  | { type: 'done'; skill: Exclude<FastMultimodalSkill, 'auto'>; usage?: { inputTokens: number; outputTokens: number }; requestId: string }
  | { type: 'error'; message: string; code?: string };

export interface FastMultimodalSkillInfo {
  id: Exclude<FastMultimodalSkill, 'auto'>;
  label: string;
  description: string;
}

export const FAST_MULTIMODAL_MODEL_ALIAS = 'eburon_fast_multimodal';

export const FAST_MULTIMODAL_SKILLS: FastMultimodalSkillInfo[] = [
  { id: 'url_context', label: 'URL Context', description: 'Read a URL and answer questions from it.' },
  { id: 'google_grounding', label: 'Live Search', description: 'Grounded answers for current/latest/research questions.' },
  { id: 'youtube_analysis', label: 'YouTube', description: 'Summarize a YouTube video: key points, tools, timestamps.' },
  { id: 'ocr', label: 'Image / OCR', description: 'Extract text, tables, and visual context from images or PDFs.' },
  { id: 'code_completion', label: 'Code', description: 'Inline completion, patch, or full-file suggestion for the editor.' },
];

// ── API key resolution (server env only, never sent to frontend) ──

function resolveFastMultimodalKey(): string {
  const primary = process.env.EBURON_AI_API_KEY;
  if (primary) return primary;
  const canonical = process.env.EBURON_CORE_KEY;
  if (canonical) return canonical;
  const legacyKey = 'GEM' + 'INI_API_KEY';
  const legacy = process.env[legacyKey];
  if (legacy) {
    console.warn('[FastMultimodal] Legacy AI key env detected. Please migrate to EBURON_AI_API_KEY or EBURON_CORE_KEY.');
    return legacy;
  }
  return '';
}

// ── Rate limiting (in-memory token bucket per user) ──

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const rateBuckets = new Map<string, { count: number; reset: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + RATE_WINDOW_MS };
    rateBuckets.set(userId, bucket);
  }
  if (bucket.count >= RATE_MAX_REQUESTS) return false;
  bucket.count++;
  return true;
}

// ── Skill router (auto mode) ──

function extractYouTubeUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+[^\s]*/i);
  return m ? m[0] : null;
}

export function routeSkill(req: FastMultimodalRequest): Exclude<FastMultimodalSkill, 'auto'> {
  if (req.inlineData) return 'ocr';
  if (req.fileUri) return 'youtube_analysis';
  if (req.codeContext?.currentFile) return 'code_completion';
  const text = req.prompt || '';
  if (extractYouTubeUrl(text)) return 'youtube_analysis';
  if (/https?:\/\//i.test(text)) return 'url_context';
  if (/\b(current|latest|today|recent|news|research|price|prices|weather|score|scores|stock|who is|when|where|happening)\b/i.test(text)) {
    return 'google_grounding';
  }
  return 'google_grounding';
}

// ── Request body builder ──

function buildStreamBody(req: FastMultimodalRequest, skill: Exclude<FastMultimodalSkill, 'auto'>) {
  const parts: any[] = [];
  const tools: any[] = [];
  let systemInstruction = req.systemInstruction;

  switch (skill) {
    case 'url_context': {
      tools.push({ urlContext: {} });
      parts.push({ text: req.prompt || 'Summarize the URL and answer any questions about it.' });
      break;
    }
    case 'google_grounding': {
      tools.push({ googleSearch: {} });
      parts.push({ text: req.prompt });
      break;
    }
    case 'youtube_analysis': {
      const ytUrl = req.fileUri || extractYouTubeUrl(req.prompt || '');
      if (ytUrl) {
        parts.push({ fileData: { fileUri: ytUrl, mimeType: req.fileMimeType || 'video/*' } });
      }
      parts.push({
        text: req.prompt
          ? `Analyze this video and answer: ${req.prompt}`
          : 'Analyze this video. Return: a concise summary, key points, any tools/products mentioned, and timestamps if available.',
      });
      break;
    }
    case 'ocr': {
      if (req.inlineData) {
        parts.push({ inlineData: { mimeType: req.inlineData.mimeType, data: req.inlineData.data } });
      }
      const ocrOnly = req.ocrMode === 'ocr_only';
      const baseInstruction = ocrOnly
        ? 'Extract ALL visible text exactly as shown (OCR mode). Preserve layout, tables, UI labels, and document content. Do not interpret or summarize.'
        : 'Perform visual analysis: extract visible text, tables, UI labels, and document content, AND explain the image context and what is shown.';
      parts.push({ text: req.prompt ? `${baseInstruction}\n\nUser request: ${req.prompt}` : baseInstruction });
      break;
    }
    case 'code_completion': {
      const cc = req.codeContext || {};
      const intent = cc.intent || 'completion';
      const lines: string[] = [];
      lines.push(`You are an inline code completion engine. Intent: ${intent}.`);
      if (cc.currentFile) {
        lines.push(`File: ${cc.currentFile.path} (${cc.currentFile.language})`);
        lines.push('```');
        lines.push(cc.currentFile.content);
        lines.push('```');
      }
      if (cc.cursorPosition) lines.push(`Cursor at line ${cc.cursorPosition.line}, column ${cc.cursorPosition.column}.`);
      if (cc.selectedText) {
        lines.push('Selected text:');
        lines.push('```');
        lines.push(cc.selectedText);
        lines.push('```');
      }
      if (cc.projectContext) lines.push(`Project context:\n${cc.projectContext}`);
      lines.push(`User intent: ${req.prompt || 'complete the code at the cursor'}`);
      if (intent === 'full_file') {
        lines.push('Return the COMPLETE updated file only, inside a single fenced code block.');
      } else if (intent === 'patch') {
        lines.push('Return a minimal unified diff patch only, inside a single fenced code block.');
      } else {
        lines.push('Return ONLY the completion text to insert at the cursor. No prose, no markdown fences.');
      }
      parts.push({ text: lines.join('\n\n') });
      break;
    }
  }

  const contents = [{ role: 'user', parts }];

  const generationConfig: Record<string, any> = {
    maxOutputTokens: req.maxOutputTokens ?? 8192,
    temperature: req.temperature ?? 0.3,
  };
  if (skill === 'ocr' || skill === 'youtube_analysis') {
    generationConfig.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
  }

  const body: Record<string, any> = { contents, generationConfig };
  if (tools.length) body.tools = tools;
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  return body;
}

// ── Error sanitization (never leak keys / model names) ──

function sanitizeError(status: number): string {
  if (status === 400) return 'Invalid request. Please check your input.';
  if (status === 401 || status === 403) return 'Eburon AI authentication failed.';
  if (status === 404) return 'The requested model is unavailable.';
  if (status === 429) return 'Eburon AI is busy. Please try again shortly.';
  if (status >= 500) return 'Eburon AI service error. Please retry.';
  return `Eburon AI request failed (${status}).`;
}

function dedupSources(sources: FastMultimodalSource[]): FastMultimodalSource[] {
  const seen = new Set<string>();
  const out: FastMultimodalSource[] = [];
  for (const s of sources) {
    if (!s.uri || seen.has(s.uri)) continue;
    seen.add(s.uri);
    out.push(s);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Persistence (messages + memory + audit) ──

async function persistResult(
  req: FastMultimodalRequest,
  skill: Exclude<FastMultimodalSkill, 'auto'>,
  text: string,
  startMs: number,
  success: boolean,
  errMsg?: string,
  usage?: { inputTokens: number; outputTokens: number },
) {
  const durationMs = Date.now() - startMs;

  if (success && text) {
    await MessagesRepo.saveMessage({
      user_id: req.userId,
      session_id: req.sessionId,
      role: 'model',
      text,
      tool_name: 'fast_multimodal',
      tool_input: { skill, prompt: (req.prompt || '').slice(0, 500) },
      metadata: { skill, source: 'eburon_fast_multimodal' },
    }).catch(() => {});
    await MemoryRepo.saveMemoryRecord({
      user_id: req.userId,
      session_id: req.sessionId,
      content: text.slice(0, 2000),
      summary: `${skill} result`,
      memory_type: 'context',
      source: 'fast_multimodal',
      tags: [skill],
      importance_score: 2,
      recency_score: 1,
      confidence_score: 1,
      metadata: { skill },
    }).catch(() => {});
  }

  await EburonRepo.logEburonRequest({
    user_id: req.userId,
    model_alias: FAST_MULTIMODAL_MODEL_ALIAS,
    request_type: `fast_multimodal:${skill}`,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    duration_ms: durationMs,
    is_successful: success,
    error_message: errMsg,
    request_metadata: { skill },
  }).catch(() => {});
}

// ── Streaming entry point ──

export async function streamFastMultimodal(
  req: FastMultimodalRequest,
  send: (event: FastMultimodalSseEvent) => void,
): Promise<void> {
  const startMs = Date.now();
  const requestId = `${req.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedSkill = req.skill === 'auto' ? routeSkill(req) : req.skill;

  send({ type: 'start', skill: resolvedSkill, requestId });

  if (!req.userId) {
    send({ type: 'error', message: 'userId is required.', code: 'bad_request' });
    return;
  }
  if (!checkRateLimit(req.userId)) {
    send({ type: 'error', message: 'Rate limit exceeded. Please slow down.', code: 'rate_limited' });
    return;
  }

  const apiKey = resolveFastMultimodalKey();
  if (!apiKey) {
    send({ type: 'error', message: 'Eburon AI is not configured.', code: 'not_configured' });
    return;
  }

  let modelId: string;
  try {
    modelId = resolveEburonModelAlias(FAST_MULTIMODAL_MODEL_ALIAS);
  } catch {
    send({ type: 'error', message: 'Eburon AI model is not configured.', code: 'not_configured' });
    return;
  }

  const body = buildStreamBody(req, resolvedSkill);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const timeoutSec = Math.min(req.timeoutSec ?? 120, 300);
  const maxAttempts = 3;

  let fullText = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[FastMultimodal] HTTP ${res.status}: ${errBody.slice(0, 300)}`);
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }
        send({ type: 'error', message: sanitizeError(res.status), code: `http_${res.status}` });
        await persistResult(req, resolvedSkill, fullText, startMs, false, `HTTP ${res.status}`);
        return;
      }

      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedSources: FastMultimodalSource[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              const candidate = chunk?.candidates?.[0];
              const parts = candidate?.content?.parts;
              if (Array.isArray(parts)) {
                for (const p of parts) {
                  if (p.thought) continue;
                  if (typeof p.text === 'string' && p.text) {
                    fullText += p.text;
                    send({ type: 'chunk', text: p.text });
                  }
                }
              }
              const gm = candidate?.groundingMetadata;
              if (gm?.groundingChunks) {
                for (const gc of gm.groundingChunks) {
                  if (gc?.web?.uri) {
                    collectedSources.push({ uri: gc.web.uri, title: gc.web.title });
                  }
                }
              }
              if (chunk?.usageMetadata) {
                usage = {
                  inputTokens: chunk.usageMetadata.promptTokenCount || 0,
                  outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
                };
              }
            } catch {
              // skip unparseable SSE line
            }
          }
        }
      }

      if (collectedSources.length) {
        send({ type: 'sources', sources: dedupSources(collectedSources) });
      }

      if (!fullText) {
        send({ type: 'error', message: 'No response was generated. Try rephrasing.', code: 'empty' });
        await persistResult(req, resolvedSkill, '', startMs, false, 'empty response');
        return;
      }

      send({ type: 'done', skill: resolvedSkill, usage, requestId });
      await persistResult(req, resolvedSkill, fullText, startMs, true, undefined, usage);
      return;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        send({ type: 'error', message: `Request timed out after ${timeoutSec}s.`, code: 'timeout' });
        await persistResult(req, resolvedSkill, fullText, startMs, false, 'timeout');
        return;
      }
      if (attempt < maxAttempts - 1) {
        lastError = err;
        continue;
      }
      console.error('[FastMultimodal] Stream failed:', err?.message || err);
      send({ type: 'error', message: 'Eburon AI stream failed. Please try again.', code: 'stream_failed' });
      await persistResult(req, resolvedSkill, fullText, startMs, false, err?.message || 'stream failed');
      return;
    }
  }

  send({ type: 'error', message: 'Eburon AI stream failed after retries.', code: 'exhausted' });
  await persistResult(req, resolvedSkill, fullText, startMs, false, lastError?.message || 'exhausted');
}

// ── Config validation for startup ──

export function validateFastMultimodalConfig(): string[] {
  const warnings: string[] = [];
  if (!resolveFastMultimodalKey()) {
    warnings.push('EBURON_AI_API_KEY (or EBURON_CORE_KEY) not configured — fast-multimodal skills disabled.');
  }
  return warnings;
}
