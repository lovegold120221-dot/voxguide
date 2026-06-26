import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';
import { APP_VERSION } from '../version';
import { useEffect } from 'react';

type Props = {
  visible: boolean;
  onDismiss?: () => void;
  onUpdate: () => void;
};

export function PWAUpdatePrompt({ visible, onUpdate, onDismiss }: Props) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => onDismiss?.(), 10000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          className="fixed bottom-24 left-4 right-4 z-[200] md:left-auto md:right-8 md:bottom-8 md:w-80"
        >
          <div className="bg-[#111111] border border-amber-500/20 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] px-3 py-3 flex items-center gap-2.5 backdrop-blur-2xl">
            <button onClick={onDismiss} className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
            <RefreshCw className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">Update Available <span className="text-amber-400/80 text-[11px] font-medium">v{APP_VERSION}</span></p>
              <p className="text-[11px] text-zinc-400 truncate">Refresh for latest improvements</p>
            </div>
            <button
              onClick={onUpdate}
              className="shrink-0 bg-amber-500 text-black font-bold px-3 py-1.5 rounded-xl text-[11px] uppercase tracking-wide hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              Update
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
