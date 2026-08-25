import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Only the email link types we actually issue. Anything else in the URL is rejected rather
// than passed through to Supabase, since this value comes straight from an untrusted query string.
const EMAIL_OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;

function parseOtpType(raw: string | null): EmailOtpType | null {
  return (EMAIL_OTP_TYPES as readonly string[]).includes(raw ?? '') ? (raw as EmailOtpType) : null;
}

type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'error'; message: string };

export default function AuthCallback() {
  const navigate = useNavigate();
  const search = window.location.search;
  const hash = window.location.hash;
  const target = `com.treforged.forged://auth-callback${search}${hash}`;

  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash');
  const otpType = parseOtpType(params.get('type'));
  const isTokenHashLink = Boolean(tokenHash);

  const [verify, setVerify] = useState<VerifyState>(
    isTokenHashLink ? { status: 'verifying' } : { status: 'idle' },
  );

  useEffect(() => {
    if (!tokenHash) return;

    let cancelled = false;

    (async () => {
      if (!otpType) {
        if (!cancelled) setVerify({ status: 'error', message: 'This confirmation link is malformed. Request a new one from the sign-in screen.' });
        return;
      }

      try {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
        if (cancelled) return;

        if (error) {
          setVerify({
            status: 'error',
            message: 'This link is invalid or has expired. Request a new confirmation email from the sign-in screen.',
          });
          return;
        }

        navigate('/dashboard', { replace: true });
      } catch {
        if (!cancelled) {
          setVerify({ status: 'error', message: 'We could not confirm your email. Check your connection and try the link again.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenHash, otpType, navigate]);

  return (
    <div
      className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-6"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
      }}
    >
      {/* Shimmer only while genuinely loading (verifying the email link) — never on the
          settled 'idle' or 'error' states, where the logo is just page branding. */}
      <span className={`inline-flex ${verify.status === 'verifying' ? 'logo-shimmer' : ''}`}>
        <img
          src="/logo-transparent.png"
          alt="Forgenta"
          style={{ height: 80, width: 80, objectFit: 'contain' }}
          draggable={false}
        />
      </span>

      {verify.status === 'verifying' && (
        <p className="text-sm text-muted-foreground text-center">Confirming your email…</p>
      )}

      {verify.status === 'error' && (
        <>
          <p className="text-sm text-destructive text-center max-w-xs">{verify.message}</p>
          <button
            onClick={() => navigate('/auth', { replace: true })}
            className="w-full max-w-xs bg-primary text-primary-foreground py-3.5 text-sm font-semibold text-center btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Back to sign in
          </button>
        </>
      )}

      {verify.status === 'idle' && (
        <>
          <p className="text-sm text-muted-foreground text-center">
            Sign-in complete. Tap below to open Forgenta.
          </p>
          {/* Must be a real tap (user gesture) for iOS to allow custom scheme navigation */}
          <a
            href={target}
            className="w-full max-w-xs bg-primary text-primary-foreground py-3.5 text-sm font-semibold text-center btn-press"
            style={{ borderRadius: 'var(--radius)', display: 'block' }}
          >
            Open Forgenta
          </a>
        </>
      )}
    </div>
  );
}
