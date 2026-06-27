// ── useFastMultimodal ──
// Beatrice chat integration hook for the Fast Multimodal Skills.
// Streams an Eburon AI response and exposes ready-to-bind state.
import { useCallback, useRef, useState } from 'react';
import {
  streamFastMultimodal,
  type FastMultimodalParams,
  type FastMultimodalSource,
  type FastMultimodalEvent,
} from '../lib/fastMultimodalClient';

export interface UseFastMultimodalResult {
  isStreaming: boolean;
  streamingText: string;
  sources: FastMultimodalSource[];
  error: string | null;
  activeSkill: string | null;
  abort: () => void;
  run: (
    params: FastMultimodalParams,
    callbacks?: {
      onChunk?: (fullText: string, chunk: string) => void;
      onDone?: (result: { text: string; skill: string; sources: FastMultimodalSource[] }) => void;
      onError?: (message: string) => void;
      onEvent?: (event: FastMultimodalEvent) => void;
    },
  ) => Promise<{ text: string; skill: string; sources: FastMultimodalSource[]; error?: string }>;
}

export function useFastMultimodal(): UseFastMultimodalResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [sources, setSources] = useState<FastMultimodalSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const run = useCallback<UseFastMultimodalResult['run']>(async (params, callbacks) => {
    setError(null);
    setStreamingText('');
    setSources([]);
    setActiveSkill(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';

    const result = await streamFastMultimodal(params, {
      signal: controller.signal,
      onEvent: (event) => {
        callbacks?.onEvent?.(event);
        if (event.type === 'start') setActiveSkill(event.skill);
        if (event.type === 'chunk') {
          accumulated += event.text;
          setStreamingText(accumulated);
          callbacks?.onChunk?.(accumulated, event.text);
        }
        if (event.type === 'sources') {
          setSources((prev) => [...prev, ...event.sources]);
        }
        if (event.type === 'error') {
          setError(event.message);
          callbacks?.onError?.(event.message);
        }
      },
    });

    abortRef.current = null;
    setIsStreaming(false);

    if (!result.error) {
      callbacks?.onDone?.({ text: result.text, skill: result.skill, sources: result.sources });
    }

    return result;
  }, []);

  return { isStreaming, streamingText, sources, error, activeSkill, abort, run };
}
