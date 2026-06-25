import { useState, useRef } from 'react';
import { X, RotateCw, Monitor, Tablet, Smartphone, ChevronLeft, ChevronRight, RefreshCw, Copy, Check } from 'lucide-react';

interface DocumentViewerProps {
  title: string;
  content: string;
  fileType?: string;
  url?: string;
  onClose: () => void;
  personaName: string;
  onRefine?: () => void;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<ViewportSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

export function DocumentViewer({
  title,
  content,
  fileType = 'html',
  url,
  onClose,
  onRefine,
}: DocumentViewerProps) {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [key, setKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = () => setKey(k => k + 1);

  const handleCopyLink = () => {
    if (url) {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-base)] flex flex-col">
      {/* Live-server toolbar */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-glass)] shrink-0">
        {/* Navigation buttons (disabled decoration) */}
        <div className="flex items-center gap-0.5">
          <button disabled className="p-1 rounded text-[var(--text-secondary)] opacity-40 cursor-not-allowed">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button disabled className="p-1 rounded text-[var(--text-secondary)] opacity-40 cursor-not-allowed">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Refresh */}
        <button onClick={handleRefresh} className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all" title="Refresh">
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] text-xs text-[var(--text-secondary)] font-mono truncate mx-1 select-all cursor-text relative group">
          <span className="text-[var(--accent)] shrink-0">◆</span>
          <span className="truncate">{url || `/${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}/`}</span>
          <button 
            onClick={handleCopyLink}
            className="absolute right-1 p-1 rounded bg-[var(--bg-base)] border border-[var(--border)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--bg-glass-hover)]"
            title="Copy Link"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {/* Viewport controls */}
        <div className="flex items-center gap-0.5 bg-[var(--bg-base)] rounded-lg border border-[var(--border)] p-0.5">
          <button
            onClick={() => setViewport('desktop')}
            className={`p-1.5 rounded transition-all ${viewport === 'desktop' ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            title="Desktop view"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('tablet')}
            className={`p-1.5 rounded transition-all ${viewport === 'tablet' ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            title="Tablet view"
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('mobile')}
            className={`p-1.5 rounded transition-all ${viewport === 'mobile' ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            title="Mobile view"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Open in new tab */}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-xs font-bold hover:bg-[var(--accent)] hover:text-[var(--accent-text)] transition-all"
            title="Open in new tab"
          >
            Open App
          </a>
        )}

        {/* Ask Beatrice to refine */}
        {onRefine && (
          <button
            onClick={onRefine}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-xs font-bold hover:bg-[var(--accent)] hover:text-[var(--accent-text)] transition-all"
            title="Ask Beatrice to make changes"
          >
            <RefreshCw className="w-3 h-3" />
            Refine
          </button>
        )}

        {/* Close */}
        <button onClick={onClose} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Preview area */}
      <div className="flex-1 bg-[var(--bg-base)] relative overflow-hidden flex items-start justify-center pt-4 pb-4">
        <div
          className="relative overflow-hidden bg-white shadow-2xl transition-all duration-300"
          style={{
            width: VIEWPORT_WIDTHS[viewport],
            height: viewport === 'mobile' ? '780px' : '100%',
            borderRadius: viewport === 'mobile' ? '32px' : '8px',
            maxHeight: '100%',
          }}
        >
          {/* Mobile notch decoration */}
          {viewport === 'mobile' && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 w-32 h-6 bg-black rounded-b-2xl flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#1a1a1a]" />
            </div>
          )}

          <iframe
            key={key}
            ref={previewRef}
            src={url || undefined}
            srcDoc={!url ? (fileType === 'html' ? content : `<pre style="font-family:monospace;white-space:pre-wrap;padding:20px;font-size:14px;color:var(--text-primary);background:var(--bg-base)">${content.replace(/</g, '&lt;')}</pre>`) : undefined}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            title="Document Preview"
            style={viewport === 'mobile' ? { paddingTop: '24px' } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
