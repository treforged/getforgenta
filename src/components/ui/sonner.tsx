import type React from "react";
import { Toaster as SonnerPrimitive } from "sonner";

const Toaster = ({ ...props }) => {
  return (
    <SonnerPrimitive
      theme="dark"
      className="toaster group"
      // ⚠️ THE APP'S COLOURS GO IN THROUGH SONNER'S OWN VARIABLES, NOT THROUGH CLASSES. Sonner
      // paints `[data-sonner-toast][data-styled=true] { background: var(--normal-bg) ... }`, which
      // outranks the `group-[.toaster]:bg-card` utilities below - measured 2026-09-22, every toast
      // rendered sonner's pure black (rgb 0,0,0) with #fcfcfc text in BOTH themes, so light mode
      // showed a black slab. Inline variables on the toaster outrank sonner's theme selectors, and
      // they follow the app theme because the tokens do. Gate: npm run check:toast-contrast.
      style={{
        '--normal-bg': 'hsl(var(--card))',
        '--normal-text': 'hsl(var(--foreground))',
        '--normal-border': 'hsl(var(--border))',
        '--border-radius': 'var(--radius)',
      } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          // ⚠️ REM, BECAUSE SONNER'S OWN DEFAULT IS A FIXED 13px. Found by the text-scaling
          // gate, which caught a toast reading "Demo mode" sitting at 13px while all 125 other
          // sampled elements grew with the root. Tre asked for the type to follow the device
          // size; a toast that ignores it is the one piece of text that stays small exactly
          // when somebody has asked for large text. `text-sm`/`text-xs` are rem, so they move.
          title: "group-[.toast]:text-sm",
          description: "group-[.toast]:text-muted-foreground! group-[.toast]:text-xs",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
