import { Component, Fragment, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { reportError } from '@/lib/monitoring';

interface Props {
  children: ReactNode;
  // What the user would call the thing inside this boundary ("Cash Flow Chart",
  // "Debt Payoff"). The fallback names it, so a broken card says which card
  // broke instead of leaving the whole screen unexplained.
  label?: string;
  // 'page' fills the view and offers a way back out of it. 'widget' stays
  // inside the card it replaces, so one dead widget cannot swallow the page
  // around it — the rest of the dashboard still renders and still works.
  variant?: 'page' | 'widget';
  // Where the way-out button goes. Public routes pass '/' — a signed-out
  // visitor sent to /dashboard just bounces to /auth, which is not a way back.
  // null hides the button entirely, for the routes that ARE the destination:
  // a button that navigates to the page you are already on looks broken.
  homeTo?: string | null;
}
interface InnerProps extends Props {
  queryClient: QueryClient;
  // Injectable because jsdom's window.location.reload cannot be mocked.
  reload?: () => void;
  // Injected by the wrapper from useNavigate, so this class stays renderable
  // without a Router around it (which is what the tests rely on).
  goHome?: () => void;
}
interface State {
  hasError: boolean;
  error: Error | null;
  reloading: boolean;
  // True while the last "Try again" has not yet produced a clean render.
  // If the boundary catches again in that window, the next retry escalates
  // to a full reload — the one recovery known to always work.
  retryPending: boolean;
  // Bumped on retry so the children remount instead of re-rendering the
  // same tree over the same state that just crashed.
  childKey: number;
}

// Vite dynamic-import failure messages across browsers
const CHUNK_ERROR_RE = /dynamically imported module|loading chunk|loading css chunk|failed to fetch/i;
const RELOAD_FLAG = 'forged:chunk_reload';

function isChunkError(err: Error | null): boolean {
  return CHUNK_ERROR_RE.test(err?.message ?? '');
}

// The technical line under the friendly one. Kept short because it is a hint
// for a support conversation, not the explanation — the sentence above it is.
function detailOf(err: Error | null): string | null {
  const msg = err?.message?.trim();
  if (!msg) return null;
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

class ErrorBoundaryInner extends Component<InnerProps, State> {
  constructor(props: InnerProps) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false, retryPending: false, childKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, reloading: false };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Page render error:', this.props.label ?? 'unlabelled', error.message, info.componentStack);

    // A boundary's whole job is to stop the error reaching the window — which
    // also stops the error tracker's window.onerror hook from ever seeing it.
    // So the errors users actually hit are exactly the ones that would go
    // unreported unless we hand them over explicitly. The session replay is
    // attached automatically, giving the "what did they do before it broke"
    // that a stack trace alone cannot.
    reportError(error, {
      label: this.props.label,
      componentStack: info.componentStack,
      source: this.props.variant === 'widget' ? 'ErrorBoundary/widget' : 'ErrorBoundary/page',
    });

    // Auto-reload once on chunk errors — new deploy replaced the old hashed chunks.
    // Guard with sessionStorage so a broken chunk can't cause an infinite reload loop.
    if (isChunkError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      this.setState({ reloading: true });
      setTimeout(() => window.location.reload(), 400);
    }
  }

  componentDidUpdate(_prevProps: InnerProps, prevState: State) {
    // A retry render that committed without throwing is a successful recovery;
    // arm the soft retry again for any future, unrelated crash.
    if (prevState.hasError && !this.state.hasError && this.state.retryPending) {
      this.setState({ retryPending: false });
    }
  }

  handleRetry = () => {
    // The previous retry rendered the same crash again — a second soft reset
    // would too. Reload rebuilds module state and the query cache from scratch.
    if (this.state.retryPending) {
      (this.props.reload ?? (() => window.location.reload()))();
      return;
    }
    sessionStorage.removeItem(RELOAD_FLAG);
    // Clear cached query state so the remounted children refetch instead of
    // re-reading the loaded-shaped-but-wrong data that crashed the render.
    void this.props.queryClient.resetQueries();
    this.setState(prev => ({
      hasError: false,
      error: null,
      reloading: false,
      retryPending: true,
      childKey: prev.childKey + 1,
    }));
  };

  render() {
    if (!this.state.hasError) {
      return <Fragment key={this.state.childKey}>{this.props.children}</Fragment>;
    }

    if (this.state.reloading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-4">
          <RefreshCw size={24} className="text-primary animate-spin" />
          <p className="text-sm font-medium">App updated — reloading…</p>
        </div>
      );
    }

    const { label, variant, goHome, homeTo } = this.props;
    const willReload = this.state.retryPending;
    const detail = detailOf(this.state.error);
    const retryLabel = willReload ? 'Reload page' : 'Try again';

    // A dead widget replaces only itself, keeping the page around it usable.
    if (variant === 'widget') {
      return (
        <div className="card-forged p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                {label ? `${label} couldn’t load` : 'This section couldn’t load'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                The rest of this page still works.
              </p>
              {detail && (
                <p className="text-[11px] text-muted-foreground/70 mt-1 break-words">{detail}</p>
              )}
              <button
                onClick={this.handleRetry}
                className="mt-3 flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <RefreshCw size={12} /> {retryLabel}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertTriangle size={32} className="text-destructive" />
        <div className="max-w-sm">
          <p className="text-sm font-medium">
            {label ? `${label} couldn’t load.` : 'Something went wrong loading this page.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {willReload ? 'Reloading usually clears this up.' : 'This is usually temporary — try again.'}
          </p>
          {detail && (
            <p className="text-[11px] text-muted-foreground/70 mt-2 break-words">{detail}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <RefreshCw size={12} /> {retryLabel}
          </button>
          {goHome && (
            <button
              onClick={goHome}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <Home size={12} /> {homeTo === '/' ? 'Back to home' : 'Back to dashboard'}
            </button>
          )}
        </div>
      </div>
    );
  }
}

export { ErrorBoundaryInner };

function ErrorBoundary({ children, label, variant, homeTo = '/dashboard' }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <ErrorBoundaryInner
      queryClient={queryClient}
      label={label}
      variant={variant}
      homeTo={homeTo}
      // A widget's neighbours are the way back; it does not need its own.
      goHome={variant === 'widget' || homeTo === null ? undefined : () => navigate(homeTo)}
    >
      {children}
    </ErrorBoundaryInner>
  );
}

export default ErrorBoundary;
