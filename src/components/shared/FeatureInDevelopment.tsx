import { Link } from 'react-router';
import { Wrench, ArrowLeft } from 'lucide-react';

type FeatureInDevelopmentProps = {
  /** Feature name, shown as the page heading. */
  title: string;
  /** One or two sentences on why it is unavailable. Plain language, no jargon. */
  message: string;
  /** Optional icon rendered beside the heading, matching the feature's usual icon. */
  icon?: React.ReactNode;
};

/**
 * Full-page placeholder for a feature that is intentionally switched off.
 *
 * Used in place of the real page so the gated feature's data loading and network
 * calls never run.
 */
export default function FeatureInDevelopment({ title, message, icon }: FeatureInDevelopmentProps) {
  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {icon}
        <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">{title}</h1>
      </div>

      <div
        className="border border-border/60 bg-secondary/30 p-8 text-center space-y-4"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto">
          <Wrench size={22} className="text-primary" />
        </div>

        <div className="space-y-1.5">
          <h2 className="font-display font-bold text-lg tracking-tight">In development</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">{message}</p>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <ArrowLeft size={14} />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
