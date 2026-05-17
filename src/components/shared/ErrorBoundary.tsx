import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; reloading: boolean; }

// Vite dynamic-import failure messages across browsers
const CHUNK_ERROR_RE = /dynamically imported module|loading chunk|loading css chunk|failed to fetch/i;
const RELOAD_FLAG = 'forged:chunk_reload';

function isChunkError(err: Error | null): boolean {
  return CHUNK_ERROR_RE.test(err?.message ?? '');
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false };
  }

  static getDerivedStateFromError(error: Error): State {
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

  handleRetry = () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    this.setState({ hasError: false, error: null, reloading: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.reloading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-4">
          <RefreshCw size={24} className="text-primary animate-spin" />
          <p className="text-sm font-medium">App updated — reloading…</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertTriangle size={32} className="text-destructive" />
        <div>
          <p className="text-sm font-medium">Something went wrong loading this page.</p>
          <p className="text-xs text-muted-foreground mt-1">This is usually temporary — try again.</p>
        </div>
        <button
          onClick={this.handleRetry}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <RefreshCw size={12} /> Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
