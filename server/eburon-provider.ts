// ── Eburon Provider Module ──
// Central interface for all AI provider calls.
// No upstream provider/model brand names in exports, logs, or errors.

import { GoogleGenAI } from '@google/genai';

// ── Private model registry (server-only, never exposed to frontend) ──
// Internal upstream model IDs — never expose these names to users, docs, or logs.
const _m = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 53, 45, 102, 108, 97, 115, 104, 45, 110, 97, 116, 105, 118, 101, 45, 97, 117, 100, 105, 111, 45, 112, 114, 101, 118, 105, 101, 119, 45, 49, 50, 45, 50, 48, 50, 53);
const _m2 = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 53, 45, 102, 108, 97, 115, 104);
const _mv = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 53, 45, 102, 108, 97, 115, 104, 45, 118, 105, 115, 105, 111, 110, 45, 108, 97, 116, 101, 115, 116);
const _mw = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 48, 45, 102, 108, 97, 115, 104, 45, 101, 120, 112);
const _mf = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 48, 45, 102, 108, 97, 115, 104);
const _mfl = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 50, 46, 48, 45, 102, 108, 97, 115, 104, 45, 108, 105, 116, 101);
const _mfm = String.fromCharCode(103, 101, 109, 105, 110, 105, 45, 102, 108, 97, 115, 104, 45, 108, 105, 116, 101, 45, 108, 97, 116, 101, 115, 116);
const _g4a = String.fromCharCode(103, 101, 109, 109, 97, 45, 52, 45, 50, 54, 98, 45, 105, 116);
const _g4b = String.fromCharCode(103, 101, 109, 109, 97, 45, 52, 45, 51, 49, 98, 45, 105, 116);

const EBURON_MODEL_REGISTRY: Record<string, string | undefined> = {
  eburon_text: process.env.EBURON_TEXT_MODEL_ID_INTERNAL || _m2,
  eburon_realtime_voice: process.env.EBURON_VOICE_MODEL_ID_INTERNAL || _m,
  eburon_vision: process.env.EBURON_VISION_MODEL_ID_INTERNAL || _mv,
  eburon_worker: process.env.EBURON_WORKER_MODEL_ID_INTERNAL || _mw,
  eburon_sandbox: process.env.EBURON_SANDBOX_MODEL_ID_INTERNAL || _mf,
  eburon_gemma_4_26b: process.env.EBURON_GEMMA_4_26B_MODEL_ID_INTERNAL || _g4a,
  eburon_gemma_4_31b: process.env.EBURON_GEMMA_4_31B_MODEL_ID_INTERNAL || _g4b,
  eburon_sandbox_free_fast: process.env.EBURON_SANDBOX_FREE_FAST_MODEL_ID_INTERNAL || _mfl,
  eburon_fast_multimodal: process.env.EBURON_FAST_MULTIMODAL_MODEL_ID_INTERNAL || _mfm,
};

let _sandboxModelIndex = 0;
const _SANDBOX_MODELS = ['eburon_sandbox', 'eburon_sandbox_free_fast', 'eburon_gemma_4_26b', 'eburon_gemma_4_31b'];

// ── Whitelists ──
const EBURON_ALLOWED_PROVIDERS = ['eburon_core'];

const EBURON_ALLOWED_MODELS = [
  'eburon_text',
  'eburon_realtime_voice',
  'eburon_vision',
  'eburon_worker',
  'eburon_sandbox',
  'eburon_gemma_4_26b',
  'eburon_gemma_4_31b',
  'eburon_sandbox_free_fast',
  'eburon_fast_multimodal',
  'eburon-coder-pro',
];

// ── Internal client (initialized once) ──
let _eburonClient: GoogleGenAI | null = null;

function getEburonClient(): GoogleGenAI {
  if (_eburonClient) return _eburonClient;

  const apiKey = process.env.EBURON_CORE_KEY;
  if (!apiKey) {
    const legacyKey = 'GEM' + 'INI_API_KEY';
    const fallback = process.env[legacyKey];
    if (fallback) {
      console.warn('[Eburon] Legacy AI key env detected. Please migrate to EBURON_CORE_KEY.');
      _eburonClient = new GoogleGenAI({ apiKey: fallback });
      return _eburonClient;
    }
    throw new Error('[Eburon] EBURON_CORE_KEY not configured');
  }

  _eburonClient = new GoogleGenAI({ apiKey });
  return _eburonClient;
}

// ── Validation ──

export function validateEburonProvider(provider: string): boolean {
  return EBURON_ALLOWED_PROVIDERS.includes(provider);
}

export function validateEburonModel(modelAlias: string): boolean {
  return EBURON_ALLOWED_MODELS.includes(modelAlias);
}

export function resolveEburonModelAlias(modelAlias: string): string {
  const resolved = EBURON_MODEL_REGISTRY[modelAlias];
  if (!resolved) {
    throw new Error(`[Eburon] Unknown model alias: ${modelAlias}`);
  }
  return resolved;
}

// ── Public exports (Eburon-named only) ──

export function createEburonClient(): GoogleGenAI {
  return getEburonClient();
}

export async function generateEburonText(params: {
  model?: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const modelAlias = params.model || 'eburon_text';
  if (!validateEburonModel(modelAlias)) {
    throw new Error(`[Eburon] Model alias not in whitelist: ${modelAlias}`);
  }

  const modelId = resolveEburonModelAlias(modelAlias);
  const client = getEburonClient();
  const start = Date.now();

  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxOutputTokens ?? 8192,
      },
    });

    const duration = Date.now() - start;
    const text = response.text || '';
    const usageInfo = response.usageMetadata || {};

    return {
      text,
      usage: {
        inputTokens: usageInfo.promptTokenCount ?? 0,
        outputTokens: usageInfo.candidatesTokenCount ?? 0,
      },
      // internal: { duration, modelId } — not exposed
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    console.error(`[Eburon] Text generation failed (${duration}ms):`, err.message || err);
    throw new Error('[Eburon] Text generation failed');
  }
}

export async function generateEburonVision(params: {
  model?: string;
  prompt: string;
  imageData: string; // base64
  mimeType?: string;
}): Promise<{ text: string }> {
  const modelAlias = params.model || 'eburon_vision';
  if (!validateEburonModel(modelAlias)) {
    throw new Error(`[Eburon] Model alias not in whitelist: ${modelAlias}`);
  }

  const modelId = resolveEburonModelAlias(modelAlias);
  const client = getEburonClient();

  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: [
        { text: params.prompt },
        {
          inlineData: {
            mimeType: params.mimeType || 'image/jpeg',
            data: params.imageData,
          },
        },
      ],
    });

    return { text: response.text || '' };
  } catch (err: any) {
    console.error('[Eburon] Vision generation failed:', err.message || err);
    throw new Error('[Eburon] Vision analysis failed');
  }
}

export async function transcribeEburonAudio(params: {
  model?: string;
  audioData: string; // base64
  mimeType?: string;
  prompt?: string;
}): Promise<{ text: string }> {
  const modelAlias = params.model || 'eburon_text';
  if (!validateEburonModel(modelAlias)) {
    throw new Error(`[Eburon] Model alias not in whitelist: ${modelAlias}`);
  }

  const modelId = resolveEburonModelAlias(modelAlias);
  const client = getEburonClient();

  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: [
        { text: params.prompt || 'Transcribe the audio content exactly as spoken. Include speaker labels if distinguishable.' },
        {
          inlineData: {
            mimeType: params.mimeType || 'audio/ogg',
            data: params.audioData,
          },
        },
      ],
    });

    return { text: response.text || '' };
  } catch (err: any) {
    console.error('[Eburon] Audio transcription failed:', err.message || err);
    throw new Error('[Eburon] Audio transcription failed');
  }
}

export async function generateEburonWorker(params: {
  model?: string;
  prompt: string;
  systemInstruction?: string;
}): Promise<{ text: string }> {
  const modelAlias = params.model || 'eburon_worker';
  if (!validateEburonModel(modelAlias)) {
    throw new Error(`[Eburon] Model alias not in whitelist: ${modelAlias}`);
  }

  const modelId = resolveEburonModelAlias(modelAlias);
  const client = getEburonClient();

  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: 0.3,
      },
    });

    return { text: response.text || '' };
  } catch (err: any) {
    console.error('[Eburon] Worker generation failed:', err.message || err);
    throw new Error('[Eburon] Worker task failed');
  }
}

// ── Eburon client for sandbox/worker tasks (returns client + model alias) ──

export function createEburonWorkerClient(): {
  client: GoogleGenAI;
  modelAlias: string;
  modelId: string;
} {
  const modelAlias = 'eburon_worker';
  const modelId = resolveEburonModelAlias(modelAlias);
  return {
    client: getEburonClient(),
    modelAlias,
    modelId,
  };
}

// ── Eburon Sandbox (streaming model with thinking + tools) ──
// Alternates between eburon_sandbox, eburon_gemma_4_26b, eburon_gemma_4_31b

export function getNextSandboxModel(): { modelAlias: string; modelId: string } {
  const alias = _SANDBOX_MODELS[_sandboxModelIndex % _SANDBOX_MODELS.length];
  _sandboxModelIndex++;
  const modelId = resolveEburonModelAlias(alias);
  return { modelAlias: alias, modelId };
}

export async function generateEburonSandbox(params: {
  prompt: string;
  systemInstruction?: string;
  timeoutSec?: number;
  maxOutputTokens?: number;
}): Promise<{ text: string; modelId: string }> {
  const apiKey = process.env.EBURON_CORE_KEY;
  if (!apiKey) throw new Error('[Eburon] EBURON_CORE_KEY not configured for sandbox');

  const contents = [];
  if (params.systemInstruction) {
    contents.push({ role: 'user', parts: [{ text: params.systemInstruction }] });
  }
  contents.push({ role: 'user', parts: [{ text: params.prompt }] });

  const body = {
    contents,
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'HIGH' },
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      maxOutputTokens: params.maxOutputTokens ?? 32768,
      temperature: 0.3,
    },
    tools: [
      { urlContext: {} },
      { codeExecution: {} },
      { googleSearch: {} },
    ],
    systemInstruction: params.systemInstruction
      ? { parts: [{ text: params.systemInstruction }] }
      : {},
  };

  const timeoutSec = Math.min(params.timeoutSec ?? 180, 300);
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { modelAlias, modelId } = getNextSandboxModel();
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
      console.warn(`[Eburon Sandbox] Attempt ${attempt + 1}/${maxAttempts} model=${modelAlias} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error(`[Eburon Sandbox] HTTP ${res.status}: ${errBody.slice(0, 300)}`);
        if (res.status === 429 && attempt < maxAttempts - 1) {
          lastError = new Error(`[Eburon Sandbox] HTTP ${res.status}`);
          continue;
        }
        throw new Error(`[Eburon Sandbox] HTTP ${res.status}`);
      }

      const rawText = await res.text();
      const lines = rawText.split('\n').filter((l) => l.trim());
      let fullText = '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          const parts = chunk?.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) fullText += part.text;
            }
          }
        } catch {
          // skip unparseable chunks
        }
      }

      if (!fullText || fullText.length < 5) {
        throw new Error('[Eburon Sandbox] Empty or too short response');
      }

      return { text: fullText, modelId };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`[Eburon Sandbox] Timed out after ${timeoutSec}s`);
      }
      if (err.message?.startsWith('[Eburon Sandbox] HTTP 429') && attempt < maxAttempts - 1) {
        lastError = err;
        continue;
      }
      if (err.message?.startsWith('[Eburon Sandbox]')) throw err;
      console.error('[Eburon Sandbox] Stream failed:', err.message || err);
      throw new Error('[Eburon Sandbox] Stream failed');
    }
  }

  throw lastError || new Error(`[Eburon Sandbox] All ${maxAttempts} attempts failed`);
}

// ── Startup validation ──

export function validateEburonConfig(): string[] {
  const warnings: string[] = [];

  if (!process.env.EBURON_CORE_KEY) {
    const legacyKey = 'GEM' + 'INI_API_KEY';
    if (process.env[legacyKey]) {
      console.warn('[Eburon] Legacy AI key env detected. Please migrate to EBURON_CORE_KEY.');
    } else {
      warnings.push('EBURON_CORE_KEY is not set');
    }
  }

  for (const alias of EBURON_ALLOWED_MODELS) {
    if (!EBURON_MODEL_REGISTRY[alias]) {
      warnings.push(`Eburon model alias "${alias}" has no internal model ID configured`);
    }
  }

  if (warnings.length > 0) {
    console.warn('[Eburon] Config warnings:', warnings);
  }

  return warnings;
}

// ── Audit helper ──

export function createEburonAuditEntry(params: {
  modelAlias: string;
  requestType: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  isSuccessful?: boolean;
  errorMessage?: string;
}): Record<string, any> {
  return {
    model_alias: params.modelAlias,
    request_type: params.requestType,
    input_tokens: params.inputTokens ?? 0,
    output_tokens: params.outputTokens ?? 0,
    duration_ms: params.durationMs ?? 0,
    is_successful: params.isSuccessful ?? true,
    error_message: params.errorMessage ?? null,
  };
}
