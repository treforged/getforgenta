import { Component, Fragment, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

interface Props { children: ReactNode; }
interface InnerProps extends Props {
  queryClient: QueryClient;
  // Injectable because jsdom's window.location.reload cannot be mocked.
  reload?: () => void;
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

class ErrorBoundaryInner extends Component<InnerProps, State> {
  constructor(props: InnerProps) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false, retryPending: false, childKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, reloading: false };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Page render error:', error.message, info.componentStack);

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

    const willReload = this.state.retryPending;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertTriangle size={32} className="text-destructive" />
        <div>
          <p className="text-sm font-medium">Something went wrong loading this page.</p>
          <p className="text-xs text-muted-foreground mt-1">
            {willReload ? 'Reloading usually clears this up.' : 'This is usually temporary — try again.'}
          </p>
        </div>
        <button
          onClick={this.handleRetry}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <RefreshCw size={12} /> {willReload ? 'Reload page' : 'Try again'}
        </button>
      </div>
    );
  }
}

export { ErrorBoundaryInner };

function ErrorBoundary({ children }: Props) {
  const queryClient = useQueryClient();
  return <ErrorBoundaryInner queryClient={queryClient}>{children}</ErrorBoundaryInner>;
}

export default ErrorBoundary;
