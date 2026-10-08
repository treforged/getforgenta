/**
 * One share button for every share card (the debt-free date and earned badges).
 *
 * OPT-IN AND PREVIEWED: pressing Share only renders the card; the image leaves the device only
 * after the user has seen exactly that image and pressed "Share image". The renderer refuses any
 * spec that carries a money figure (see share-card.ts), and the share sheet gets the image plus a
 * tagged link (see share-card-render.ts). Nothing is ever sent without the user's press.
 *
 * Extracted 2026-09-30 from ShareDebtFreeButton so a second card did not mean a second copy of
 * the dialog, the Escape handling and the object-URL cleanup.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ShareCardSpec } from '@/lib/share-card';
import { renderShareCard, shareCardImage, type ShareCardOptions } from '@/lib/share-card-render';

type Preview = { blob: Blob; url: string };

export interface ShareCardButtonProps {
  spec: ShareCardSpec | null;
  /** Dialog heading and the button's accessible name, e.g. "Share your debt-free date". */
  title: string;
  /** One line under the preview saying what the image does and does not show. */
  note: string;
  imageAlt: string;
  filename: string;
  share: ShareCardOptions;
  buttonTestId: string;
  /** Icon only (a dense list) or icon and "Share" (a header). */
  compact?: boolean;
}

export default function ShareCardButton({
  spec, title, note, imageAlt, filename, share, buttonTestId, compact = false,
}: ShareCardButtonProps) {
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
      const outcome = await shareCardImage(preview.blob, filename, share);
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
  // moment the spec moves between null and a card, and React throws on that.
  if (spec === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={busy}
        data-testid={buttonTestId}
        aria-label={title}
        className="shrink-0 flex items-center gap-1 border border-primary/40 text-primary px-2 py-1 text-[9px] sm:text-[10px] font-medium btn-press hover:bg-primary/20 rounded-nested-2"
      >
        <Share2 size={11} aria-hidden="true" />
        {!compact && 'Share'}
      </button>

      {/* PORTALLED to <body>. Rendered in place, a card with backdrop-filter becomes the containing
          block for `fixed`, so the dialog was clipped inside the card with its top cut off and no
          page backdrop - found in a rendered frame, not by the press test. */}
      {preview && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={close}
        >
          <div
            className="card-forged w-full max-w-sm p-4 space-y-3"
            style={{ borderRadius: 'var(--radius)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold">{title}</h2>
              <button
                type="button"
                aria-label="Close"
                className="shrink-0 min-w-[44px] min-h-[44px] -my-3 -mr-3 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors btn-press"
                onClick={close}
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={preview.url}
              alt={imageAlt}
              data-testid="share-card-preview"
              className="w-full h-auto rounded-nested-2 border border-border"
            />
            <p className="text-xs text-muted-foreground">{note}</p>
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
