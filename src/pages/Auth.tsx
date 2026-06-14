import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { loginSchema, signUpSchema } from '@/lib/schemas';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { AuthSession } from '@/lib/auth-session';
import { useDemo } from '@/contexts/DemoContext';

import ForgentaLogo from '@/components/shared/ForgentaLogo';

const TRUSTED_DEVICE_KEY = 'forgenta:trusted_device_id';

interface TrustedDevice {
  device_id: string;
  name: string;
  trusted_at: string;
  last_seen: string;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Browser';
}

async function checkDeviceTrusted(userId: string): Promise<boolean> {
  const deviceId = localStorage.getItem(TRUSTED_DEVICE_KEY);
  if (!deviceId) return false;
  try {
    const { data } = await supabase.from('profiles').select('trusted_devices').eq('user_id', userId).single();
    const devices = ((data as any)?.trusted_devices ?? []) as TrustedDevice[];
    const device = devices.find(d => d.device_id === deviceId);
    if (!device) return false;
    return Date.now() - new Date(device.trusted_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function updateDeviceLastSeen(userId: string): Promise<void> {
  const deviceId = localStorage.getItem(TRUSTED_DEVICE_KEY);
  if (!deviceId) return;
  try {
    const { data: pd } = await supabase.from('profiles').select('trusted_devices').eq('user_id', userId).single();
    const devices = ((pd as any)?.trusted_devices ?? []) as TrustedDevice[];
    const updated = devices.map(d =>
      d.device_id === deviceId ? { ...d, last_seen: new Date().toISOString() } : d
    );
    await supabase.from('profiles').update({ trusted_devices: updated } as any).eq('user_id', userId);
  } catch { /* non-critical */ }
}

type Mode = 'landing' | 'login' | 'signup' | 'reset' | 'set-password' | 'mfa';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('landing');
  const { setIsDemo } = useDemo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [trustPromptVisible, setTrustPromptVisible] = useState(false);
  const [pendingUserId, setPendingUserId] = useState('');

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorType, setMfaFactorType] = useState<string>('totp');
  const [totpCountdown, setTotpCountdown] = useState(0);
  const [mfaError, setMfaError] = useState('');

  // Signal Swift cover that the auth page is visible — but only when the user
  // has no active session and will stay on this page. If a session exists, Auth
  // immediately navigates to Dashboard; signalling here lifts the cover too early
  // (Dashboard's lazy chunk hasn't loaded yet) causing a dark flash. Dashboard
  // sets the flag itself once it renders, so we skip it here for that path.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || data.session) return;
      (window as any).__forgenta_dashboard_ready = true;
    });
    return () => {
      mounted = false;
      (window as any).__forgenta_dashboard_ready = false;
    };
  }, []);

  useEffect(() => {
    const hash = window.location.hash;

    // Password reset: stay on set-password form — skip session redirect.
    // Flag suppresses AuthContext's SIGNED_IN→navigate that fires when
    // Supabase establishes the recovery session from the hash tokens.
    if (hash.includes('type=recovery')) {
      sessionStorage.setItem('forgenta:recovery_pending', '1');
      setMode('set-password');
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (searchParams.get('reset') === 'true') {
      setMode('reset');
      return;
    }

    // OAuth callback: Supabase processes hash tokens asynchronously, so
    // getSession() races. Use onAuthStateChange to reliably detect SIGNED_IN,
    // then close the popup (parent poll detects it) or navigate directly.
    // PKCE flow returns ?code= in search; legacy implicit returns #access_token= in hash.
    if (hash.includes('access_token') || !!searchParams.get('code')) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe();
          if (window.opener) {
            window.close();
          } else {
            navigate('/dashboard', { replace: true });
          }
        }
      });
      return () => subscription.unsubscribe();
    }

    // Normal load: redirect if already signed in
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) navigate('/dashboard', { replace: true });
    });
    return () => { mounted = false; };
  }, [navigate, searchParams]);

  // Clean up legacy auth localStorage keys
  useEffect(() => {
    localStorage.removeItem('forged:signin_passkey');
    localStorage.removeItem('forged:signin_passkey_tokens');
    localStorage.removeItem('forgenta:signin_passkey');
    localStorage.removeItem('forgenta:signin_passkey_tokens');
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setResetSent(false);
    if (next === 'landing') setEmail('');
  };

  const handleDemoLogin = () => {
    setIsDemo(true);
    navigate('/dashboard', { replace: true });
  };

  const handleTrustDevice = async () => {
    setLoading(true);
    try {
      const deviceId = crypto.randomUUID();
      localStorage.setItem(TRUSTED_DEVICE_KEY, deviceId);
      const { data: pd } = await supabase.from('profiles').select('trusted_devices').eq('user_id', pendingUserId).single();
      const existing = ((pd as any)?.trusted_devices ?? []) as TrustedDevice[];
      const now = new Date().toISOString();
      await supabase.from('profiles').update({
        trusted_devices: [...existing, { device_id: deviceId, name: getDeviceName(), trusted_at: now, last_seen: now }],
      } as any).eq('user_id', pendingUserId);
    } catch { /* non-critical */ } finally {
      setLoading(false);
      navigate('/dashboard', { replace: true });
    }
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setLoading(true);
    const redirectTo = Capacitor.isNativePlatform()
      ? 'com.treforged.forged://auth-callback'
      : `${window.location.origin}/auth`;

    try {
      if (Capacitor.getPlatform() === 'ios') {
        // iOS: ASWebAuthenticationSession — auto-dismisses, captures callback in-process
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
        });
        if (error) throw error;
        if (!data.url) throw new Error('No OAuth URL returned');

        const { url: callbackUrl } = await AuthSession.start({
          url: data.url,
          callbackURLScheme: 'com.treforged.forged',
        });

        const incoming = new URL(callbackUrl);
        const code = incoming.searchParams.get('code');

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const hash = incoming.hash.startsWith('#') ? incoming.hash.slice(1) : incoming.hash;
          const hashParams = new URLSearchParams(hash);
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
            if (sessionError) throw sessionError;
          } else {
            throw new Error('No auth tokens in callback URL');
          }
        }

        navigate('/dashboard', { replace: true });
        setLoading(false);

      } else if (Capacitor.getPlatform() === 'android') {
        // Android: Chrome Custom Tabs + appUrlOpen.
        // The intent-filter in AndroidManifest routes com.treforged.forged:// back
        // to MainActivity, which Capacitor translates into the appUrlOpen event.
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw error;
        if (!data.url) throw new Error('No OAuth URL returned');

        const oauthUrl = data.url;
        const callbackUrl = await new Promise<string>((resolve, reject) => {
          let urlHandle: { remove: () => void } | null = null;
          let finishedHandle: { remove: () => void } | null = null;
          let resolved = false;

          const cleanup = () => {
            urlHandle?.remove();
            finishedHandle?.remove();
          };

          const setup = async () => {
            urlHandle = await App.addListener('appUrlOpen', ({ url }) => {
              if (url.startsWith('com.treforged.forged://')) {
                resolved = true;
                cleanup();
                Browser.close().catch(() => {});
                resolve(url);
              }
            });

            // browserFinished fires when the user manually closes the tab.
            // Delay slightly so appUrlOpen wins if both fire on a successful redirect.
            finishedHandle = await Browser.addListener('browserFinished', () => {
              setTimeout(() => {
                if (!resolved) {
                  cleanup();
                  reject(new Error('cancelled'));
                }
              }, 300);
            });

            await Browser.open({ url: oauthUrl });
          };

          setup().catch(err => {
            cleanup();
            reject(err);
          });
        });

        const incoming = new URL(callbackUrl);
        const code = incoming.searchParams.get('code');
        if (!code) throw new Error('No auth code in callback URL');

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;

        navigate('/dashboard', { replace: true });
        setLoading(false);

      } else {
        // Web: centered popup so the user stays on the page
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
        });
        if (error) throw error;
        if (!data.url) throw new Error('No OAuth URL returned');

        const w = 480, h = 600;
        const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
        const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
        const popup = window.open(data.url, 'forgenta-oauth', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`);

        if (!popup) {
          window.location.href = data.url;
          return;
        }

        const poll = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(poll);
            setLoading(false);
            supabase.auth.getSession().then(({ data: s }) => {
              if (s.session) navigate('/dashboard', { replace: true });
            });
          }
        }, 600);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'User cancelled' || msg === 'cancelled') {
        // User dismissed — no error toast
      } else if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('email already in use')) {
        toast.error('An account already exists with this email. Sign in with your password or reset it using "Forgot password?".');
      } else {
        toast.error(msg || 'OAuth sign-in failed. Please try again.');
      }
      setLoading(false);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'set-password') {
      if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
      if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-password`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ new_password: password }),
          }
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Failed to update password');
        toast.success('Password updated. You are now signed in.');
        navigate('/dashboard');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to update password');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'reset') {
      if (!email.trim()) { toast.error('Enter your email address'); return; }
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        setResetSent(true);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to send reset email');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'login') {
      const result = loginSchema.safeParse({ email, password });
      if (!result.success) { toast.error(result.error.issues[0].message); return; }
    } else {
      const result = signUpSchema.safeParse({ displayName, email, password, confirmPassword });
      if (!result.success) { toast.error(result.error.issues[0].message); return; }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { data: authData, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;

        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
          if (authData.user?.id) {
            const trusted = await checkDeviceTrusted(authData.user.id);
            if (trusted) {
              await updateDeviceLastSeen(authData.user.id);
              toast.success('Signed in successfully');
              navigate('/dashboard', { replace: true });
              setLoading(false);
              return;
            }
          }
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          const rawFactors = factorsData as any;
          const allFactors = [
            ...(factorsData?.totp ?? []),
            ...(factorsData?.phone ?? []),
            ...((rawFactors?.email ?? []) as any[]),
          ];
          const factor = allFactors.find(f => f.status === 'verified');
          if (factor) {
            const { data: challenge, error: ce } = await supabase.auth.mfa.challenge({ factorId: factor.id });
            if (ce || !challenge) throw ce ?? new Error('MFA challenge failed');
            setMfaFactorId(factor.id);
            setMfaChallengeId(challenge.id);
            setMfaFactorType(factor.factor_type);
            setMode('mfa');
            setLoading(false);
            return;
          }
        }

        toast.success('Signed in successfully');
        navigate('/dashboard', { replace: true });
      } else {
        const rawName = displayName.trim().slice(0, LIMITS.username);
        const { clean: cleanName, flagged: nameFlagged } = filterProfanity(rawName);
        if (nameFlagged) toast.warning('Display name contained inappropriate language and was cleaned.');
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: cleanName },
          },
        });
        if (error) throw error;
        toast.success('Account created! Check your email to confirm.');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  // TOTP countdown
  useEffect(() => {
    if (mode !== 'mfa' || mfaFactorType !== 'totp') return;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setTotpCountdown(30 - (now % 30));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode, mfaFactorType]);

  const handleMfaVerify = useCallback(async () => {
    if (!mfaCode.trim()) { setMfaError('Enter the verification code'); return; }
    setMfaError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (error) throw error;
      toast.success('Signed in successfully');
      const { data: { user: mfaUser } } = await supabase.auth.getUser();
      if (mfaUser) {
        const isTrusted = await checkDeviceTrusted(mfaUser.id);
        if (isTrusted) {
          await updateDeviceLastSeen(mfaUser.id);
          navigate('/dashboard');
        } else {
          setPendingUserId(mfaUser.id);
          setTrustPromptVisible(true);
        }
      } else {
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setMfaError(msg);
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  }, [mfaCode, mfaFactorId, mfaChallengeId, navigate]);

  // Auto-submit when 6 digits entered for TOTP
  useEffect(() => {
    if (mfaFactorType === 'totp' && mfaCode.length === 6 && !loading) {
      handleMfaVerify();
    }
  }, [mfaCode, mfaFactorType, loading, handleMfaVerify]);

  // ── Trust device prompt (post-MFA) ───────────────────────────────────────
  if (trustPromptVisible) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        }}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <ForgentaLogo size="sm" className="text-gold" />
            <p className="text-xs text-muted-foreground mt-1">You're signed in.</p>
          </div>
          <div className="card-forged p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Trust this device?</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Skip 2FA on this {getDeviceName()} for the next 30 days.
              </p>
            </div>
            <button
              onClick={handleTrustDevice}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? 'Saving…' : 'Yes, trust this device'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard', { replace: true })}
              className="w-full py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Landing ───────────────────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-6"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 24px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
        }}
      >
        <style>{`
          @keyframes authEntrance {
            from { opacity: 0; transform: scale(0.85) translateY(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
          .auth-logo  { animation: authEntrance 0.6s ease forwards; }
          .auth-cta   { opacity: 0; animation: authEntrance 0.5s ease forwards; }
          .auth-cta-1 { animation-delay: 0.4s; }
          .auth-cta-2 { animation-delay: 0.55s; }
          .auth-cta-3 { animation-delay: 0.7s; }
          .auth-trust { opacity: 0; animation: authEntrance 0.5s ease 0.85s forwards; }
        `}</style>
        <div className="w-full max-w-xs space-y-10">
          <div className="text-center auth-logo">
            <img
              src="/logo-transparent.png"
              alt="Forgenta"
              style={{ height: 300, width: 300, objectFit: 'contain', display: 'block', margin: '0 auto' }}
              draggable={false}
            />
            <p className="text-sm font-medium text-foreground/80 -mt-2">Your money. Clear and honest.</p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => switchMode('signup')}
              className="auth-cta auth-cta-1 w-full bg-primary text-primary-foreground py-3.5 text-sm font-semibold btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Start Free
            </button>
            <button
              onClick={() => switchMode('login')}
              className="auth-cta auth-cta-2 w-full border border-border text-foreground py-3.5 text-sm font-semibold hover:bg-secondary/60 transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Sign In
            </button>
            <button
              onClick={handleDemoLogin}
              className="auth-cta auth-cta-3 w-full py-3 text-sm font-semibold text-foreground/70 hover:text-foreground border border-border/50 hover:border-border transition-all"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Try Demo
            </button>
          </div>
          {!Capacitor.isNativePlatform() && (
            <div className="auth-trust text-center">
              <div className="inline-flex flex-col items-center gap-2">
              <a
                href="https://apps.apple.com/us/app/forgenta-track-build-wealth/id6762540239"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download on the App Store"
                className="inline-flex"
              >
                <img
                  src="/app-store-badge.svg"
                  alt="Download on the App Store"
                  style={{ height: 54, width: 'auto' }}
                />
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.treforged.forged&pcampaignid=web_share"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Get Forgenta on Google Play"
                className="inline-flex"
              >
                <img
                  src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
                  alt="Get it on Google Play"
                  style={{ height: 80, width: 'auto' }}
                />
              </a>
              </div>
            </div>
          )}
          <p className="auth-trust text-sm font-medium text-foreground/70 text-center">
            0 ads. Ever. No selling your data.
          </p>
          <div className="auth-trust flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-2">
              <Link
                to="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Privacy Policy
              </Link>
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Terms of Service
              </Link>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              &copy; {new Date().getFullYear()} Forgenta&#8482; by TRE Forged LLC. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── MFA challenge UI ──────────────────────────────────────────────────────
  if (mode === 'mfa') {
    const FACTOR_HINTS: Record<string, string> = {
      totp: 'Open your authenticator app and enter the 6-digit code. It submits automatically.',
      phone: 'Enter the SMS code sent to your phone.',
      email: 'Enter the code sent to your email.',
    };
    const countdownPct = mfaFactorType === 'totp' ? (totpCountdown / 30) * 100 : 100;
    const isExpiring = mfaFactorType === 'totp' && totpCountdown <= 5;

    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        }}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <ForgentaLogo size="sm" className="text-gold" />
            <p className="text-xs text-muted-foreground mt-1">Two-factor verification required.</p>
          </div>
          <div className="card-forged p-6 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {FACTOR_HINTS[mfaFactorType] ?? 'Enter your verification code.'}
            </p>

            {mfaFactorType === 'totp' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Code expires in</span>
                  <span className={`text-xs font-semibold tabular-nums ${isExpiring ? 'text-destructive' : 'text-foreground'}`}>
                    {totpCountdown}s
                  </span>
                </div>
                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${isExpiring ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${countdownPct}%` }}
                  />
                </div>
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              name="one-time-code"
              autoComplete="one-time-code"
              maxLength={mfaFactorType === 'totp' ? 6 : 8}
              value={mfaCode}
              onChange={e => { setMfaError(''); setMfaCode(e.target.value.replace(/\D/g, '')); }}
              placeholder={mfaFactorType === 'totp' ? '000000' : 'Verification code'}
              autoFocus
              className={`w-full bg-secondary border px-3 py-3 text-lg text-foreground text-center tracking-[0.4em] focus:outline-none focus:ring-1 ${mfaError ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-ring'}`}
              style={{ borderRadius: 'var(--radius)' }}
            />

            {mfaError && (
              <p className="text-xs text-destructive -mt-2">{mfaError}</p>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Verifying…
              </div>
            )}

            {!loading && mfaFactorType !== 'totp' && (
              <button
                onClick={handleMfaVerify}
                disabled={!mfaCode.trim()}
                className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
                style={{ borderRadius: 'var(--radius)' }}
              >
                Verify
              </button>
            )}

            <button
              type="button"
              onClick={() => { setMode('login'); setMfaCode(''); setMfaError(''); }}
              className="w-full py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Set new password UI ───────────────────────────────────────────────────
  if (mode === 'set-password') {
    const mismatch = !!confirmPassword && confirmPassword !== password;
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <ForgentaLogo size="sm" className="text-gold" />
            <p className="text-xs text-muted-foreground mt-1">Choose a new password for your account.</p>
          </div>
          <form onSubmit={handleSubmit} className="card-forged p-6 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="At least 6 characters"
                className="w-full mt-1 bg-secondary border border-border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="Re-enter your new password"
                className={`w-full mt-1 bg-secondary border px-3 py-3 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                  mismatch ? 'border-destructive focus:ring-destructive' : 'border-border'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              />
              {mismatch && <p className="text-xs text-destructive mt-1">Passwords do not match</p>}
            </div>
            <button
              type="submit"
              disabled={loading || mismatch}
              className="w-full bg-primary text-primary-foreground py-3 text-xs font-semibold btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? 'Updating…' : 'Set New Password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Reset sent confirmation ───────────────────────────────────────────────
  if (mode === 'reset' && resetSent) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <ForgentaLogo size="sm" className="text-gold" />
          </div>
          <div className="card-forged p-6 space-y-4 text-center">
            <p className="text-base font-semibold text-foreground">Check your inbox</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We sent a password reset link to{' '}
              <span className="text-foreground font-medium">{email}</span>.
              The link expires in 1 hour.
            </p>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-3 text-xs font-semibold border border-border text-muted-foreground hover:text-foreground transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Sign in / Sign up / Request reset ────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-background overflow-y-auto flex flex-col items-center justify-center px-4"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
      }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-2">
          <button
            type="button"
            onClick={() => switchMode('landing')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        </div>

        <div className="text-center mb-3">
          <img
            src="/logo-transparent.png"
            alt="Forgenta"
            style={{ height: 110, width: 110, objectFit: 'contain', display: 'block', margin: '0 auto 6px' }}
            draggable={false}
          />
          <p className="text-xs text-muted-foreground">
            {mode === 'login' && 'Welcome back. Sign in to continue.'}
            {mode === 'signup' && 'Create your account to get started.'}
            {mode === 'reset' && 'Enter your email to receive a reset link.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card-forged p-4 space-y-3">

          {mode === 'signup' && (
            <div>
              <label className="text-xs text-muted-foreground uppercase">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                placeholder="Your name"
                maxLength={50}
                autoComplete="name"
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground uppercase">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground uppercase">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full mt-1 bg-secondary border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="text-xs text-muted-foreground uppercase">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className={`w-full mt-1 bg-secondary border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                  confirmPassword && confirmPassword !== password
                    ? 'border-destructive focus:ring-destructive'
                    : 'border-border'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              />
              {confirmPassword && confirmPassword !== password && (
                <p className="text-xs text-destructive mt-1">Passwords do not match</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (mode === 'signup' && !!confirmPassword && confirmPassword !== password)}
            className="w-full bg-primary text-primary-foreground py-2.5 text-xs font-semibold btn-press disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {loading
              ? 'Processing…'
              : mode === 'login'
              ? 'Sign In'
              : mode === 'signup'
              ? 'Create Account'
              : 'Send Reset Link'}
          </button>

          {mode !== 'reset' && (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="w-full py-2.5 text-xs font-semibold border border-primary/40 text-primary hover:bg-primary/10 transition-colors btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Sign In
            </button>
          )}
        </form>

        {mode !== 'reset' && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleOAuthSignIn('google')}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold border border-border text-foreground hover:bg-secondary/60 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleOAuthSignIn('apple')}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold border border-border text-foreground hover:bg-secondary/60 transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <img src="/apple-logo.png" alt="" aria-hidden="true" style={{ height: 20, width: 'auto', display: 'block' }} />
              Continue with Apple
            </button>
            <p className="text-[10px] text-muted-foreground/70 text-center leading-relaxed">
              You may see a supabase.co prompt. This is Forgenta's secure sign-in provider.
            </p>
          </div>
        )}

        <div className="flex flex-col items-center gap-1.5 mt-2">
          <div className="flex items-center justify-center gap-2">
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/40 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Terms of Service
            </Link>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            &copy; {new Date().getFullYear()} Forgenta&#8482; by TRE Forged LLC. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
