import { useEffect } from 'react';

export default function AuthCallback() {
  useEffect(() => {
    const search = window.location.search;
    const hash = window.location.hash;
    // Redirect to native custom scheme — triggers appUrlOpen in Capacitor's WKWebView.
    // This page runs in SFSafariViewController where client-side JS navigation to a
    // custom URL scheme reliably fires application(_:open:url:options:), unlike the
    // server-side HTTP redirect chain which can be swallowed by modern iOS.
    window.location.href = `com.treforged.forged://auth-callback${search}${hash}`;
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <span className="text-sm text-muted-foreground animate-pulse">Signing in…</span>
    </div>
  );
}
