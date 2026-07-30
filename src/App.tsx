import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Capacitor } from '@capacitor/core';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DemoProvider, useDemo } from "@/contexts/DemoContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import BlackScreenDebug from "@/components/debug/BlackScreenDebug";
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/lib/supabase';
import DashboardLayout from "@/components/layout/DashboardLayout";
import CookieBanner from "@/components/shared/CookieBanner";
import Analytics from "@/components/shared/Analytics";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import FeatureInDevelopment from "@/components/shared/FeatureInDevelopment";
import { AI_ADVISOR_ENABLED } from "@/lib/feature-flags";
import { Sparkles } from "lucide-react";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

const Auth = lazy(() => import("@/pages/Auth"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));

const Transactions = lazy(() => import("@/pages/Transactions"));
const DebtPayoff = lazy(() => import("@/pages/DebtPayoff"));
const SavingsGoals = lazy(() => import("@/pages/SavingsGoals"));
const NetWorth = lazy(() => import("@/pages/NetWorth"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Premium = lazy(() => import("@/pages/Premium"));
const PremiumSuccess = lazy(() => import("@/pages/PremiumSuccess"));
const PremiumCancel = lazy(() => import("@/pages/PremiumCancel"));
const BudgetControl = lazy(() => import("@/pages/BudgetControl"));
const Forecast = lazy(() => import("@/pages/Forecast"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const Legal = lazy(() => import("@/pages/Legal"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const AiAdvisor = lazy(() => import("@/pages/AiAdvisor"));
const Vehicles = lazy(() => import("@/pages/Vehicles"));
const Builds = lazy(() => import("@/pages/Builds"));
const PlaidOAuth = lazy(() => import("@/pages/PlaidOAuth"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const BuildShare = lazy(() => import("@/pages/BuildShare"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Enable OS font-size accessibility scaling on native (Capacitor) platforms.
// index.css html.native overrides -webkit-text-size-adjust to none.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native');
}

// One-time purge of orphaned passkey session tokens written by an older code path.
// Runs at module load so it executes before any auth flow, on every platform.
(['forged:signin_passkey_tokens', 'forgenta:signin_passkey_tokens'] as const).forEach(k =>
  localStorage.removeItem(k)
);

// Sets window.__forgenta_app_ready when React has mounted.
// AppDelegate polls this flag on fresh process start before lifting the cover.
function AppReadySignal() {
  useEffect(() => {
    window.__forgenta_app_ready = true;
    return () => { window.__forgenta_app_ready = false; };
  }, []);
  return null;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}

function ProtectedRoute({ children, skipOnboardingCheck }: { children: React.ReactNode; skipOnboardingCheck?: boolean }) {
  const { user, loading } = useAuth();
  const { isDemo } = useDemo();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><span className="text-sm text-muted-foreground animate-pulse">Authenticating…</span></div>;
  if (!user && !isDemo) return <Navigate to="/auth" replace />;
  if (!skipOnboardingCheck && user && !isDemo) {
    const done = localStorage.getItem(`forged:onboarding_done_${user.id}`);
    if (!done) return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('scroll-main')?.scrollTo(0, 0);
    document.getElementById('scroll-legal')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Suspense fallback={<PageLoader />}><Auth /></Suspense>} />
      <Route element={<ProtectedRoute><ErrorBoundary><DashboardLayout /></ErrorBoundary></ProtectedRoute>}>
        <Route path="/dashboard" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Dashboard /></ErrorBoundary></Suspense>} />
        <Route path="/accounts" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Accounts /></ErrorBoundary></Suspense>} />
        <Route path="/budget" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><BudgetControl /></ErrorBoundary></Suspense>} />
        <Route path="/transactions" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Transactions /></ErrorBoundary></Suspense>} />
        <Route path="/debt" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><DebtPayoff /></ErrorBoundary></Suspense>} />
        <Route path="/goals" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><SavingsGoals /></ErrorBoundary></Suspense>} />
        <Route path="/vehicles" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Vehicles /></ErrorBoundary></Suspense>} />
        <Route path="/builds" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Builds /></ErrorBoundary></Suspense>} />
        <Route path="/net-worth" element={<Navigate to="/accounts" replace />} />
        <Route path="/forecast" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Forecast /></ErrorBoundary></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><SettingsPage /></ErrorBoundary></Suspense>} />
        <Route path="/ai" element={AI_ADVISOR_ENABLED
          ? <Suspense fallback={<PageLoader />}><ErrorBoundary><AiAdvisor /></ErrorBoundary></Suspense>
          : <FeatureInDevelopment
              title="Forgenta AI"
              icon={<Sparkles size={18} className="text-primary" />}
              message="Forgenta AI is temporarily unavailable while we finish the controls and policies covering how your account data is shared with it. It will be back once that work is done."
            />
        } />
        <Route path="/premium" element={<Suspense fallback={<PageLoader />}><Premium /></Suspense>} />
        <Route path="/premium/success" element={<Suspense fallback={<PageLoader />}><PremiumSuccess /></Suspense>} />
        <Route path="/premium/cancel" element={<Suspense fallback={<PageLoader />}><PremiumCancel /></Suspense>} />
      </Route>
      <Route path="/onboarding" element={
        <ProtectedRoute skipOnboardingCheck>
          <Suspense fallback={<PageLoader />}><Onboarding /></Suspense>
        </ProtectedRoute>
      } />
      <Route path="/oauth" element={
        <ProtectedRoute skipOnboardingCheck>
          <Suspense fallback={<PageLoader />}><PlaidOAuth /></Suspense>
        </ProtectedRoute>
      } />
      <Route path="/auth-callback" element={<Suspense fallback={<PageLoader />}><AuthCallback /></Suspense>} />
      <Route path="/builds/share/:token" element={<Suspense fallback={<PageLoader />}><BuildShare /></Suspense>} />
      <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/terms" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/refund" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/delete-data" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/subscriptions" element={<Navigate to="/budget" replace />} />
      <Route path="/car-fund" element={<Navigate to="/goals" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: { remove: () => void } | null = null;

    CapApp.addListener('appUrlOpen', async (event) => {
      try {
        const incoming = new URL(event.url);
        const host = incoming.host;
        const path = incoming.pathname;

        // OAuth callback from Google / Apple
        if (host === 'auth-callback' || path.includes('auth-callback')) {
          // Dismiss the SFSafariViewController / in-app browser sheet
          Browser.close().catch(() => {});

          // Email-link flow (Confirm Signup etc.). Hand the token straight to the
          // AuthCallback route so verification has exactly one implementation shared
          // by native and web — a user without the app lands on the same page in a browser.
          if (incoming.searchParams.get('token_hash')) {
            navigate(`/auth-callback${incoming.search}`, { replace: true });
            return;
          }

          const code = incoming.searchParams.get('code');

          // PKCE flow
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.error('OAuth code exchange failed:', error);
              navigate('/auth', { replace: true });
              return;
            }

            navigate('/dashboard', { replace: true });
            return;
          }

          // Token/hash fallback
          const hash = incoming.hash.startsWith('#')
            ? incoming.hash.slice(1)
            : incoming.hash;

          const hashParams = new URLSearchParams(hash);
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');

          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });

            if (error) {
              console.error('OAuth session set failed:', error);
              navigate('/auth', { replace: true });
              return;
            }

            navigate('/dashboard', { replace: true });
            return;
          }

          navigate('/auth', { replace: true });
          return;
        }

        // Plaid OAuth return
        if (host === 'oauth' || path.includes('/oauth')) {
          navigate('/oauth', { replace: true });
        }
      } catch (err) {
        console.error('Deep link handling failed:', err);
      }
    }).then((handle) => {
      listener = handle;
    });

    return () => {
      listener?.remove();
    };
  }, [navigate]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      {Capacitor.isNativePlatform() ? (
        <MemoryRouter initialEntries={['/auth']}>
          <AppReadySignal />
          <DemoProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <DeepLinkHandler />
              <AppRoutes />
              <BlackScreenDebug />
            </SubscriptionProvider>
          </AuthProvider>
          </DemoProvider>
        </MemoryRouter>
      ) : (
        <BrowserRouter>
          <DemoProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <DeepLinkHandler />
              <AppRoutes />
              <CookieBanner />
              <Analytics />
            </SubscriptionProvider>
          </AuthProvider>
          </DemoProvider>
        </BrowserRouter>
      )}
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
