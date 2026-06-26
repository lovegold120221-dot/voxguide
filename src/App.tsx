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
  reauthenticateWithPopup,
  getRedirectResult,
  browserLocalPersistence,
  setPersistence
} from 'firebase/auth';
import { Loader2, Sun, Moon } from 'lucide-react';
import { EntryFlow } from './components/EntryFlow';
import { AuthPage } from './components/AuthPage';
import { BeatriceAgent } from './components/BeatriceAgent';
import { WhatsAppPortal } from './components/WhatsAppPortal';
import { WhatsAppOnboarding } from './components/WhatsAppOnboarding';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
import { usePWA } from './hooks/usePWA';
import { APP_VERSION } from './version';
import { LocalFolderProvider } from './lib/localFolderContext';
import { FolderWatcher } from './components/FolderWatcher';
import { BEATRICE_ONBOARDING_VERSION, getLocalFolderState } from './lib/db';

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

  const pwa = usePWA();

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
    // Use localStorage persistence so auth survives redirects (avoids sessionStorage issues)
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    // Handle pending redirect result (from signInWithRedirect fallback)
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const refreshToken = (result as any)._tokenResponse?.oauthRefreshToken;
        if (credential?.accessToken) {
          setGoogleToken(credential.accessToken);
          storeToken(credential.accessToken, result.user.uid, refreshToken);
        }
      }
    }).catch((err) => {
      console.warn('Redirect result error:', err.code, err.message);
    });

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
                context_size: 500,
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
      try {
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
      } catch (err: any) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
          throw new Error('The sign-in popup was blocked. Please allow popups for this site and try again.');
        }
        if (err.code === 'auth/popup-closed-by-user') {
          throw new Error('Sign-in was cancelled.');
        }
        // If Firebase fell back to redirect (sessionStorage failure), user will be redirected here
        // The getRedirectResult handler above will catch it on reload
        throw err;
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
    try {
      const storedVersion = localStorage.getItem('beatrice_onboarding_version');
      const wasDone = localStorage.getItem('beatrice_onboarding_done') === 'true';
      // Force re-onboarding if version changed (clears old cache)
      if (storedVersion !== String(BEATRICE_ONBOARDING_VERSION)) {
        localStorage.removeItem('beatrice_onboarding_done');
      }
      return wasDone && storedVersion === String(BEATRICE_ONBOARDING_VERSION);
    } catch { return false; }
  });

  const handleOnboardingComplete = useCallback(() => {
    try {
      localStorage.setItem('beatrice_onboarding_done', 'true');
      localStorage.setItem('beatrice_onboarding_version', String(BEATRICE_ONBOARDING_VERSION));
    } catch {}
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
    <LocalFolderProvider userId={user?.uid ?? null}>
      <FolderWatcher userId={user?.uid ?? null} />
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
      <PWAInstallPrompt
        visible={pwa.mode === 'install'}
        onInstall={pwa.install}
        onDismiss={pwa.dismissInstall}
      />
      <PWAUpdatePrompt
        visible={pwa.mode === 'update'}
        onDismiss={pwa.dismissUpdate}
        onUpdate={pwa.triggerUpdate}
      />
    </LocalFolderProvider>
  );
}
