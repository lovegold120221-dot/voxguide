import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';

type Props = {
  visible: boolean;
  onInstall: () => void;
  onDismiss: () => void;
};

export function PWAInstallPrompt({ visible, onInstall, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          className="fixed bottom-24 left-4 right-4 z-[200] md:left-auto md:right-8 md:bottom-8 md:w-80"
        >
          <div className="bg-[#111111] border border-white/10 rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-5 flex flex-col gap-4 backdrop-blur-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#d0a78b] flex items-center justify-center shadow-lg shadow-[#d0a78b]/20">
                  <Download className="w-6 h-6 text-black" />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-[15px] font-bold text-white tracking-tight">Install Beatrice</h3>
                  <p className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Premium Web App</p>
                </div>
              </div>
              <button
                onClick={onDismiss}
                className="p-1.5 rounded-full hover:bg-white/5 text-zinc-500 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed font-medium">
              Install Beatrice for a native app experience — full-screen, offline-ready, and always just a tap away.
            </p>

            <button
              onClick={onInstall}
              className="w-full bg-[#d0a78b] text-black font-black py-3.5 rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all text-xs uppercase tracking-[0.2em] shadow-lg shadow-[#d0a78b]/10 cursor-pointer"
            >
              Install Now
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
