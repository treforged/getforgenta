/**
 * The Share button beside Payoff ETA (ask 555a4c71, Tre 2026-09-20: "our app needs virality").
 *
 * OPT-IN AND PREVIEWED: pressing Share only renders the card; the image leaves the device only
 * after the user has seen exactly that image and pressed "Share image". The card carries a date
 * and a month count only - the renderer refuses anything else (see share-card.ts).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { buildDebtFreeCard } from '@/lib/share-card';
import { renderShareCard, shareCardImage } from '@/lib/share-card-render';

type Preview = { blob: Blob; url: string };

export default function ShareDebtFreeButton({
  etaMonth,
}: {
  etaMonth: number | null;
}) {
  const spec = buildDebtFreeCard(etaMonth, new Date());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const openPreview = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      const blob = await renderShareCard(spec);
      const url = URL.createObjectURL(blob);
      setPreview({ blob, url });
    } catch {
      toast.error('Could not make the image');
    } finally {
      setBusy(false);
    }
  };

  const close = () => setPreview(null);

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const outcome = await shareCardImage(preview.blob);
      if (outcome === 'downloaded') {
        toast.success('Image saved');
      }
      if (outcome !== 'cancelled') {
        close();
      }
    } catch {
      toast.error('Sharing failed');
    } finally {
      setBusy(false);
    }
  };

  // Revoke object URL when preview changes or component unmounts
  useEffect(() => {
    if (preview?.url) {
      return () => {
        URL.revokeObjectURL(preview.url);
      };
    }
    return;
  }, [preview?.url]);

  // Close modal on Escape key
  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [preview]);

  // AFTER every hook, never before: an early return above them would change the hook count the
  // moment the ETA moves between "never" and a real month, and React throws on that.
  if (spec === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={busy}
        data-testid="share-debt-free"
        aria-label="Share your debt-free date"
        className="shrink-0 flex items-center gap-1 border border-primary/40 text-primary px-2 py-1 text-[9px] sm:text-[10px] font-medium btn-press hover:bg-primary/20 rounded-nested-2"
      >
        <Share2 size={11} />
        Share
      </button>

      {/* PORTALLED to <body>. Rendered in place, the Payoff ETA card's backdrop-filter becomes the
          containing block for `fixed`, so the dialog was clipped inside the card with its top cut
          off and no page backdrop - found in a rendered frame, not by the press test. */}
      {preview && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Share your debt-free date"
          onClick={close}
        >
          <div
            className="card-forged w-full max-w-sm p-4 space-y-3"
            style={{ borderRadius: 'var(--radius)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold">
                Share your debt-free date
              </h2>
              <button
                type="button"
                aria-label="Close"
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors btn-press"
                onClick={close}
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={preview.url}
              alt="Your debt-free date card"
              data-testid="share-card-preview"
              className="w-full h-auto rounded-nested-2 border border-border"
            />
            <p className="text-xs text-muted-foreground">
              This is exactly what will be shared. It shows a date only, never
              your balances.
            </p>
            <button
              type="button"
              className="btn btn-md btn-primary w-full"
              data-testid="share-card-confirm"
              onClick={confirm}
              disabled={busy}
            >
              Share image
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
