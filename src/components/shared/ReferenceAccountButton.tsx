/**
 * "See a reference account" — the demo's only door, since 2026-08-18.
 *
 * Tre: *"lets make the demo only accessible when you sign up, so you can see a reference account
 * for example when the user sets up."* The button used to sit on `/auth` as a third CTA beside
 * Start Free and Sign In, where it read as a way PAST the front door. It now appears inside setup,
 * where it reads as what it is: a filled-in account to look at while filling in your own.
 *
 * One component and not two copies, so the wizard and the Dashboard checklist cannot drift into two
 * different promises about what the button does. Leaving is the banner's job (`useDemoSession`).
 */

import { Eye } from 'lucide-react';
import { useDemoSession } from '@/hooks/useDemoSession';

interface Props {
  /** Used inside the checklist card, where a full-width bordered block would fight the grid. */
  variant?: 'block' | 'inline';
  className?: string;
}

export default function ReferenceAccountButton({ variant = 'block', className = '' }: Props) {
  const { enterDemo } = useDemoSession();

  if (variant === 'inline') {
    return (
      <button
        onClick={enterDemo}
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors ${className}`}
      >
        <Eye size={12} /> See a reference account
      </button>
    );
  }

  return (
    <button
      onClick={enterDemo}
      className={`w-full flex items-center justify-center gap-2 border border-border/60 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors btn-press ${className}`}
      style={{ borderRadius: 'var(--radius)' }}
    >
      <Eye size={13} /> See a reference account
    </button>
  );
}
