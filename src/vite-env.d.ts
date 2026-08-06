/// <reference types="vite/client" />

// Minimal shape of the Plaid Link JS SDK loaded from Plaid's CDN (see PlaidOAuth.tsx /
// PlaidLinkButton.tsx) — not an npm package, so there's no vendor-provided type to import.
interface PlaidLinkMetadata {
  institution?: { institution_id?: string | null; name?: string | null } | null;
  [key: string]: unknown;
}

interface PlaidLinkHandler {
  open: () => void;
}

interface PlaidLinkConfig {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (public_token: string, metadata: PlaidLinkMetadata) => void;
  // Plaid passes metadata as the second argument. It carries the institution the
  // user selected, which is what tells us whether an Akoya fallback exists.
  onExit?: (
    err: { error_code?: string; error_type?: string; error_message?: string } | null,
    metadata?: PlaidLinkMetadata,
  ) => void;
  onEvent?: (eventName: string) => void;
}

// Native bridge flags - AppDelegate.swift polls these on fresh process start
// before lifting the launch cover (see App.tsx / Auth.tsx / Dashboard.tsx / Onboarding.tsx).
interface Window {
  __forgenta_app_ready?: boolean;
  __forgenta_dashboard_ready?: boolean;
  Plaid?: {
    create: (config: PlaidLinkConfig) => PlaidLinkHandler;
  };
}
