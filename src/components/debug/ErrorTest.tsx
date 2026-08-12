import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

// A deliberate crash, for proving the error-tracking pipeline end to end.
// The route is gated by ERROR_TEST_ENABLED in @/lib/feature-flags — kept there
// so App.tsx can read the flag without statically importing this module and
// dragging it into the main bundle.

// A distinctive name so the report is findable in the dashboard among real
// crashes, and unmistakably not one.
class DeliberateTestError extends Error {
  constructor(kind: string) {
    super(`Forgenta error-tracking smoke test (${kind}) — this crash is deliberate`);
    this.name = 'DeliberateTestError';
  }
}

// Every figure here is invented. AGENT.md forbids committing anything derived
// from real data, and these exist to be LOOKED AT in a replay: if masking is
// working, none of them are legible in the recording.
const FAKE_FIGURES = [
  { label: 'Checking', value: '$12,345.67' },
  { label: 'Credit card balance', value: '$6,789.01' },
  { label: 'Net worth', value: '$98,765.43' },
];

function Boom({ kind }: { kind: string }): never {
  throw new DeliberateTestError(kind);
}

export default function ErrorTest() {
  const [renderCrash, setRenderCrash] = useState(false);

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-destructive mt-0.5 shrink-0" />
        <div>
          <h1 className="text-sm font-semibold">Error tracking smoke test</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Each button throws on purpose. The report should reach the dashboard
            with a readable stack, and carry the replay of this page.
          </p>
        </div>
      </div>

      {/* The masking probe. In the replay these must be unreadable. */}
      <div className="card-forged p-4 space-y-2">
        <p className="text-xs font-semibold">Masking probe (synthetic figures)</p>
        {FAKE_FIGURES.map(f => (
          <div key={f.label} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{f.label}</span>
            <span className="font-mono">{f.value}</span>
          </div>
        ))}
        <input
          className="w-full mt-2 px-2 py-1 text-xs bg-secondary border border-border"
          style={{ borderRadius: 'var(--radius)' }}
          placeholder="Type here — this input must be masked too"
        />
      </div>

      <div className="flex flex-col gap-2">
        {/* Caught by the surrounding ErrorBoundary -> monitoring.reportError. */}
        <button
          onClick={() => setRenderCrash(true)}
          className="px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Throw during render (error boundary path)
        </button>

        {/* Escapes React entirely -> the SDK's own window.onerror hook. */}
        <button
          onClick={() => {
            setTimeout(() => { throw new DeliberateTestError('uncaught'); }, 0);
          }}
          className="px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Throw uncaught (window.onerror path)
        </button>

        {/* -> the SDK's unhandledrejection hook. */}
        <button
          onClick={() => { void Promise.reject(new DeliberateTestError('rejection')); }}
          className="px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Reject a promise (unhandledrejection path)
        </button>
      </div>

      {renderCrash && <Boom kind="render" />}
    </div>
  );
}
