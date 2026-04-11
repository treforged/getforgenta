import { Lock, Crown, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type PremiumGateProps = {
  isPremium: boolean;
  children: React.ReactNode;
  /** Shown when no title/features are provided — simple lock mode */
  message?: string;
  className?: string;
  /** Headline for the rich overlay (enables Crown icon + feature list mode) */
  title?: string;
  /** Bullet points shown below the title */
  features?: string[];
};

export default function PremiumGate({
  isPremium,
  children,
  message,
  className,
  title,
  features,
}: PremiumGateProps) {
  if (isPremium) return <>{children}</>;

  const isRich = Boolean(title || (features && features.length > 0));

  return (
    <div className={cn('relative', className)}>
      {/* Blurred preview — acts as a teaser of what's behind the gate */}
      <div className="blur-sm pointer-events-none select-none">
        {children}
      </div>

      {/* Overlay */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center bg-background/75 backdrop-blur-[2px] z-10"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {isRich ? (
          /* ── Rich advertising mode ── */
          <div className="flex flex-col items-center gap-3 text-center px-5 max-w-[280px] sm:max-w-xs">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Crown size={16} className="text-primary" />
            </div>

            {title && (
              <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
            )}

            {features && features.length > 0 && (
              <ul className="space-y-1.5 text-left w-full">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check size={11} className="text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            <Link
              to="/premium"
              className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Upgrade Now
            </Link>
          </div>
        ) : (
          /* ── Simple lock mode ── */
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock size={18} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {message || 'Upgrade to unlock this feature'}
            </p>
            <Link
              to="/premium"
              className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Upgrade Now
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
