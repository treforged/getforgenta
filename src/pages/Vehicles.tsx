import PanelBar from '@/components/shared/PanelBar';
import SurfaceGuide from '@/components/shared/SurfaceGuide';
import { useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/calculations';
import { getCarFundSaved } from '@/lib/vehicle-loan-engine';
import { useCarFunds, useAccounts } from '@/hooks/useSupabaseData';
import { useDemo } from '@/contexts/DemoContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import Builds from '@/pages/Builds';
import { garageTabFromSearch, normalizeGarageTab, type GarageTab } from '@/lib/garage-tab';
import { Car, Wrench, ArrowRight } from 'lucide-react';
import { fmtDate } from '@/components/vehicles/vehicle-format';

/**
 * THE GARAGE — the cars themselves, their builds and their servicing.
 *
 * ⚠️ THE MONEY IS NOT HERE ANY MORE (2026-08-27). Tre: *"move saving for down payment and active
 * loans to the auto loans section inside the debt payoff tab. it makes more since there. garage
 * will just be the list of cars, the builds page, and maintenance"*. The down-payment plans and the
 * loan cards — with every write they made — live in `VehicleMoneyPanels`, mounted on /debt's Auto
 * Loans tab, which already read the same loans through the engine. Maintenance rides with Builds,
 * where the log has always been.
 *
 * What is left here is the roster: every car, which phase it is in, and one tap through to the
 * money. It quotes figures the money panel already resolved (`getCarFundSaved`) and derives
 * nothing of its own — a second derivation is how two pages start disagreeing about one car.
 */

export default function Vehicles() {
  const { data: carFunds, loading } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { isDemo } = useDemo();

  // ⚠️ THE KEY IS STILL `tre:vehicles:activeTab`, and it still holds `'saving'` or `'loan'` for
  // every user who was last on one of the panels that moved. `normalizeGarageTab` lands those on
  // the car list rather than on a panel that no longer renders; renaming the key would have reset
  // the remembered tab for everyone to buy nothing.
  const [storedTab, setActiveTab] = usePersistedState<GarageTab>('tre:vehicles:activeTab', 'vehicles');
  const activeTab = normalizeGarageTab(storedTab);
  const [searchParams, setSearchParams] = useSearchParams();

  // A deep link (`/vehicles?tab=builds`, which is where the old `/builds` route now lands) names the
  // panel it means; the persisted tab cannot, because a redirect writes no localStorage. Honoured
  // once, then stripped so a later reload is a plain visit and the user's own tab wins again.
  const askedTab = garageTabFromSearch(searchParams);
  useEffect(() => {
    if (!askedTab) return;
    setActiveTab(askedTab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [askedTab, searchParams, setSearchParams, setActiveTab]);

  const accountMap = useMemo(() => {
    const map: Record<string, { name: string; balance: number }> = {};
    accounts.forEach(a => { map[a.id] = { name: a.name, balance: Number(a.balance) }; });
    return map;
  }, [accounts]);

  // Saving cars first, then the loans — the order a car actually travels in.
  const roster = useMemo(() => {
    const phaseRank = (c: typeof carFunds[number]) => ((c.phase ?? 'saving') === 'saving' ? 0 : 1);
    return [...carFunds].sort((a, b) => phaseRank(a) - phaseRank(b) || a.vehicle_name.localeCompare(b.vehicle_name));
  }, [carFunds]);

  if (loading) return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32 bg-muted/50" />
          <Skeleton className="h-3 w-52 bg-muted/50" />
        </div>
        <Skeleton className="h-8 w-36 bg-muted/50" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-28 bg-muted/50" />
        <Skeleton className="h-8 w-24 bg-muted/50" />
      </div>
      {[0, 1].map(i => (
        <div key={i} className="card-forged p-4 sm:p-5 space-y-3">
          <Skeleton className="h-4 w-40 bg-muted/50" />
          <Skeleton className="h-3 w-24 bg-muted/50" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto stack-section overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight">Garage</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Every car you own or are saving for, its build and its servicing</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SurfaceGuide surface="garage" />
        </div>
      </div>

      {isDemo && (
        <div className="card-forged p-4 sm:p-5 border-primary/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="shrink-0 w-1.5 h-8 bg-primary rounded-full mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground">The cars themselves - the money for them lives on Debt Payoff</p>
              <p className="text-xs text-muted-foreground mt-0.5">Jordan's Civic is here with its build thread and service log. The down payment being saved for it, and the loan once it is bought, are on the Auto Loans tab of Debt Payoff.</p>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Link to="/auth" className="text-xs font-semibold text-primary hover:underline">Use with your own data →</Link>
          </div>
        </div>
      )}

      {/* The pill row and the panels it switches are ONE group (`stack-row`): a control row
          belongs to the content below it. See the vertical-rhythm block in `src/index.css`. */}
      <div className="stack-row">
      <PanelBar>
        {/* Builds leads the row (Tre, 2026-08-27: "put builds first on garage page"). */}
        <button onClick={() => setActiveTab('builds')}
          className={`seg-item btn-press ${activeTab === 'builds' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Wrench size={13} /> Builds
        </button>
        <button onClick={() => setActiveTab('vehicles')}
          className={`seg-item btn-press ${activeTab === 'vehicles' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Car size={13} /> Vehicles
          {roster.length > 0 && <span className={`seg-badge ${activeTab === 'vehicles' ? 'seg-badge-active' : ''}`}>{roster.length}</span>}
        </button>
      </PanelBar>

      {/*
        ⚠️ RENDERED, NOT LINKED TO - and `Builds` is unchanged from when it was its own route. It
        owns its build switcher, its own "New Build" button and every write it ever made, so hosting
        it here is a change of shell and nothing else. It is mounted only on its own tab, so the
        page does not pay for its four queries while a user is looking at the roster.
      */}
      {activeTab === 'builds' && <Builds />}

      {activeTab === 'vehicles' && (
        <div className="space-y-3">
          {roster.map(cf => {
            const isLoan = cf.phase === 'loan';
            const linkedAccount = cf.linked_account ? accountMap[cf.linked_account] : null;
            const saved = isLoan ? 0 : getCarFundSaved(cf, null, linkedAccount ? linkedAccount.balance : null);
            return (
              <div key={cf.id} className="card-forged p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Car size={16} className={`shrink-0 ${isLoan ? 'text-success' : 'text-primary'}`} />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate">{cf.vehicle_name}</h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {isLoan
                        ? `Owned · ${cf.expected_apr}% APR · ${cf.loan_term_months} mo loan`
                        : `Saving · ${formatCurrency(saved, false)} of ${formatCurrency(cf.down_payment_goal, false)} down${cf.planned_purchase_date ? ` · buying ${fmtDate(cf.planned_purchase_date)}` : ''}`}
                    </p>
                  </div>
                </div>
                {/* The money is EDITED on Debt Payoff, not here. The link names the tab, because a
                    user last on Credit Card Payoff would otherwise land on cards. */}
                <Link
                  to="/debt?tab=auto"
                  className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  Money <ArrowRight size={11} />
                </Link>
              </div>
            );
          })}
          {roster.length === 0 && (
            <div className="card-forged p-12 text-center">
              <Car size={32} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No vehicles yet.</p>
              <Link to="/debt?tab=auto" className="mt-2 text-xs text-primary hover:underline block">Add one on Debt Payoff →</Link>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
