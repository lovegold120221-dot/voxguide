import { useState, useRef, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { X, FileText, FileDown, Loader2 } from 'lucide-react';

interface DocumentViewerProps {
  title: string;
  content: string;
  fileType?: string;
  onClose: () => void;
  personaName: string;
}

export function DocumentViewer({
  title,
  content,
  fileType = 'html',
  onClose,
}: DocumentViewerProps) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const handleDownloadBlob = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [title]);

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-base)] flex flex-col">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-glass)] shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate max-w-[60%]">{title}</h1>
        <div className="relative">
          <button
            onClick={() => setDownloadOpen(!downloadOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-text)] text-xs font-bold hover:brightness-110 transition-all"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export
          </button>
          <AnimatePresence>
            {downloadOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-2xl min-w-[130px]">
                <button onClick={() => { handleDownloadBlob(new Blob([content], {type:'text/html'}), '.html'); setDownloadOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-colors">
                  <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                  HTML File
                </button>
              </div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Full-screen iframe */}
      <div className="flex-1 bg-[var(--bg-base)] relative overflow-hidden">
        <iframe
          ref={previewRef}
          srcDoc={fileType === 'html' ? content : `<pre style="font-family:monospace;white-space:pre-wrap;padding:20px;font-size:14px;color:var(--text-primary);background:var(--bg-base)">${content.replace(/</g, '&lt;')}</pre>`}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts"
          title="Document Preview"
        />
      </div>
    </div>
  );
}
