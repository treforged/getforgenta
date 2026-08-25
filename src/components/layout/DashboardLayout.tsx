import { Outlet, Link } from 'react-router';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import MobileTopBar from './MobileTopBar';
import DemoBanner from '@/components/shared/DemoBanner';
import PartnerViewBanner from '@/components/shared/PartnerViewBanner';
import { useDemo } from '@/contexts/DemoContext';
import { CardProjectionProvider } from '@/contexts/CardProjectionContext';
import { useAutoEndSyncReconcile } from '@/hooks/useAutoEndReconcile';

export default function DashboardLayout() {
  const { isDemo } = useDemo();
  // 97.3 — balance-sync landing: refresh stale goal auto-end stamps once per app session.
  useAutoEndSyncReconcile();
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex min-h-0 flex-col min-w-0">
        {/* Sticky, so the hamburger is on screen at every scroll position on every route — the
            "at all times" half of Tre's instruction. `MobileTopBar` renders nothing at lg+, where
            the rail already carries the brand and a permanent Settings row. */}
        {/* ⚠️ ONE OWNER FOR THE TOP SAFE-AREA INSET, AND IT IS THIS DIV.
            `viewport-fit=cover` puts the web view under the status bar, and this element is the
            top of the content column at EVERY breakpoint — which none of its children are.
            `MobileTopBar` is `lg:hidden`, `DemoBanner` only exists in demo, and `main` scrolls.
            Any of them owning the inset is only right for some of the app, which is exactly how
            it went wrong: the inset lived on `main` as `pt-safe`, so the bar sat UNDER the clock
            (its hamburger untappable, and with it the only route to Settings) while the content
            below carried a status-bar-sized gap. Two complaints, one misplaced line.
            ⚠️ Do not re-add `env(safe-area-inset-top)` to a child of this div. It will double. */}
        <div className="sticky top-0 z-40 bg-background" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <MobileTopBar />
          <DemoBanner />
          {/* The partner-view lens announces itself exactly the way demo does: a
              persistent strip in the sticky header, on every route it applies to. */}
          <PartnerViewBanner />
        </div>

        <main
          id="scroll-main"
          className={`
            flex-1
            min-h-0
            min-w-0
            overflow-y-auto
            px-3
            pb-[calc(5.5rem+env(safe-area-inset-bottom))]
            pt-3
            sm:px-4
            lg:px-6
            lg:pb-8
            lg:pt-4
          `}
          style={{ touchAction: 'pan-y', overflowX: 'hidden' }}
        >
          <CardProjectionProvider>
            <div style={{ overflow: 'hidden', minWidth: '0', width: '100%' }}>
              <Outlet />
            </div>
          </CardProjectionProvider>
        </main>

        <footer className="hidden lg:block border-t border-border py-4 px-6">
          <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} Forgenta&#8482; by TRE Forged LLC. All rights reserved.</span>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </footer>
      </div>

      <MobileNav />
    </div>
  );
}