import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { startWhatsAppPairing, getWhatsAppStatus, disconnectWhatsApp } from '../lib/whatsappClient';
import { WhatsAppChatList } from './WhatsAppChatList';

interface WhatsAppSettingsProps {
  userId: string;
  waPermissions: Record<string, boolean>;
  onTogglePermission: (key: string) => void;
}

export function WhatsAppSettings({ userId, waPermissions, onTogglePermission }: WhatsAppSettingsProps) {
  const [waStatus, setWaStatus] = useState<string>('not_found');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [waPairing, setWaPairing] = useState(false);
  const [pairingMethod, setPairingMethod] = useState<'qr' | 'phone'>('qr');
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null);
  const waPollRef = useRef<any>(null);

  useEffect(() => {
    loadStatus();
    return () => {
      if (waPollRef.current) clearInterval(waPollRef.current);
    };
  }, []);

  const startPolling = () => {
    if (waPollRef.current) clearInterval(waPollRef.current);
    waPollRef.current = setInterval(async () => {
      try {
        const s = await getWhatsAppStatus(userId);
        setWaStatus(s.status);
        if (s.qrCode) setWaQrCode(s.qrCode);
        if (s.phone) setWaPhone(s.phone);
        if (s.pairingCode) {
          setWaPairingCode(s.pairingCode);
          setPairingMethod('phone');
        }
        if (s.status === 'paired' || s.status === 'disconnected' || s.error) {
          if (s.status === 'paired') {
            await supabase.from('user_settings').upsert({ user_id: userId, whatsapp_paired: true, whatsapp_phone: s.phone || null, updated_at: new Date().toISOString() });
          }
          if (waPollRef.current) clearInterval(waPollRef.current);
          waPollRef.current = null;
          setWaPairing(false);
        }
      } catch {
        if (waPollRef.current) clearInterval(waPollRef.current);
        waPollRef.current = null;
        setWaPairing(false);
      }
    }, 1500);
  };

  const loadStatus = async () => {
    try {
      const s = await getWhatsAppStatus(userId);
      setWaStatus(s.status);
      if (s.qrCode) setWaQrCode(s.qrCode);
      if (s.phone) setWaPhone(s.phone);
      if (s.pairingCode) {
        setWaPairingCode(s.pairingCode);
        setPairingMethod('phone');
      } else {
        if (s.status === 'qr_ready' || s.status === 'init') {
          setPairingMethod('qr');
        }
      }

      if (s.status === 'qr_ready' || s.status === 'init') {
        setWaPairing(true);
        startPolling();
      }
    } catch (e) {
      console.error('Failed to load whatsapp settings:', e);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--text-muted)] mb-3 px-1">WhatsApp Integration</h2>
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden bg-[var(--bg-card)]">
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 bg-black/35 px-3 py-1.5 rounded-full border border-white/[0.02]">
              <div className={`w-1.5 h-1.5 rounded-full ${waStatus === 'paired' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : waStatus === 'qr_ready' || waStatus === 'init' ? 'bg-[#d0a78b] shadow-[0_0_8px_rgba(208,167,139,0.6)] animate-pulse' : 'bg-zinc-500'}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider ${waStatus === 'paired' ? 'text-emerald-400' : waStatus === 'qr_ready' || waStatus === 'init' ? 'text-[#d0a78b]' : 'text-zinc-400'}`}>
                {waStatus === 'paired' ? `Connected${waPhone ? ` (${waPhone})` : ''}` : waStatus === 'qr_ready' ? (waPairingCode ? 'OTP Verification' : 'Scan QR Code') : waStatus === 'init' ? 'Initializing...' : 'Disconnected'}
              </span>
            </div>
            {waStatus === 'paired' ? (
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaStatus('not_found');
                  setWaPhone(null);
                  setWaQrCode(null);
                  setWaPairingCode(null);
                  await supabase.from('user_settings').upsert({ user_id: userId, whatsapp_paired: false, whatsapp_phone: null, whatsapp_permissions: waPermissions, updated_at: new Date().toISOString() });
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-xs font-['SF_Pro_Text',system-ui,sans-serif] font-semibold text-red-400 border border-red-500/20 transition-all duration-200 cursor-pointer"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (pairingMethod === 'phone' && !phoneInput.trim()) {
                    alert('Please enter your phone number with country code first (e.g. +32470123456).');
                    return;
                  }
                  setWaPairing(true);
                  try {
                    await startWhatsAppPairing(userId, pairingMethod === 'phone' ? phoneInput : undefined);
                    setWaStatus('init');
                    setWaPairingCode(null);
                    setWaQrCode(null);
                    startPolling();
                  } catch (e: any) {
                    setWaPairing(false);
                    if (waPollRef.current) clearInterval(waPollRef.current);
                  }
                }}
                disabled={waPairing}
                className="px-4 py-2 bg-[#d0a78b] hover:brightness-110 active:scale-95 disabled:opacity-40 rounded-xl text-xs font-['SF_Pro_Text',system-ui,sans-serif] font-bold text-black shadow-[0_4px_16px_rgba(208,167,139,0.2)] hover:shadow-[0_4px_20px_rgba(208,167,139,0.35)] transition-all duration-200 cursor-pointer"
              >
                {waPairing ? (pairingMethod === 'phone' ? 'Sending OTP...' : 'Generating...') : (pairingMethod === 'phone' ? 'Send OTP' : 'Generate QR')}
              </button>
            )}
          </div>

          {waStatus !== 'paired' && (
            <div className="flex flex-col gap-3 pt-3 border-t border-[var(--border-light)]">
              <label className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 font-bold px-1">Pairing Option</label>
              <div className="grid grid-cols-2 gap-1.5 bg-black/40 p-1 rounded-2xl border border-white/[0.02]">
                <button
                  type="button"
                  onClick={() => setPairingMethod('qr')}
                  disabled={waPairing}
                  className={`py-2 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer ${pairingMethod === 'qr' ? 'bg-white/[0.08] text-[#d0a78b] border border-white/[0.04] shadow-sm' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'} disabled:opacity-50`}
                >
                  Scan QR Code
                </button>
                <button
                  type="button"
                  onClick={() => setPairingMethod('phone')}
                  disabled={waPairing}
                  className={`py-2 rounded-xl text-xs font-bold transition-all duration-300 cursor-pointer ${pairingMethod === 'phone' ? 'bg-white/[0.08] text-[#d0a78b] border border-white/[0.04] shadow-sm' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'} disabled:opacity-50`}
                >
                  Use Phone Number
                </button>
              </div>
              
              {pairingMethod === 'phone' && (
                <div className="flex flex-col gap-2 mt-1 bg-white/[0.01] p-4 rounded-2xl border border-white/[0.03]">
                  <label htmlFor="wa-phone-input" className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">WhatsApp Phone Number</label>
                  <input
                    id="wa-phone-input"
                    type="text"
                    value={phoneInput}
                    disabled={waPairing}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="e.g. +32 470 123456"
                    className="bg-black/35 border border-white/[0.05] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#d0a78b]/50 focus:ring-1 focus:ring-[#d0a78b]/20 transition-all duration-300 disabled:opacity-50"
                  />
                  <p className="text-[11px] text-zinc-500 leading-relaxed font-medium">
                    Enter the phone number registered on your WhatsApp app, including your country code (e.g. 32470123456).
                  </p>
                </div>
              )}
            </div>
          )}

          {waPairing && waStatus === 'init' && (
            <div className="flex flex-col items-center pt-4 border-t border-white/[0.04]">
              <div className="flex items-center gap-2 mb-2">
                <svg className="animate-spin h-4 w-4 text-[#d0a78b]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-[13px] text-zinc-400 font-semibold">Generating WhatsApp connection...</span>
              </div>
              <p className="text-[11px] text-zinc-500 text-center max-w-xs mb-3 font-medium">
                Starting up WhatsApp session on VPS backend. This might take a few seconds...
              </p>
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaPairing(false);
                  setWaStatus('not_found');
                  setWaPairingCode(null);
                  setWaQrCode(null);
                  if (waPollRef.current) clearInterval(waPollRef.current);
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-xs font-semibold text-red-400 border border-red-500/20 transition-all duration-200 cursor-pointer"
              >
                Cancel Pairing
              </button>
            </div>
          )}

          {waStatus === 'error' && (
            <div className="flex flex-col items-center pt-4 border-t border-white/[0.04]">
              <span className="text-[13px] text-red-400 font-bold mb-1">Pairing Failed</span>
              <p className="text-[11px] text-zinc-500 text-center max-w-xs mb-3 font-medium leading-relaxed">
                An error occurred during pairing. Please verify your phone number and network connection, then try again.
              </p>
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaStatus('not_found');
                  setWaPairing(false);
                  setWaPairingCode(null);
                  setWaQrCode(null);
                  if (waPollRef.current) clearInterval(waPollRef.current);
                }}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 active:scale-95 rounded-xl text-xs font-semibold text-white border border-white/5 transition-all duration-200 cursor-pointer"
              >
                Reset & Try Again
              </button>
            </div>
          )}

          {pairingMethod === 'qr' && waQrCode && waStatus === 'qr_ready' && (
            <div className="flex flex-col items-center pt-4 border-t border-white/[0.04]">
              <img src={waQrCode} alt="WhatsApp QR" className="w-44 h-44 rounded-2xl bg-white p-3 mb-3 shadow-[0_4px_24px_rgba(255,255,255,0.05)] border border-white/10" />
              <p className="text-[13px] text-zinc-300 text-center font-bold mb-1">Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
              <p className="text-[11px] text-zinc-500 text-center max-w-xs mb-4 leading-relaxed font-medium">Scan this QR code from your phone's WhatsApp application to pair.</p>
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaQrCode(null);
                  setWaStatus('not_found');
                  setWaPairing(false);
                  if (waPollRef.current) clearInterval(waPollRef.current);
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-xs font-semibold text-red-400 border border-red-500/20 transition-all duration-200 cursor-pointer"
              >
                Cancel Pairing
              </button>
            </div>
          )}

          {pairingMethod === 'phone' && !waPairingCode && waStatus === 'qr_ready' && (
            <div className="flex flex-col items-center pt-4 border-t border-white/[0.04]">
              <div className="flex items-center gap-2 mb-2">
                <svg className="animate-spin h-4 w-4 text-[#d0a78b]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-[13px] text-zinc-400 font-semibold">Generating OTP code...</span>
              </div>
              <p className="text-[11px] text-zinc-500 text-center max-w-xs mb-3 font-medium">
                Please wait while we request the OTP verification code from WhatsApp...
              </p>
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaPairingCode(null);
                  setWaStatus('not_found');
                  setWaPairing(false);
                  if (waPollRef.current) clearInterval(waPollRef.current);
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-xs font-semibold text-red-400 border border-red-500/20 transition-all duration-200 cursor-pointer"
              >
                Cancel Pairing
              </button>
            </div>
          )}

          {pairingMethod === 'phone' && waPairingCode && waStatus === 'qr_ready' && (
            <div className="flex flex-col items-center pt-4 border-t border-white/[0.04]">
              <div className="bg-black/45 border border-white/[0.06] rounded-2xl px-6 py-4 flex items-center justify-center gap-2 mb-3 select-text shadow-inner">
                {waPairingCode.split('').map((char, i) => (
                  <span key={i} className={`text-2xl font-bold font-mono tracking-wider ${char === '-' ? 'text-zinc-600 mx-1' : 'text-[#d0a78b] drop-shadow-[0_0_8px_rgba(208,167,139,0.3)]'}`}>
                    {char}
                  </span>
                ))}
              </div>
              <p className="text-[12px] text-zinc-300 text-center max-w-xs mb-1 font-bold">
                Open WhatsApp &gt; Linked Devices &gt; Link a Device &gt; Link with phone number instead
              </p>
              <p className="text-[11px] text-zinc-500 text-center max-w-xs mb-4 leading-relaxed font-medium">
                Enter the 8-character OTP code shown above on your phone's WhatsApp.
              </p>
              <button
                onClick={async () => {
                  await disconnectWhatsApp(userId);
                  setWaPairingCode(null);
                  setWaStatus('not_found');
                  setWaPairing(false);
                  if (waPollRef.current) clearInterval(waPollRef.current);
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-xs font-semibold text-red-400 border border-red-500/20 transition-all duration-200 cursor-pointer"
                aria-label="Cancel pairing"
                title="Cancel pairing"
              >
                Cancel Pairing
              </button>
            </div>
          )}
        </div>

        {waStatus === 'paired' && (
          <div className="border-t border-[var(--border-light)]">
            {[
              { key: 'send_messages', label: 'Send Messages', desc: 'Allow Beatrice to send texts on your behalf' },
              { key: 'read_chats', label: 'Read Chats', desc: 'Scan and digest incoming WhatsApp messages' },
              { key: 'access_contacts', label: 'Access Contacts', desc: 'Search and link contact records' },
              { key: 'manage_contacts', label: 'Manage Contacts', desc: 'Register or update contacts' },
              { key: 'access_groups', label: 'Access Groups', desc: 'Browse joined groups' },
              { key: 'send_group_messages', label: 'Send Group Messages', desc: 'Post announcements or chat replies to groups' },
              { key: 'read_group_chats', label: 'Read Group Chats', desc: 'Follow and analyze group discussions' },
              { key: 'view_message_history', label: 'View Message History', desc: 'Read past conversation logs' },
              { key: 'access_images', label: 'Images', desc: 'Access photos and images shared in chats' },
              { key: 'access_videos', label: 'Videos', desc: 'Access video messages and recordings' },
              { key: 'access_audio', label: 'Audio & Voice Notes', desc: 'Access voice messages and audio files' },
              { key: 'access_documents', label: 'Documents', desc: 'Access PDFs, spreadsheets, presentations and other files' },
              { key: 'access_stickers', label: 'Stickers & GIFs', desc: 'Access sticker and GIF messages' },
              { key: 'access_contact_cards', label: 'Contact Cards', desc: 'Access shared contact cards' },
              { key: 'access_location', label: 'Location Messages', desc: 'Access shared location pins' },
              { key: 'access_links', label: 'Links', desc: 'Access URLs and link previews shared in chats' },
              { key: 'access_polls', label: 'Polls', desc: 'Access poll messages and voting data' },
              { key: 'make_calls', label: 'Make Phone Calls', desc: 'Dial contacts from your phonebook via the native dialer' },
              { key: 'make_whatsapp_calls', label: 'WhatsApp Calls', desc: 'Initiate WhatsApp voice or video calls to contacts' },
            ].map((p, i, arr) => (
              <div key={p.key} className={`px-5 py-4 flex items-center justify-between transition-colors duration-300 ${i !== arr.length - 1 ? 'border-b border-[var(--border-light)]' : ''}`}>
                <div className="flex flex-col gap-0.5 pr-4">
                  <span className="text-[14px] text-[var(--text-primary)] font-semibold tracking-tight">{p.label}</span>
                  <span className="text-[11px] text-[var(--text-muted)] font-medium leading-relaxed">{p.desc}</span>
                </div>
                <button
                  onClick={() => onTogglePermission(p.key)}
                  aria-pressed={waPermissions[p.key]}
                  aria-label={`Toggle ${p.label} permission`}
                  title={`Toggle ${p.label} permission`}
                  className={`w-10 h-6 rounded-full transition-all duration-300 flex items-center shrink-0 cursor-pointer ${waPermissions[p.key] ? 'bg-[var(--accent)]' : 'bg-zinc-800'}`}
                >
                  <span className={`block w-4.5 h-4.5 rounded-full bg-white transition-all duration-300 shadow-md ${waPermissions[p.key] ? 'ml-[18px]' : 'ml-[3px]'}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
