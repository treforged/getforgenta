/// <reference types="vite/client" />

// Native bridge flags - AppDelegate.swift polls these on fresh process start
// before lifting the launch cover (see App.tsx / Auth.tsx / Dashboard.tsx / Onboarding.tsx).
interface Window {
  __forgenta_app_ready?: boolean;
  __forgenta_dashboard_ready?: boolean;
}
