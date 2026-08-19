import { lazy, Suspense, useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import ConnectionNotice from '@/components/shared/ConnectionNotice';
import { PageSkeleton } from '@/components/shared/PageSkeleton';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate, useNavigate, useLocation } from "react-router";
import { Capacitor } from '@capacitor/core';
import { MotionConfig } from 'framer-motion';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { DemoProvider, useDemo } from "@/contexts/DemoContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import BlackScreenDebug from "@/components/debug/BlackScreenDebug";
import { captureReferral } from "@/lib/referral";
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/lib/supabase';
import DashboardLayout from "@/components/layout/DashboardLayout";
import CookieBanner from "@/components/shared/CookieBanner";
import Analytics from "@/components/shared/Analytics";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import FeatureInDevelopment from "@/components/shared/FeatureInDevelopment";
import { AI_ADVISOR_ENABLED, ERROR_TEST_ENABLED } from "@/lib/feature-flags";
import { ACCOUNTS_PANEL_PARAM, isAccountsTab } from "@/lib/accounts-tab";
import { Sparkles } from "lucide-react";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

const Auth = lazy(() => import("@/pages/Auth"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));

const Transactions = lazy(() => import("@/pages/Transactions"));
const DebtPayoff = lazy(() => import("@/pages/DebtPayoff"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Premium = lazy(() => import("@/pages/Premium"));
const PremiumSuccess = lazy(() => import("@/pages/PremiumSuccess"));
const PremiumCancel = lazy(() => import("@/pages/PremiumCancel"));
const Forecast = lazy(() => import("@/pages/Forecast"));
const Legal = lazy(() => import("@/pages/Legal"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const AiAdvisor = lazy(() => import("@/pages/AiAdvisor"));
const Vehicles = lazy(() => import("@/pages/Vehicles"));
const Builds = lazy(() => import("@/pages/Builds"));
const PlaidOAuth = lazy(() => import("@/pages/PlaidOAuth"));
const AkoyaOAuth = lazy(() => import("@/pages/AkoyaOAuth"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const BuildShare = lazy(() => import("@/pages/BuildShare"));
const ErrorTest = lazy(() => import("@/components/debug/ErrorTest"));

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

/**
 * Keeps the theme in step for the whole session.
 *
 * ⚠️ IT EXISTS FOR THE `system` LISTENER, not for first paint — the inline script in `index.html`
 * already did that, earlier than React can. What this adds is that a user on "match my device"
 * whose phone flips to dark at sunset flips WITH it, rather than only at the next launch. Mounted
 * here rather than in Settings because a preference that follows the device has to keep following
 * it when nobody is looking at the settings page.
 */
function ThemeSync() {
  useTheme();
  return null;
}

/**
 * How long a route may be "loading" before the app admits something is wrong.
 *
 * Long enough that a slow-but-working connection is never accused — a cold chunk over poor mobile
 * data can legitimately take several seconds — and short enough that nobody sits watching a
 * shimmer that is never going to resolve. Offline is not subject to it: if the device says there
 * is no network, there is nothing to wait for.
 */
const SLOW_ROUTE_MS = 12_000;

function PageLoader() {
  const [tooLong, setTooLong] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setTooLong(true), SLOW_ROUTE_MS);
    return () => clearTimeout(t);
  }, [attempt]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ⚠️ OFFLINE SHOWS IMMEDIATELY; SLOW HAS TO EARN IT. A device that reports no network is a fact,
  // not a suspicion, and making someone watch a shimmer for twelve seconds to be told what their
  // status bar already says is the app pretending not to know.
  if (offline || tooLong) {
    return (
      <ConnectionNotice
        offline={offline}
        // Re-arm the clock rather than reloading. React re-attempts the lazy import on its own; a
        // reload would discard the whole session to retry one file. See ConnectionNotice.
        onRetry={() => { setTooLong(false); setAttempt(a => a + 1); }}
      />
    );
  }

  // ⚠️ THE SHAPE FIRST. `PageSkeleton` holds the layout of what is coming, which a spinner cannot,
  // and this is a route chunk arriving rather than an error — so for the first stretch the honest
  // picture is "your page is on its way", not "something is wrong".
  return <PageSkeleton />;
}

function GateNotice({ label }: { label: string }) {
  return <div className="min-h-screen bg-background flex items-center justify-center"><span className="text-sm text-muted-foreground animate-pulse">{label}</span></div>;
}

function ProtectedRoute({ children, skipOnboardingCheck }: { children: React.ReactNode; skipOnboardingCheck?: boolean }) {
  const { user, loading } = useAuth();
  const { isDemo } = useDemo();
  // `profiles.onboarding_completed` is the store, with the old localStorage key as a cache and a
  // migration source (src/lib/onboarding-state.ts). A device that already holds the key answers
  // immediately; everyone else waits for one small query rather than being bounced into a wizard
  // they finished on another device. `unknown` — the profile could not be read — never gates.
  const onboarding = useOnboardingStatus();
  if (loading) return <GateNotice label="Authenticating…" />;
  if (!user && !isDemo) return <Navigate to="/auth" replace />;
  if (!skipOnboardingCheck && user && !isDemo) {
    if (onboarding.status === 'pending') return <GateNotice label="Loading your setup…" />;
    if (onboarding.status === 'needs-onboarding') return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

/**
 * `/accounts` is no longer a page — it is the Dashboard's second panel (2026-08-18). This is a
 * component and not a bare <Navigate> because the old URL carries LIVE COMMANDS that a fixed
 * destination would drop: `/accounts?new=1&type=checking` opens the add-account form on arrival
 * (`Accounts.tsx`), and `?tab=networth` named a sub-panel. The whole query string rides along; the
 * sub-panel key is translated to `panel=` because the Dashboard's own selector owns `tab=`.
 */
function AccountsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const askedPanel = params.get('tab');
  params.delete('tab');
  if (isAccountsTab(askedPanel)) params.set(ACCOUNTS_PANEL_PARAM, askedPanel);
  params.set('tab', 'accounts');
  return <Navigate to={`/dashboard?${params.toString()}`} replace />;
}

/**
 * Turns demo mode on and lands on the Dashboard — the same two lines `/auth`'s Try Demo
 * button ran, addressable so an automated screenshot run does not depend on a button's
 * position or label. See the route comment below for why it exists and what it does not do.
 */
function DemoEntry() {
  const { setIsDemo } = useDemo();
  useEffect(() => { setIsDemo(true); }, [setIsDemo]);
  return <Navigate to="/dashboard" replace />;
}

/**
 * `/budget` is no longer a page — it is the third panel of the Activity surface (2026-08-18). A
 * component and not a bare <Navigate> so the whole query string rides along, the same reason
 * `AccountsRedirect` is one; nothing writes a `?tab=` at `/budget` today, but a redirect that
 * silently drops the query string is the defect that only shows up the first time something does.
 *
 * ⚠️ THE SIX IN-APP LINKS STILL POINT AT `/budget` ON PURPOSE, and two tests assert that literal
 * href (`DashboardHero.test.tsx`, `ForecastHero.test.tsx`). Repointing them would leave this
 * redirect — the thing every existing bookmark lands on — covered by nothing.
 */
function BudgetRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', 'budget');
  return <Navigate to={`/transactions?${params.toString()}`} replace />;
}

/**
 * `/goals` is no longer a page — it is the Forecast's second panel (Tre, 2026-08-18: "well add
 * goals to forecast then."). A component and not a bare <Navigate> so the whole query string rides
 * along, the same reason `AccountsRedirect` and `BudgetRedirect` are components.
 *
 * ⚠️ THE IN-APP LINKS STILL POINT AT `/goals` ON PURPOSE — the Dashboard chips, two goal cards
 * and `OnboardingChecklist` all do. Repointing them would leave this redirect, which is what every
 * existing bookmark and the `/car-fund` alias land on, covered by nothing. Same call as `/budget`.
 */
function GoalsRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', 'goals');
  return <Navigate to={`/forecast?${params.toString()}`} replace />;
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

/**
 * Records `?ref=` from whatever URL the visitor actually arrived on.
 *
 * ⚠️ THIS RUNS ON EVERY ROUTE ON PURPOSE. The capture used to sit inside `Landing`, so a shared
 * link that pointed anywhere but the home page attributed nothing. It is also the half of the
 * referral chain that was silently broken until 2026-08-18 — see the header of `@/lib/referral`.
 * `captureReferral` is first-capture-wins and validates the code, so running it on every navigation
 * is idempotent and cannot be used to overwrite a pending attribution.
 */
function CaptureReferral() {
  const { search } = useLocation();
  useEffect(() => {
    captureReferral(search);
  }, [search]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <CaptureReferral />
      <Routes>
      <Route path="/" element={<ErrorBoundary label="Home" homeTo={null}><Landing /></ErrorBoundary>} />
      {/* The demo's non-UI entry point.

          Demo mode is in-memory React state with no route and no flag: the ONLY way in has
          always been the "Try Demo" button on `/auth`. Tre is moving that button inside
          sign-up (2026-08-18) so the demo reads as a reference account a new user looks at
          while setting up, rather than as a way past the front door — and asked that it
          "stay reachable for the screenshot script", which drives the real UI and would
          break the moment the button moved.

          ⚠️ This route is deliberately NOT linked from anywhere. It is an address the
          marketing repo's `capture_demo.mjs` can navigate to, nothing more. It grants no
          access to any real account: it flips a local flag that makes the app render
          fixture data, exactly as the button did. */}
      <Route path="/demo" element={<DemoEntry />} />
      <Route path="/auth" element={<ErrorBoundary label="Sign in" homeTo="/"><Suspense fallback={<PageLoader />}><Auth /></Suspense></ErrorBoundary>} />
      {/* The layout boundary is the last line of defence: a crash in the nav or
          the shell itself would otherwise take the whole app white. It offers no
          way-back button because every route lives inside it — retry/reload are
          the only honest options at that level. */}
      <Route element={<ProtectedRoute><ErrorBoundary label="The app" homeTo={null}><DashboardLayout /></ErrorBoundary></ProtectedRoute>}>
        <Route path="/dashboard" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Dashboard" homeTo={null}><Dashboard /></ErrorBoundary></Suspense>} />
        <Route path="/budget" element={<BudgetRedirect />} />
        <Route path="/transactions" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Transactions"><Transactions /></ErrorBoundary></Suspense>} />
        <Route path="/debt" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Debt Payoff"><DebtPayoff /></ErrorBoundary></Suspense>} />
        <Route path="/goals" element={<GoalsRedirect />} />
        <Route path="/vehicles" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Garage"><Vehicles /></ErrorBoundary></Suspense>} />
        {/* Builds is a PANEL of the Garage now, not a route. The redirect keeps every existing
            bookmark and in-app link working and names the panel it meant — see `garage-tab.ts`. */}
        <Route path="/builds" element={<Navigate to="/vehicles?tab=builds" replace />} />
        <Route path="/garage" element={<Navigate to="/vehicles" replace />} />
        <Route path="/accounts" element={<AccountsRedirect />} />
        <Route path="/net-worth" element={<Navigate to="/dashboard?tab=accounts" replace />} />
        <Route path="/forecast" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Forecast"><Forecast /></ErrorBoundary></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Settings"><SettingsPage /></ErrorBoundary></Suspense>} />
        <Route path="/ai" element={AI_ADVISOR_ENABLED
          ? <Suspense fallback={<PageLoader />}><ErrorBoundary label="Forgenta AI"><AiAdvisor /></ErrorBoundary></Suspense>
          : <FeatureInDevelopment
              title="Forgenta AI"
              icon={<Sparkles size={18} className="text-primary" />}
              message="Forgenta AI is temporarily unavailable while we finish the controls and policies covering how your account data is shared with it. It will be back once that work is done."
            />
        } />
        <Route path="/premium" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Premium"><Premium /></ErrorBoundary></Suspense>} />
        <Route path="/premium/success" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Premium"><PremiumSuccess /></ErrorBoundary></Suspense>} />
        <Route path="/premium/cancel" element={<Suspense fallback={<PageLoader />}><ErrorBoundary label="Premium"><PremiumCancel /></ErrorBoundary></Suspense>} />
      </Route>
      <Route path="/onboarding" element={
        <ProtectedRoute skipOnboardingCheck>
          <ErrorBoundary label="Setup"><Suspense fallback={<PageLoader />}><Onboarding /></Suspense></ErrorBoundary>
        </ProtectedRoute>
      } />
      <Route path="/oauth" element={
        <ProtectedRoute skipOnboardingCheck>
          <ErrorBoundary label="Bank connection"><Suspense fallback={<PageLoader />}><PlaidOAuth /></Suspense></ErrorBoundary>
        </ProtectedRoute>
      } />
      {/* Akoya redirects here after consent. Must match AKOYA_REDIRECT_URI
          exactly and be registered in the Data Recipient Hub. */}
      <Route path="/akoya-oauth" element={
        <ProtectedRoute skipOnboardingCheck>
          <ErrorBoundary label="Bank connection"><Suspense fallback={<PageLoader />}><AkoyaOAuth /></Suspense></ErrorBoundary>
        </ProtectedRoute>
      } />
      <Route path="/auth-callback" element={<ErrorBoundary label="Sign in" homeTo="/"><Suspense fallback={<PageLoader />}><AuthCallback /></Suspense></ErrorBoundary>} />
      <Route path="/builds/share/:token" element={<ErrorBoundary label="This build" homeTo="/"><Suspense fallback={<PageLoader />}><BuildShare /></Suspense></ErrorBoundary>} />
      <Route path="/privacy" element={<ErrorBoundary label="This page" homeTo="/"><Suspense fallback={<PageLoader />}><Legal /></Suspense></ErrorBoundary>} />
      <Route path="/terms" element={<ErrorBoundary label="This page" homeTo="/"><Suspense fallback={<PageLoader />}><Legal /></Suspense></ErrorBoundary>} />
      <Route path="/refund" element={<ErrorBoundary label="This page" homeTo="/"><Suspense fallback={<PageLoader />}><Legal /></Suspense></ErrorBoundary>} />
      <Route path="/delete-data" element={<ErrorBoundary label="This page" homeTo="/"><Suspense fallback={<PageLoader />}><Legal /></Suspense></ErrorBoundary>} />
      {/* Deliberate-crash route for proving the error pipeline. Off in
          production unless VITE_ENABLE_ERROR_TEST=1 — when the flag is unset
          the route is never registered, so it falls through to the 404 like
          any other unknown path. Public (no ProtectedRoute) so the pipeline
          can be proven without a signed-in account and therefore without
          putting real balances on screen. */}
      {ERROR_TEST_ENABLED && (
        <Route path="/__error-test" element={
          <ErrorBoundary label="Error tracking smoke test" homeTo="/">
            <Suspense fallback={<PageLoader />}><ErrorTest /></Suspense>
          </ErrorBoundary>
        } />
      )}
      {/* Straight to the destination, not through /budget — a redirect into a redirect. */}
      <Route path="/subscriptions" element={<Navigate to="/transactions?tab=budget" replace />} />
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
    {/* Every animation in the app is inside this boundary, and that is the
        point: `reducedMotion="user"` makes "reduce motion" the default answer
        for anyone whose OS asks for it, rather than a thing each new component
        has to remember to check. It neutralises transform and layout animation
        automatically and leaves opacity alone, which is the correct split — a
        cross-fade is not what makes people motion-sick.

        It does NOT reach animation that is not a motion value: a number
        counting up, or recharts drawing its own line. Those ask
        `usePrefersReducedMotion()` directly. */}
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <Sonner />
      {Capacitor.isNativePlatform() ? (
        <MemoryRouter initialEntries={['/auth']}>
          <AppReadySignal />
      <ThemeSync />
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
    </MotionConfig>
  </QueryClientProvider>
);

export default App;
