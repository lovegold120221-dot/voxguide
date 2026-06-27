// ── Fast Multimodal Skills client (Eburon AI) ──
// Typed streaming client for /api/ai/fast-multimodal and /api/ai/code-completion.
import { getBackendUrl } from './whatsappClient';

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

export interface FastMultimodalParams {
  userId: string;
  sessionId?: string;
  skill?: FastMultimodalSkill;
  prompt: string;
  systemInstruction?: string;
  inlineData?: { mimeType: string; data: string };
  ocrMode?: FastMultimodalOcrMode;
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

export type FastMultimodalEvent =
  | { type: 'start'; skill: Exclude<FastMultimodalSkill, 'auto'>; requestId: string }
  | { type: 'chunk'; text: string }
  | { type: 'sources'; sources: FastMultimodalSource[] }
  | { type: 'done'; skill: Exclude<FastMultimodalSkill, 'auto'>; usage?: { inputTokens: number; outputTokens: number }; requestId: string }
  | { type: 'error'; message: string; code?: string };

export interface FastMultimodalResult {
  text: string;
  skill: Exclude<FastMultimodalSkill, 'auto'>;
  sources: FastMultimodalSource[];
  error?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent?: (event: FastMultimodalEvent) => void;
  onChunk?: (text: string) => void;
}

function buildBody(params: FastMultimodalParams, endpoint: 'fast-multimodal' | 'code-completion') {
  if (endpoint === 'code-completion') {
    return {
      userId: params.userId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      systemInstruction: params.systemInstruction,
      codeContext: params.codeContext,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      timeoutSec: params.timeoutSec,
    };
  }
  return {
    userId: params.userId,
    sessionId: params.sessionId,
    skill: params.skill || 'auto',
    prompt: params.prompt,
    systemInstruction: params.systemInstruction,
    inlineData: params.inlineData,
    ocrMode: params.ocrMode,
    fileUri: params.fileUri,
    fileMimeType: params.fileMimeType,
    codeContext: params.codeContext,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    timeoutSec: params.timeoutSec,
  };
}

async function streamEndpoint(
  endpoint: 'fast-multimodal' | 'code-completion',
  params: FastMultimodalParams,
  options: StreamOptions = {},
): Promise<FastMultimodalResult> {
  const res = await fetch(`${getBackendUrl()}/api/ai/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(params, endpoint)),
    signal: options.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as any)?.error || `Eburon AI request failed (${res.status})`;
    options.onEvent?.({ type: 'error', message, code: `http_${res.status}` });
    return { text: '', skill: 'google_grounding', sources: [], error: message };
  }

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let skill: Exclude<FastMultimodalSkill, 'auto'> = 'google_grounding';
  const sources: FastMultimodalSource[] = [];
  let error: string | undefined;

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
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as FastMultimodalEvent;
          switch (event.type) {
            case 'start':
              skill = event.skill;
              options.onEvent?.(event);
              break;
            case 'chunk':
              text += event.text;
              options.onChunk?.(event.text);
              options.onEvent?.(event);
              break;
            case 'sources':
              for (const s of event.sources) sources.push(s);
              options.onEvent?.(event);
              break;
            case 'done':
              skill = event.skill;
              options.onEvent?.(event);
              break;
            case 'error':
              error = event.message;
              options.onEvent?.(event);
              break;
          }
        } catch {
          // skip unparseable line
        }
      }
    }
  }

  return { text, skill, sources, error };
}

export function streamFastMultimodal(
  params: FastMultimodalParams,
  options: StreamOptions = {},
): Promise<FastMultimodalResult> {
  return streamEndpoint('fast-multimodal', params, options);
}

export function streamCodeCompletion(
  params: FastMultimodalParams,
  options: StreamOptions = {},
): Promise<FastMultimodalResult> {
  return streamEndpoint('code-completion', params, options);
}

export async function fetchFastMultimodalSkills(): Promise<
  { id: Exclude<FastMultimodalSkill, 'auto'>; label: string; description: string }[]
> {
  const res = await fetch(`${getBackendUrl()}/api/ai/fast-multimodal/skills`);
  const data = await res.json().catch(() => ({}));
  return (data as any)?.skills || [];
}
