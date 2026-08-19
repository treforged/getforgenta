import { createPortal } from 'react-dom';
import { useEffect } from 'react';

interface Props {
  onDismiss: () => void;
  children: React.ReactNode;
  zIndex?: string;
}

export default function ModalShell({ onDismiss, children, zIndex = 'z-50' }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

// ⚠️ PORTALLED TO `document.body`. See `CalcDrawer.tsx` for the full reason: on iOS WebKit a
// `position: fixed` overlay rendered inside `main` — an `overflow-y: auto` scroller — resolves
// against the SCROLLER rather than the viewport, so its scrim stops short of the screen edges and
// leaves the status-bar strip undimmed. Desktop browsers do not reproduce it. z-index cannot fix
// it, because z-index does not escape a containing block.
  return createPortal((
    <div
      className={`modal-overlay ${zIndex} bg-background/85 backdrop-blur-sm`}
      onClick={onDismiss}
    >
      <div
        className="card-forged w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-full"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  ), document.body);
}
