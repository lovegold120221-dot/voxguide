// ── Live Coding Preview ──
// Displays real-time generation results with an interactive Monaco editor.
// Supports AI code completion and automatic Supabase persistence for manual edits.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal, FileCode, Eye, X, Copy, Check, Monitor, Tablet, Smartphone,
  Loader2, ChevronDown, ChevronRight, RefreshCw, GripVertical, Wand2
} from 'lucide-react';
import Editor, { loader } from '@monaco-editor/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useCodeFiles } from '../hooks/useCodeFiles';
import { useCodeCompletion } from '../hooks/useCodeCompletion';

// Pre-load Monaco for faster tab switching
loader.init();

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
  userId: string;
  appUrl?: string;
  appName?: string;
  onComplete?: (result: any) => void;
  onClose?: () => void;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';
type MobileTab = 'generation' | 'preview';

const VIEWPORT_WIDTHS: Record<ViewportSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

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
  userId,
  appUrl,
  appName,
  onComplete,
  onClose,
}: LiveCodingPreviewProps) {
  const [status, setStatus] = useState<'running' | 'complete' | 'error'>('running');
  const [copied, setCopied] = useState(false);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const fileTabsRef = useRef<FileTab[]>([]);
  fileTabsRef.current = fileTabs;
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [previewKey, setPreviewKey] = useState(0);
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('generation');
  const [isDragging, setIsDragging] = useState(false);
  const [dividerPos, setDividerPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const appUrlRef = useRef(appUrl);
  const editorRef = useRef<any>(null);
  const dividerPosRef = useRef(50);

  appUrlRef.current = appUrl;

  const { files: _unused, scheduleSave, loadFile } = useCodeFiles(userId);
  const { registerMonaco, isCompleting, complete } = useCodeCompletion();

  // ── Detect mobile ──
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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

  // ── Fit terminal when panel becomes visible ──
  useEffect(() => {
    setTimeout(() => fitAddonRef.current?.fit(), 50);
  }, [visible, filesExpanded, isMobile, mobileTab]);

  // ── SSE connection ──
  useEffect(() => {
    if (!visible || !taskId) return;

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
            if (!fp || fileTabsRef.current.some(f => f.path === fp)) break;
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

  const handleRefreshPreview = useCallback(() => {
    setPreviewKey(k => k + 1);
  }, []);

  // ── Draggable divider logic ──
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const container = containerRef.current;
    if (!container) return;

    const startX = e.clientX;
    const startPos = dividerPosRef.current;
    const containerWidth = container.offsetWidth;

    const handleMouseMove = (moveE: MouseEvent) => {
      const dx = moveE.clientX - startX;
      const pct = Math.min(75, Math.max(25, startPos + (dx / containerWidth) * 100));
      dividerPosRef.current = pct;
      setDividerPos(pct);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Re-fit terminal after resize settles
      setTimeout(() => fitAddonRef.current?.fit(), 50);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [dividerPos]);

  const activeFile = fileTabs[activeFileIdx] || null;

  // ── Cosmic loading - stable random data memoized once ──
  const cosmicData = useMemo(() => {
    const seedRandom = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };
    };
    const rng = seedRandom(42);
    const colors = ['#fff', '#fde68a', '#93c5fd', '#e2e8f0'];
    return {
      stars: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        size: rng() * 2 + 1,
        left: rng() * 100,
        top: rng() * 100,
        color: colors[Math.floor(rng() * colors.length)],
        opacity: rng() * 0.5 + 0.3,
        duration: rng() * 3 + 2,
        delay: rng() * 3,
      })),
      particles: Array.from({ length: 6 }, (_, i) => ({
        id: i,
        left: rng() * 60 + 20,
        top: rng() * 60 + 20,
        xDrift: rng() * 20 - 10,
        duration: rng() * 3 + 3,
        delay: rng() * 3,
      })),
    };
  }, []);

  // ── Preview panel content (shared between desktop and mobile) ──
  const renderPreview = () => (
    <div className="flex flex-col h-full">
      {/* Viewport toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/40 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Preview</span>
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
          <button
            onClick={() => setViewport('desktop')}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              viewport === 'desktop'
                ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
            title="Desktop view"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('tablet')}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              viewport === 'tablet'
                ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
            title="Tablet view"
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('mobile')}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              viewport === 'mobile'
                ? 'bg-amber-500/20 text-amber-400 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
            title="Mobile view"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 bg-zinc-900/30 relative overflow-hidden flex items-start justify-center pt-3 pb-3 min-h-0">
        <AnimatePresence mode="wait">
        {appUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative overflow-hidden bg-white shadow-2xl transition-all duration-300 rounded-lg"
            style={{
              width: VIEWPORT_WIDTHS[viewport],
              height: viewport === 'mobile' ? '640px' : '100%',
              maxHeight: '100%',
              maxWidth: '100%',
            }}
          >
            {/* Mobile notch decoration */}
            {viewport === 'mobile' && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 w-24 h-5 bg-black rounded-b-xl flex items-center justify-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
              </div>
            )}
            <iframe
              key={previewKey}
              src={appUrl}
              className="w-full h-full border-0"
              title="Live Preview"
              sandbox="allow-scripts allow-same-origin allow-forms"
              style={viewport === 'mobile' ? { paddingTop: '20px' } : undefined}
            />
          </motion.div>
        ) : (
          <motion.div
            key="cosmic"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden">
            {/* Cosmic background */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#05070a] via-[#0a0e1a] to-[#0f1425]" />

            {/* Nebula orbs */}
            <div className="absolute w-[500px] h-[500px] rounded-full bg-gradient-to-br from-violet-600/10 via-purple-800/8 to-transparent blur-3xl animate-pulse"
              style={{ animationDuration: '6s', top: '10%', left: '20%' }} />
            <div className="absolute w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-amber-500/8 via-orange-600/6 to-transparent blur-3xl animate-pulse"
              style={{ animationDuration: '8s', animationDelay: '2s', bottom: '15%', right: '10%' }} />
            <div className="absolute w-[350px] h-[350px] rounded-full bg-gradient-to-bl from-blue-500/8 via-cyan-600/6 to-transparent blur-3xl animate-pulse"
              style={{ animationDuration: '7s', animationDelay: '4s', top: '50%', left: '60%' }} />

            {/* Stars grid - stable positions from memoized data */}
            <div className="absolute inset-0 overflow-hidden">
              {cosmicData.stars.map((s: { id: number; size: number; left: number; top: number; color: string; opacity: number; duration: number; delay: number }) => (
                <div
                  key={s.id}
                  className="absolute rounded-full animate-pulse"
                  style={{
                    width: `${s.size}px`,
                    height: `${s.size}px`,
                    left: `${s.left}%`,
                    top: `${s.top}%`,
                    backgroundColor: s.color,
                    opacity: s.opacity,
                    animationDuration: `${s.duration}s`,
                    animationDelay: `${s.delay}s`,
                  }}
                />
              ))}
            </div>

            {/* Central planet orbs */}
            <motion.div
              animate={{
                y: [0, -8, 0],
                scale: [1, 1.02, 1],
              }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative z-10 mb-6"
            >
              {/* Glow ring */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/15 via-purple-500/10 to-transparent blur-2xl"
                style={{ width: '140px', height: '140px', left: '-30px', top: '-30px' }} />
              {/* Planet body */}
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-zinc-800 via-zinc-900 to-black border border-zinc-700/40 shadow-2xl overflow-hidden">
                {/* Planet surface lines */}
                <div className="absolute top-1/3 left-0 right-0 h-[1px] bg-zinc-700/30" />
                <div className="absolute top-2/3 left-0 right-0 h-[1px] bg-zinc-700/20" />
                <div className="absolute inset-y-0 left-1/3 w-[1px] bg-zinc-700/20 rotate-12" />
                {/* Planet glint */}
                <div className="absolute top-2 left-3 w-2.5 h-2.5 rounded-full bg-white/10 blur-[1px]" />
              </div>
              {/* Orbital ring */}
              <div className="absolute -inset-3 rounded-full border border-zinc-600/20 animate-spin"
                style={{ animationDuration: '8s' }} />
              <div className="absolute -inset-5 rounded-full border border-zinc-600/10 animate-spin"
                style={{ animationDuration: '12s', animationDirection: 'reverse' }} />
              {/* Orbital dot */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                className="absolute -inset-3 rounded-full"
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-amber-400/60 shadow-[0_0_6px_rgba(251,191,36,0.3)]" />
              </motion.div>
            </motion.div>

            {/* Text */}
            <div className="relative z-10 text-center">
              <p className="text-sm font-medium text-zinc-300 tracking-wide">
                <span className="inline-block">Generating</span>{' '}
                <span className="inline-block text-amber-400/80">live preview</span>
                <span className="inline-flex ml-1">
                  <span className="animate-bounce" style={{ animationDelay: '0s' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.15s' }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>.</span>
                </span>
              </p>
              <p className="text-xs text-zinc-600 mt-2">
                Preview will appear automatically as files are built
              </p>
            </div>

            {/* Floating particles - stable from memoized data */}
            <div className="absolute inset-0 pointer-events-none">
              {cosmicData.particles.map((p: { id: number; left: number; top: number; xDrift: number; duration: number; delay: number }) => (
                <motion.div
                  key={`particle-${p.id}`}
                  className="absolute w-1 h-1 rounded-full bg-amber-400/20"
                  style={{
                    left: `${p.left}%`,
                    top: `${p.top}%`,
                  }}
                  animate={{
                    y: [0, -30, 0],
                    x: [0, p.xDrift, 0],
                    opacity: [0, 0.6, 0],
                    scale: [0, 1, 0],
                  }}
                  transition={{
                    duration: p.duration,
                    repeat: Infinity,
                    delay: p.delay,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );

  // ── Generation panel content (terminal + files) ──
  const renderGeneration = () => (
    <div className="flex flex-col h-full min-h-0">
      {/* Terminal */}
      <div className="flex-1 min-h-0 relative">
        {/* Terminal label */}
        <div className="absolute top-0 left-0 right-0 z-10 px-3 py-1.5 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border-b border-zinc-800/50">
          <Terminal className="w-3 h-3 text-zinc-500" />
          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Terminal</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              status === 'running' ? 'bg-amber-400 animate-pulse' : status === 'complete' ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-[10px] text-zinc-600">
              {status === 'running' ? 'Running' : status === 'complete' ? 'Complete' : 'Failed'}
            </span>
          </div>
        </div>
        <div ref={terminalRef} className="h-full w-full pt-8" />
      </div>

      {/* Files section (collapsible) */}
      {fileTabs.length > 0 && (
        <div className="border-t border-zinc-800 shrink-0">
          <button
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors cursor-pointer"
          >
            {filesExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <FileCode className="w-3 h-3" />
            <span className="font-medium">Files</span>
            <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full ml-1">{fileTabs.length}</span>
          </button>

          <AnimatePresence>
            {filesExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 200, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-t border-zinc-800 overflow-hidden"
              >
                <div className="flex h-full" style={{ height: '200px' }}>
                  {/* File sidebar */}
                  <div className="w-40 shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/30">
                    {fileTabs.map((f, i) => (
                      <button
                        key={f.path}
                        onClick={() => setActiveFileIdx(i)}
                        className={`w-full text-left px-2.5 py-1.5 text-[11px] truncate transition-colors cursor-pointer ${
                          i === activeFileIdx
                            ? 'bg-amber-500/10 text-amber-400 border-l-2 border-amber-400'
                            : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                        }`}
                      >
                        <div className="truncate">{f.path.split('/').pop()}</div>
                        <div className="text-[10px] text-zinc-600 truncate">{f.path}</div>
                      </button>
                    ))}
                  </div>
                  {/* Editor */}
                  <div className="flex-1 min-w-0 relative group">
                    {activeFile && (
                      <>
                        {isCompleting && (
                          <div className="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-[10px] flex items-center gap-1 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          AI Completing...
                        </div>
                        )}
                        <Editor
                          key={activeFile.path}
                          defaultLanguage={activeFile.language}
                          defaultValue={activeFile.content}
                          theme="vs-dark"
                          options={{
                            readOnly: status === 'running',
                            minimap: { enabled: false },
                            fontSize: 12,
                            lineNumbers: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            padding: { top: 8 },
                          }}
                          onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            registerMonaco(editor, monaco);
                          }}
                          onChange={(value) => {
                            if (value !== null && status !== 'running') {
                              scheduleSave({
                                path: activeFile.path,
                                language: activeFile.language,
                                content: value,
                              });
                            }
                          }}
                        />
                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                          {status !== 'running' && (
                            <button
                              onClick={async () => {
                                if (!activeFile || !editorRef.current) return;
                                const content = editorRef.current.getValue();
                                const selection = editorRef.current.getSelection();
                                const text = selection ? editorRef.current.getModel()?.getValueInRange(selection) : undefined;
                                const position = selection ? editorRef.current.getPosition() : editorRef.current.getPositionAt(editorRef.current.getModel()?.getLength() || 0);
                                
                                const resultText = await complete(userId, {
                                  currentFile: {
                                    path: activeFile.path,
                                    language: activeFile.language,
                                    content: content,
                                  },
                                  cursorPosition: {
                                    line: position.lineNumber,
                                    column: position.column,
                                  },
                                  selectedText: text,
                                  intent: text ? 'patch' : 'full_file',
                                });
                                const model = editorRef.current.getModel();
                                if (model && selection) {
                                  model.executeEdits('ai-complete', [{ range: selection, text: resultText, forceMoveMarkers: true }]);
                                } else if (model) {
                                  const pos = model.getPosition();
                                  model.executeEdits('ai-complete', [{
                                    range: {
                                      startLineNumber: pos.lineNumber,
                                      startColumn: pos.column,
                                      endLineNumber: pos.lineNumber,
                                      endColumn: pos.column,
                                    },
                                    text: resultText,
                                    forceMoveMarkers: true,
                                  }]);
                                }
                                scheduleSave({
                                    path: activeFile.path,
                                    language: activeFile.language,
                                    content: model.getValue(),
                                  });
                              }}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer text-[10px] font-medium"
                            >
                              <Wand2 className="w-3 h-3" />
                              AI Complete
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );

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
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0 bg-zinc-900/50">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                status === 'running' ? 'bg-amber-400 animate-pulse' :
                status === 'complete' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="text-sm font-semibold text-white truncate">{appName || 'Coding Assistant'}</span>
              <span className="text-[11px] text-zinc-500">
                {status === 'running' ? 'Running...' : status === 'complete' ? 'Complete' : 'Failed'}
              </span>
              {appUrl && (
                <button
                  onClick={handleCopyUrl}
                  className="flex items-center gap-1 text-[11px] text-amber-400/80 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy URL'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Refresh preview */}
              {appUrl && (
                <button
                  onClick={handleRefreshPreview}
                  className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 p-1.5 rounded-lg transition-colors cursor-pointer"
                  title="Refresh preview"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleClose}
                className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 p-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Mobile Tab Bar ── */}
          {isMobile && (
            <div className="flex border-b border-zinc-800 shrink-0 bg-zinc-900/30">
              <button
                onClick={() => setMobileTab('generation')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                  mobileTab === 'generation'
                    ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                Generation
                {fileTabs.length > 0 && (
                  <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full">{fileTabs.length}</span>
                )}
              </button>
              <button
                onClick={() => setMobileTab('preview')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                  mobileTab === 'preview'
                    ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
            </div>
          )}

          {/* ── Content ── */}
          {isMobile ? (
            /* Mobile: stacked panels */
            <div className="flex-1 min-h-0">
              {mobileTab === 'generation' ? renderGeneration() : renderPreview()}
            </div>
          ) : (
            /* Desktop: split panel */
            <div ref={containerRef} className="flex-1 flex min-h-0">
              {/* Left panel - Generation (terminal + files) */}
              <div
                className="min-h-0 overflow-hidden"
                style={{ width: `${dividerPos}%` }}
              >
                {renderGeneration()}
              </div>

              {/* Draggable Divider */}
              <div
                className={`relative shrink-0 flex items-center justify-center transition-colors cursor-col-resize group ${
                  isDragging ? 'bg-amber-500/30' : 'bg-zinc-800 hover:bg-amber-500/20'
                }`}
                style={{ width: '6px', minWidth: '6px' }}
                onMouseDown={handleDividerMouseDown}
              >
                {/* Grip indicator */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center pointer-events-none">
                  <GripVertical className={`w-3 h-3 transition-opacity ${
                    isDragging ? 'text-amber-400 opacity-100' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                  }`} />
                </div>
                {/* Invisible wider hit area for easier grabbing */}
                <div className="absolute inset-y-0" style={{ width: '16px', left: '-5px' }} />
              </div>

              {/* Right panel - Preview */}
              <div
                className="min-h-0 overflow-hidden"
                style={{ width: `${100 - dividerPos}%` }}
              >
                {renderPreview()}
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
  );
});
