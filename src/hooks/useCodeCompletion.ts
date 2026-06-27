// ── useCodeCompletion ──
// Monaco editor integration for the Eburon AI code_completion skill.
// Registers an inline (ghost-text) completion provider and exposes an
// explicit complete() helper for on-demand patch/full-file generation.
import { useCallback, useRef, useState } from 'react';
import { streamCodeCompletion, type FastMultimodalCodeContext, type FastMultimodalCodeIntent } from '../lib/fastMultimodalClient';

export interface CompleteParams {
  currentFile: { path: string; language: string; content: string };
  cursorPosition?: { line: number; column: number };
  selectedText?: string;
  projectContext?: string;
  intent?: FastMultimodalCodeIntent;
  prompt?: string;
}

export interface UseCodeCompletionResult {
  isCompleting: boolean;
  error: string | null;
  complete: (userId: string, params: CompleteParams) => Promise<string>;
  registerMonaco: (
    editor: any,
    monaco: any,
    getUserId: () => string,
    getSessionId?: () => string | undefined,
  ) => () => void;
}

function languageFromMonaco(monaco: any, model: any): string {
  try {
    const id = monaco.editor.getModelLanguageId?.(model) || model.getLanguageId?.();
    return id || 'plaintext';
  } catch {
    return 'plaintext';
  }
}

export function useCodeCompletion(): UseCodeCompletionResult {
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const complete = useCallback(async (userId: string, params: CompleteParams): Promise<string> => {
    setError(null);
    setIsCompleting(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const codeContext: FastMultimodalCodeContext = {
      currentFile: params.currentFile,
      cursorPosition: params.cursorPosition,
      selectedText: params.selectedText,
      projectContext: params.projectContext,
      intent: params.intent || 'completion',
    };

    try {
      const result = await streamCodeCompletion(
        { userId, prompt: params.prompt || '', codeContext, intent: params.intent as any } as any,
        { signal: controller.signal },
      );
      if (result.error) setError(result.error);
      return result.text;
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Completion failed');
      return '';
    } finally {
      setIsCompleting(false);
      abortRef.current = null;
    }
  }, []);

  const registerMonaco = useCallback<UseCodeCompletionResult['registerMonaco']>(
    (editor, monaco, getUserId, getSessionId) => {
      if (!editor || !monaco) return () => {};

      let timer: ReturnType<typeof setTimeout> | null = null;
      let activeController: AbortController | null = null;

      const provider = monaco.languages.registerInlineCompletionsProvider(
        { pattern: '**' },
        {
          async provideInlineCompletions(model: any, position: any, context: any, token: any) {
            const userId = getUserId();
            if (!userId) return null;
            if (token?.isCancellationRequested) return null;

            const language = languageFromMonaco(monaco, model);
            const content = model.getValue();
            const selectedText = editor.getSelection ? editor.getModel()?.getValueInRange(editor.getSelection()) : undefined;

            // Debounce: avoid firing on every keystroke.
            return new Promise((resolve) => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(async () => {
                if (token?.isCancellationRequested) { resolve(null); return; }
                activeController?.abort();
                activeController = new AbortController();

                try {
                  const result = await streamCodeCompletion(
                    {
                      userId,
                      sessionId: getSessionId?.(),
                      prompt: '',
                      codeContext: {
                        currentFile: { path: model.uri?.fsPath || 'current', language, content },
                        cursorPosition: { line: position.lineNumber, column: position.column },
                        selectedText: selectedText || undefined,
                        intent: 'completion',
                      },
                    },
                    { signal: activeController.signal },
                  );

                  if (!result.text || token?.isCancellationRequested) { resolve(null); return; }
                  resolve({
                    items: [
                      {
                        insertText: result.text,
                        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                      },
                    ],
                  });
                } catch {
                  resolve(null);
                }
              }, 650);
            });
          },
          handleItemDidAccept() {},
          freeInlineCompletions() {},
        },
      );

      return () => {
        provider?.dispose?.();
        if (timer) clearTimeout(timer);
        activeController?.abort();
      };
    },
    [],
  );

  return { isCompleting, error, complete, registerMonaco };
}
