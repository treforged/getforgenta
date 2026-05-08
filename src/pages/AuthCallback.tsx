export default function AuthCallback() {
  const search = window.location.search;
  const hash = window.location.hash;
  const target = `com.treforged.forged://auth-callback${search}${hash}`;

  return (
    <div
      className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-6"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
      }}
    >
      <img
        src="/logo-transparent.png"
        alt="Forgenta"
        style={{ height: 80, width: 80, objectFit: 'contain' }}
        draggable={false}
      />
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
    </div>
  );
}
