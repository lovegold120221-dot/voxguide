import { useEffect, useState, useCallback } from 'react';
import { auth } from './firebase';
import { supabase, handleDbError } from './lib/supabase';
import {
  onAuthStateChanged,
  signOut,
  User,
  signInWithPopup,
  GoogleAuthProvider,
  linkWithPopup,
  reauthenticateWithPopup
} from 'firebase/auth';
import { Loader2, Sun, Moon } from 'lucide-react';
import { EntryFlow } from './components/EntryFlow';
import { AuthPage } from './components/AuthPage';
import { BeatriceAgent } from './components/BeatriceAgent';
import { WhatsAppPortal } from './components/WhatsAppPortal';
import { WhatsAppOnboarding } from './components/WhatsAppOnboarding';

/* ── Theme system ── */
type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('beatrice_theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  // Default to dark — respects the app's existing design
  return 'dark';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('theme-dark', 'theme-light');
  root.classList.add(`theme-${theme}`);
  root.style.colorScheme = theme;
  // Update meta theme-color for mobile status bar
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#050505' : '#f5f1ea');
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [showEntryFlow, setShowEntryFlow] = useState(true);

  // Apply theme class to <html> on mount and changes
  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('beatrice_theme', next); } catch {}
      return next;
    });
  }, []);
  const [authLanguage, setAuthLanguage] = useState(() => {
    try { return localStorage.getItem('beatrice_language') || 'en'; } catch { return 'en'; }
  });
  const storeToken = useCallback((token: string, uid: string, refreshToken?: string) => {
    setGoogleToken(token);
    try {
      localStorage.setItem('beatrice_google_token', token);
      localStorage.setItem('beatrice_google_uid', uid);
      if (refreshToken) {
        localStorage.setItem('beatrice_google_refresh_token', refreshToken);
      }
    } catch {}
  }, []);

  const clearStoredToken = useCallback(() => {
    try {
      localStorage.removeItem('beatrice_google_token');
      localStorage.removeItem('beatrice_google_refresh_token');
      localStorage.removeItem('beatrice_google_uid');
    } catch {}
  }, []);

  const restoreStoredToken = useCallback((uid: string): string | null => {
    try {
      const stored = localStorage.getItem('beatrice_google_token');
      const storedUid = localStorage.getItem('beatrice_google_uid');
      return stored && storedUid === uid ? stored : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (u) {
        try {
          const restored = restoreStoredToken(u.uid);
          if (restored) {
            setGoogleToken(restored);
          }

          const { data: existing } = await supabase
            .from('user_settings')
            .select('user_id')
            .eq('user_id', u.uid)
            .maybeSingle();

          if (!existing) {
            await supabase
              .from('user_settings')
              .insert({
                user_id: u.uid,
                persona_name: 'Beatrice',
                selected_voice: 'Aoede',
                custom_prompt: '',
                context_size: 20,
              });
          }
        } catch (error) {
          handleDbError(error, 'user_settings', 'create');
        }
      }

      setLoading(false);
    });

    return () => unsub();
  }, [restoreStoredToken]);

  const handleLogin = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();

      provider.addScope('https://mail.google.com/');
      provider.addScope('https://www.googleapis.com/auth/drive');
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
      provider.addScope('https://www.googleapis.com/auth/drive.appdata');
      provider.addScope('https://www.googleapis.com/auth/calendar');
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
      provider.addScope('https://www.googleapis.com/auth/tasks');
      provider.addScope('https://www.googleapis.com/auth/youtube');
      provider.addScope('https://www.googleapis.com/auth/youtube.force-ssl');
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      provider.addScope('https://www.googleapis.com/auth/documents');
      provider.addScope('https://www.googleapis.com/auth/contacts');
      provider.addScope('https://www.googleapis.com/auth/userinfo.profile');

      provider.setCustomParameters({
        prompt: 'consent',
        access_type: 'offline'
      });

      let result;
      const currentUser = auth.currentUser;
      if (currentUser) {
        const isGoogleLinked = currentUser.providerData.some(p => p.providerId === 'google.com');
        if (isGoogleLinked) {
          result = await reauthenticateWithPopup(currentUser, provider);
        } else {
          result = await linkWithPopup(currentUser, provider);
        }
      } else {
        result = await signInWithPopup(auth, provider);
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const refreshToken = (result as any)._tokenResponse?.oauthRefreshToken;

      if (credential?.accessToken) {
        setGoogleToken(credential.accessToken);
        storeToken(credential.accessToken, result.user.uid, refreshToken);
      }

      // If we made it here with a currentUser, verify Google is now linked
      if (currentUser && !currentUser.providerData.some(p => p.providerId === 'google.com')) {
        const freshUser = auth.currentUser;
        if (freshUser?.providerData.some(p => p.providerId === 'google.com')) {
          setGoogleToken(credential?.accessToken || null);
        }
      }
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert('Google sign-in is not enabled in the Firebase Console. Go to Authentication > Sign-in method > Google and enable it.');
      }
    }
  }, [storeToken]);

  const [onboardingDone, setOnboardingDone] = useState(() => {
    try { return localStorage.getItem('beatrice_onboarding_done') === 'true'; } catch { return false; }
  });

  const handleOnboardingComplete = useCallback(() => {
    try { localStorage.setItem('beatrice_onboarding_done', 'true'); } catch {}
    setOnboardingDone(true);
  }, []);

  const handleLogout = useCallback(() => {
    setGoogleToken(null);
    clearStoredToken();
    signOut(auth);
  }, [clearStoredToken]);

  const handleGoogleToken = useCallback((token: string | null) => {
    setGoogleToken(token);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-amber-500/50" />
          <span className="text-xs font-mono tracking-widest text-amber-500/30 uppercase">
            Initializing System
          </span>
        </div>
      </div>
    );
  }

  if (showEntryFlow) {
    return <EntryFlow onComplete={() => setShowEntryFlow(false)} />;
  }

  if (!user) {
    return <AuthPage onGoogleToken={handleGoogleToken} onLogin={handleLogin} />;
  }

  const isAdminPortal = typeof window !== 'undefined'
    && window.location.pathname.replace(/\/+$/, '') === '/adminportal';

  if (isAdminPortal) {
    return (
      <WhatsAppPortal
        user={user}
        onBack={() => { window.location.href = '/'; }}
        onLogout={handleLogout}
      />
    );
  }

  if (!onboardingDone) {
    return (
      <WhatsAppOnboarding
        user={user}
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingComplete}
      />
    );
  }

  return (
    <BeatriceAgent
      user={user}
      googleToken={googleToken}
      setGoogleToken={setGoogleToken}
      storeToken={storeToken}
      authLanguage={authLanguage}
      onSetLanguage={setAuthLanguage}
      onLogout={handleLogout}
      onLogin={handleLogin}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}
