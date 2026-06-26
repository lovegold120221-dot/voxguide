import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, FileCode, Eye, X, Copy, Check } from 'lucide-react';
import Editor, { loader } from '@monaco-editor/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Pre-load Monaco for faster tab switching
loader.init();

type TabKey = 'terminal' | 'files' | 'preview';

interface FileTab {
  path: string;
  language: string;
  content: string;
}

interface StreamEvent {
  type: 'stdout' | 'stderr' | 'file_written' | 'complete';
  text?: string;
  path?: string;
  result?: any;
}

interface LiveCodingPreviewProps {
  visible: boolean;
  taskId: string;
  appUrl?: string;
  appName?: string;
  onComplete?: (result: any) => void;
  onClose?: () => void;
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'html', htm: 'html', css: 'css', js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown',
    py: 'python', rb: 'ruby', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp',
    go: 'go', rs: 'rust', sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml',
    xml: 'xml', svg: 'xml', php: 'php', sql: 'sql', vue: 'html', svelte: 'html',
  };
  return map[ext] || 'plaintext';
}

export const LiveCodingPreview = memo(function LiveCodingPreview({
  visible,
  taskId,
  appUrl,
  appName,
  onComplete,
  onClose,
}: LiveCodingPreviewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('terminal');
  const [status, setStatus] = useState<'running' | 'complete' | 'error'>('running');
  const [copied, setCopied] = useState(false);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [previewKey, setPreviewKey] = useState(0);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const appUrlRef = useRef(appUrl);

  appUrlRef.current = appUrl;

  // ── Init xterm.js ──
  useEffect(() => {
    if (!visible || !terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0b',
        foreground: '#e0e0e0',
        green: '#10b981',
        red: '#ef4444',
        yellow: '#f59e0b',
        cyan: '#06b6d4',
        brightGreen: '#34d399',
        brightRed: '#f87171',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    xtermRef.current = term;

    term.open(terminalRef.current);

    // Fit after opening
    const fit = () => {
      try { fitAddon.fit(); } catch {}
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(terminalRef.current);
    const timer = setTimeout(fit, 100);

    term.writeln('Waiting for output...');

    return () => {
      clearTimeout(timer);
      ro.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [visible]);

  // ── Fit terminal when tab becomes active ──
  useEffect(() => {
    if (activeTab === 'terminal') {
      setTimeout(() => fitAddonRef.current?.fit(), 50);
    }
  }, [activeTab]);

  // ── SSE connection ──
  useEffect(() => {
    if (!visible || !taskId) return;

    // Reset state
    setStatus('running');
    setFileTabs([]);
    setActiveFileIdx(0);

    const es = new EventSource(`/api/coding-agent/stream/${taskId}`);
    eventSourceRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      if (e.data === ':heartbeat') return;
      try {
        const ev: StreamEvent = JSON.parse(e.data);
        switch (ev.type) {
          case 'stdout':
            if (xtermRef.current && ev.text) {
              xtermRef.current.write(ev.text.replace(/\n/g, '\r\n'));
            }
            break;
          case 'stderr':
            if (xtermRef.current && ev.text) {
              xtermRef.current.write(`\x1b[38;5;196m${ev.text.replace(/\n/g, '\r\n')}\x1b[0m`);
            }
            break;
          case 'file_written': {
            const fp = ev.path;
            if (!fp || fileTabs.some(f => f.path === fp)) break;
            // Fetch file content
            const baseUrl = appUrlRef.current;
            if (baseUrl) {
              const fileUrl = `${baseUrl.replace(/\/+$/, '')}/${fp.replace(/^\/+/, '')}`;
              fetch(fileUrl)
                .then(r => r.ok ? r.text() : null)
                .then(content => {
                  if (content !== null) {
                    setFileTabs(prev => [...prev, { path: fp, language: detectLanguage(fp), content }]);
                  }
                })
                .catch(() => {});
            }
            if (fp.includes('index.html')) setPreviewKey(k => k + 1);
            break;
          }
          case 'complete':
            setStatus(ev.result?.ok ? 'complete' : 'error');
            if (xtermRef.current) {
              xtermRef.current.writeln('');
              xtermRef.current.writeln(ev.result?.ok
                ? '\r\n\x1b[38;5;46m✓ Task completed successfully\x1b[0m'
                : '\r\n\x1b[38;5;196m✗ Task failed\x1b[0m');
            }
            es.close();
            onComplete?.(ev.result);
            break;
        }
      } catch {}
    };

    es.onerror = () => {
      setStatus('error');
      if (xtermRef.current) {
        xtermRef.current.writeln('\r\n\x1b[38;5;196mConnection lost\x1b[0m');
      }
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [visible, taskId, onComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyUrl = useCallback(() => {
    if (appUrl) {
      navigator.clipboard.writeText(appUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  }, [appUrl]);

  const handleClose = useCallback(() => {
    eventSourceRef.current?.close();
    onClose?.();
  }, [onClose]);

  const tabs: { key: TabKey; label: string; icon: typeof Terminal; badge?: number }[] = [
    { key: 'terminal', label: 'Terminal', icon: Terminal, badge: undefined },
    { key: 'files', label: 'Files', icon: FileCode, badge: fileTabs.length },
    { key: 'preview', label: 'Preview', icon: Eye, badge: appUrl ? 1 : 0 },
  ];

  const activeFile = fileTabs[activeFileIdx] || null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          className="fixed inset-4 z-[300] flex flex-col bg-[#0a0a0b]/95 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${status === 'running' ? 'bg-amber-400 animate-pulse' : status === 'complete' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-semibold text-white">{appName || 'Coding Assistant'}</span>
              <span className="text-[11px] text-zinc-500">
                {status === 'running' ? 'Running...' : status === 'complete' ? 'Complete' : 'Failed'}
              </span>
              {appUrl && (
                <button
                  onClick={handleCopyUrl}
                  className="flex items-center gap-1 text-[11px] text-amber-400/80 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy URL'}
                </button>
              )}
            </div>
            <button onClick={handleClose} className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Tabs ── */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab.key
                      ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full">{tab.badge}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Content ── */}
          <div className="flex-1 min-h-0">
            {/* Terminal */}
            {activeTab === 'terminal' && (
              <div ref={terminalRef} className="h-full w-full" />
            )}

            {/* Files */}
            {activeTab === 'files' && (
              <div className="flex h-full">
                {/* File sidebar */}
                <div className="w-48 shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/30">
                  {fileTabs.length === 0 && (
                    <div className="text-zinc-500 text-xs p-3">Waiting for files...</div>
                  )}
                  {fileTabs.map((f, i) => (
                    <button
                      key={f.path}
                      onClick={() => setActiveFileIdx(i)}
                      className={`w-full text-left px-3 py-2 text-xs truncate transition-colors cursor-pointer ${
                        i === activeFileIdx
                          ? 'bg-amber-500/10 text-amber-400 border-l-2 border-amber-400'
                          : 'text-zinc-400 hover:bg-zinc-800/50'
                      }`}
                    >
                      {f.path}
                    </button>
                  ))}
                </div>
                {/* Editor */}
                <div className="flex-1">
                  {activeFile ? (
                    <Editor
                      key={activeFile.path}
                      defaultLanguage={activeFile.language}
                      defaultValue={activeFile.content}
                      theme="vs-dark"
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        padding: { top: 8 },
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                      No files available yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preview */}
            {activeTab === 'preview' && (
              <div className="h-full bg-white rounded-b-2xl overflow-hidden">
                {appUrl ? (
                  <iframe
                    key={previewKey}
                    src={appUrl}
                    className="w-full h-full border-0"
                    title="Live Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                    No preview URL available.
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
