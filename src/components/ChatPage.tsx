import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, ArrowDown, MessageSquare, ChevronLeft, Menu, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sessionId?: string;
  timestamp: any;
  attachmentUrl?: string;
  attachmentName?: string;
}

interface SessionSummary {
  id: string;
  startTime: Date;
  endTime: Date;
  preview: string;
  count: number;
}

interface ChatPageProps {
  messages: ChatMessage[];
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  chatInput: string;
  setChatInput: (val: string) => void;
  onSend: (e: React.FormEvent) => void;
  onClose: () => void;
  isActive: boolean;
  personaName: string;
  userName: string;
  onFileAttach?: (file: File) => void;
}

const formatTime = (ts: any): string => {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const formatSessionDate = (d: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export function ChatPage({
  messages,
  sessions,
  selectedSessionId,
  onSelectSession,
  chatInput,
  setChatInput,
  onSend,
  onClose,
  isActive,
  personaName,
  userName,
  onFileAttach,
}: ChatPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const prevMsgCount = useRef(messages.length);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useRef(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const currentSession = sessions.find(s => s.id === selectedSessionId);

  const handleFileAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileAttach) {
      onFileAttach(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col h-[100dvh]"
    >
      {/* ── Header ── */}
      <header className="sticky top-0 w-full bg-[var(--bg-glass)] backdrop-blur-2xl border-b border-[var(--border)] px-2 sm:px-3 py-2 sm:py-2.5 flex items-center justify-between z-20 shrink-0 min-h-[48px] sm:min-h-[52px]">
        <button
          onClick={onClose}
          className="p-1.5 sm:p-2 -ml-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all"
          aria-label="Close Chat"
        >
          <X className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
        </button>

        <div className="text-center flex flex-col items-center">
          <h1 className="text-sm sm:text-base font-semibold tracking-wide text-[var(--accent)]">Conversations</h1>
          <div className="flex items-center gap-1.5 -mt-px">
            <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
            <span className="text-xs text-[var(--text-muted)] tracking-wider uppercase">
              {isActive ? 'online' : 'offline'}
            </span>
          </div>
        </div>

        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="p-1.5 sm:p-2 -mr-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all relative"
          aria-label="Toggle Sessions"
        >
          <Menu className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
          {sessions.length > 0 && !sidebarOpen && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent)] border border-[var(--bg-base)]" />
          )}
        </button>
      </header>

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Sessions Sidebar (overlay on mobile, alongside on desktop) ── */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              {isMobile.current && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-[var(--bg-overlay)] z-30 md:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              <motion.aside
                initial={isMobile.current ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }}
                animate={isMobile.current ? { x: 0, opacity: 1 } : { width: 240, opacity: 1 }}
                exit={isMobile.current ? { x: -280, opacity: 0 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className={
                  isMobile.current
                    ? 'fixed left-0 top-0 bottom-0 w-[280px] z-40 bg-[var(--bg-base)] border-r border-[var(--border)] flex flex-col'
                    : 'border-r border-[var(--border)] overflow-hidden shrink-0 bg-[var(--bg-glass)] flex flex-col'
                }
              >
                <div className={isMobile.current ? 'w-[280px] h-full flex flex-col' : 'w-[240px] h-full flex flex-col'}>
                  <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
                    <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-bold">Sessions</h2>
                    {isMobile.current && (
                      <button
                        onClick={() => setSidebarOpen(false)}
                        className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass-hover)] transition-all"
                        aria-label="Close sidebar"
                        title="Close sidebar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                    {sessions.length === 0 && (
                      <p className="text-sm text-zinc-600 text-center px-3 py-8">
                        No conversations yet
                      </p>
                    )}
                    {sessions.map(session => (
                      <button
                        key={session.id}
                        onClick={() => {
                          onSelectSession(session.id);
                          if (isMobile.current) setSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-all ${
                          session.id === selectedSessionId
                            ? 'bg-[#d0a78b]/10 border border-[#d0a78b]/20'
                            : 'hover:bg-zinc-800/40 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold uppercase tracking-wider ${
                            session.id === selectedSessionId ? 'text-[#d0a78b]' : 'text-zinc-400'
                          }`}>
                            {formatSessionDate(session.startTime)}
                          </span>
                          <span className="text-xs text-zinc-600">
                            {session.count} msgs
                          </span>
                        </div>
                        <p className="text-sm text-zinc-500 truncate leading-relaxed">
                          {session.preview || 'Empty session'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-zinc-600">
                            {session.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {session.id === (messages.length > 0 ? messages[messages.length - 1]?.sessionId : null) && (
                            <span className="text-xs uppercase tracking-widest text-emerald-500 font-bold">
                              current
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ── Floating sidebar toggle (when closed) ── */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-2 top-2 z-10 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-all"
            aria-label="Open Sessions"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        )}

        {/* ── Messages Area ── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Session info bar */}
          {currentSession && (
            <div className="px-3 sm:px-4 py-1.5 sm:py-2 border-b border-[var(--border)] bg-[var(--bg-glass)] shrink-0">
              <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <span>{formatSessionDate(currentSession.startTime)}</span>
                <span className="text-zinc-700">&middot;</span>
                <span>{currentSession.count} messages</span>
                {currentSession.id === (messages.length > 0 ? messages[messages.length - 1]?.sessionId : null) && isActive && (
                  <>
                    <span className="text-zinc-700">&middot;</span>
                    <span className="text-emerald-500 flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 scroll-smooth"
          >
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center px-6">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-zinc-900/60 border border-zinc-800/40 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                    <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-600" />
                  </div>
                  <p className="text-zinc-500 text-sm sm:text-base">No messages in this session.</p>
                  {isActive && (
                    <p className="text-zinc-600 text-xs sm:text-sm mt-1">Type a message or use voice to start.</p>
                  )}
                </div>
              </div>
            )}

            <AnimatePresence>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-2 sm:py-3 ${
                      msg.role === 'user'
                        ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/20 text-[var(--text-primary)]'
                        : 'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold uppercase tracking-wider ${msg.role === 'user' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                        {msg.role === 'user' ? userName : personaName}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <div className={`text-sm sm:text-base leading-relaxed prose prose-sm max-w-none text-[var(--text-primary)] [&_p]:text-[var(--text-primary)] [&_a]:text-[var(--accent)]`}>
                      {msg.role === 'model' ? (
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      )}
                    </div>
                    {msg.attachmentUrl && (
                      <div className="mt-2 pt-2 border-t border-[var(--border-light)]">
                        {msg.attachmentUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || msg.attachmentUrl.includes('image') ? (
                          <div className="relative rounded-lg overflow-hidden border border-[var(--border)] max-w-sm">
                            <img
                              src={msg.attachmentUrl}
                              alt={msg.attachmentName || 'Attachment'}
                              className="w-full h-auto object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(msg.attachmentUrl, '_blank')}
                            />
                            {msg.attachmentName && (
                              <div className="absolute bottom-0 left-0 right-0 bg-[var(--bg-overlay)] px-2 py-1 text-[10px] text-[var(--text-secondary)] truncate">
                                {msg.attachmentName}
                              </div>
                            )}
                          </div>
                        ) : (
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-glass)] border border-[var(--border)] hover:bg-[var(--bg-glass-hover)] transition-colors group"
                          >
                            <Paperclip className="w-3.5 h-3.5 text-zinc-400 group-hover:text-[#d0a78b]" />
                            <span className="text-xs text-zinc-300 group-hover:text-white truncate max-w-[200px]">
                              {msg.attachmentName || 'View Attachment'}
                            </span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          {/* Scroll to bottom button */}
          <AnimatePresence>
            {showScrollBtn && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={scrollToBottom}
                className="absolute bottom-20 left-1/2 -translate-x-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 flex items-center justify-center shadow-lg z-10 hover:bg-zinc-700 transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Input footer ── */}
          <footer className="sticky bottom-0 w-full bg-[var(--bg-glass)] backdrop-blur-2xl border-t border-[var(--border)] px-2 sm:px-3 py-2 sm:py-2.5 z-10 shrink-0">
            <form onSubmit={onSend} className="flex gap-1.5 sm:gap-2 items-center">
              <button
                type="button"
                onClick={handleFileAttach}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-900/90 border border-zinc-800 text-zinc-500 hover:text-[#d0a78b] hover:border-[#d0a78b]/30 flex items-center justify-center shrink-0 transition-all"
                aria-label="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.txt"
                aria-label="Attach file"
                title="Attach file"
                onChange={handleFileChange}
              />
              <input
                ref={inputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isActive ? `Message ${personaName}...` : 'Session not active. Start voice first.'}
                disabled={!isActive}
                className="flex-1 bg-[var(--bg-elevated)] text-xs sm:text-sm text-[var(--text-primary)] px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]/50 placeholder-[var(--text-muted)] disabled:opacity-50 min-w-0"
              />
              <button
                type="submit"
                disabled={!isActive || !chatInput.trim()}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center hover:brightness-110 transition-all disabled:opacity-30 shrink-0"
                aria-label="Send message"
                title="Send message"
              >
                <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </form>
          </footer>
        </div>
      </div>
    </motion.div>
  );
}