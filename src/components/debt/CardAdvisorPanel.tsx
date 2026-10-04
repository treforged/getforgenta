import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { FIELD_INPUT } from '@/components/shared/field-classes';
import { formatCurrency } from '@/lib/calculations';
import { useAccounts, type AccountRow } from '@/hooks/useSupabaseData';
import {
  DEBIT_ACCOUNT_TYPES, PURCHASE_CATEGORIES, parseCardRewards, parseWelcomeOffer, rankCardsForPurchase,
  type CardOption, type PurchaseCategory,
} from '@/lib/card-for-purchase';
import { isCardOpenAsOf } from '@/lib/card-start-date';
import CatalogPicker from './CatalogPicker';

/**
 * "Which card for this purchase?" - the Debt page's Use panel (ask 1f3217bb).
 *
 * The ranking lives in `rankCardsForPurchase`; this panel only gathers the amount and category, shows
 * the answer in one sentence, and lets the user type each card's rewards rates and welcome offer,
 * because nothing else in the app knows them. With no rates entered it still answers on interest.
 */

const CATEGORY_LABEL: Record<PurchaseCategory, string> = {
  groceries: 'Groceries', gas: 'Gas', dining: 'Dining', travel: 'Travel', other: 'Other',
};

function answer(top: CardOption, runnerUp: CardOption | undefined): string {
  const parts: string[] = [];
  if (top.rewardsEarned !== null) parts.push(`you earn about ${formatCurrency(top.rewardsEarned)}`);
  if (top.offerValue !== null) parts.push(`it counts ${formatCurrency(top.offerValue)} toward its welcome bonus`);
  parts.push(top.isDebit ? 'it is your debit card, so this comes out of checking now and costs no interest'
    : top.monthlyInterest === 0 ? 'its balance is $0, so paid in full this costs nothing'
      : `it adds about ${formatCurrency(top.monthlyInterest ?? 0)} of interest a month`);
  let line = `Use ${top.isDebit ? `the debit card on ${top.name}` : top.name}: ${parts.join(', ')}.`;
  if (runnerUp && runnerUp.monthlyInterest !== null && runnerUp.monthlyInterest > 0) {
    line += ` ${runnerUp.name} carries a balance, so this would cost about ${formatCurrency(runnerUp.monthlyInterest)} a month there.`;
  }
  return line;
}

function RewardsEditor({ card, onSave }: { card: AccountRow; onSave: (patch: Partial<AccountRow>) => void }) {
  const rewards = parseCardRewards(card.card_rewards);
  const offer = parseWelcomeOffer(card.welcome_offer);
  const [base, setBase] = useState(rewards ? String(rewards.base_pct) : '');
  const [cats, setCats] = useState<Partial<Record<PurchaseCategory, string>>>(
    Object.fromEntries(Object.entries(rewards?.categories ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [spend, setSpend] = useState(offer ? String(offer.required_spend) : '');
  const [spent, setSpent] = useState(offer ? String(offer.spent) : '');
  const [bonus, setBonus] = useState(offer ? String(offer.bonus_value) : '');
  const [deadline, setDeadline] = useState(offer?.deadline ?? '');

  const save = () => {
    const categories = Object.fromEntries(
      Object.entries(cats).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)]),
    );
    const nextRewards = base === '' ? null : parseCardRewards({ base_pct: Number(base), categories });
    const nextOffer = spend === '' ? null
      : parseWelcomeOffer({ required_spend: Number(spend), spent: Number(spent || 0), bonus_value: Number(bonus), deadline });
    onSave({ card_rewards: nextRewards as AccountRow['card_rewards'], welcome_offer: nextOffer as AccountRow['welcome_offer'] });
  };

  const pct = (label: string, value: string, set: (v: string) => void) => (
    // Bottom-packed so every box in a row lines up whatever its caption does (form-control-theming rule).
    <label className="text-[11px] text-muted-foreground flex h-full flex-col justify-end">
      {label}
      <input className={FIELD_INPUT} inputMode="decimal" value={value} onChange={e => set(e.target.value)} placeholder="%" />
    </label>
  );

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      {/* Public rates fill the fields below; every field stays editable, so the user can override any
          of them before saving (ask f9b0da16). */}
      <CatalogPicker onApply={r => {
        setBase(String(r.base_pct));
        setCats(Object.fromEntries(Object.entries(r.categories ?? {}).map(([k, v]) => [k, String(v)])));
      }} />
      <div className="grid grid-cols-3 gap-2">
        {pct('Everything else', base, setBase)}
        {PURCHASE_CATEGORIES.filter(c => c !== 'other').map(c => (
          <div key={c}>{pct(CATEGORY_LABEL[c], cats[c] ?? '', v => setCats(prev => ({ ...prev, [c]: v })))}</div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Welcome offer (optional): spend this much by the date to earn the bonus.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted-foreground">Spend required<input className={FIELD_INPUT} inputMode="decimal" value={spend} onChange={e => setSpend(e.target.value)} /></label>
        <label className="text-[11px] text-muted-foreground">Spent so far<input className={FIELD_INPUT} inputMode="decimal" value={spent} onChange={e => setSpent(e.target.value)} /></label>
        <label className="text-[11px] text-muted-foreground">Bonus worth ($)<input className={FIELD_INPUT} inputMode="decimal" value={bonus} onChange={e => setBonus(e.target.value)} /></label>
        <label className="text-[11px] text-muted-foreground">By<input className={FIELD_INPUT} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
      </div>
      <button type="button" onClick={save} className="btn-press bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold" style={{ borderRadius: 'var(--radius)' }}>
        Save rates
      </button>
    </div>
  );
}

export default function CardAdvisorPanel() {
  const { data: accounts, update } = useAccounts();
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<PurchaseCategory>('other');
  const [editing, setEditing] = useState<string | null>(null);

  // A card whose start date is still ahead is a PLAN, not a card in the wallet, so it is left out of the
  // list and the answer alike (Tre, 2026-10-01). Same rule as the start-of-month update notice.
  const cards = useMemo(() => {
    const today = new Date();
    // Credit cards first, then checking accounts' debit cards (ask 37c89404, Tre 2026-10-01).
    const credit = (accounts ?? []).filter(a => a.account_type === 'credit_card' && a.active && isCardOpenAsOf(a, today));
    const debit = (accounts ?? []).filter(a => DEBIT_ACCOUNT_TYPES.includes(a.account_type) && a.active);
    return [...credit, ...debit];
  }, [accounts]);
  const amount = Number(amountText.replace(/[$,]/g, ''));
  const result = useMemo(() => rankCardsForPurchase({
    cards: cards.map(a => ({
      id: a.id, name: a.name, account_type: a.account_type, active: a.active,
      balance: a.balance, apr: a.apr ?? null, credit_limit: a.credit_limit ?? null, card_start_date: a.card_start_date ?? null,
      rewards: parseCardRewards(a.card_rewards),
      welcomeOffer: parseWelcomeOffer(a.welcome_offer),
    })),
    amount, category, today: new Date(),
  }), [cards, amount, category]);

  if (cards.length === 0) {
    return (
      <div className="card-forged p-4" data-testid="card-advisor">
        <p className="text-sm font-semibold">No cards yet</p>
        <p className="text-xs text-muted-foreground mt-1">Add a credit card or a checking account and this tells you which one to use for a purchase.</p>
      </div>
    );
  }

  const noRates = cards.every(a => !parseCardRewards(a.card_rewards));
  const [top, runnerUp] = result.ranked;

  return (
    <div className="space-y-3" data-testid="card-advisor">
      <div className="card-forged p-4 space-y-3">
        <h2 className="text-sm font-semibold">Which card for this purchase?</h2>
        <label className="block text-xs text-muted-foreground">
          Amount
          <input className={FIELD_INPUT} inputMode="decimal" placeholder="$0.00" value={amountText}
            onChange={e => setAmountText(e.target.value)} aria-label="Purchase amount" />
        </label>
        <SegmentedControl label="Purchase category" value={category} onSelect={setCategory}
          options={PURCHASE_CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABEL[c] }))} />
        {top ? (
          <p className="text-sm" data-testid="card-advisor-answer">{answer(top, runnerUp)}</p>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="card-advisor-answer">
            {amount > 0 ? 'None of your open cards has room for this purchase, and no checking account has the cash.' : 'Enter an amount to compare your cards.'}
          </p>
        )}
        {noRates && (
          <p className="text-[11px] text-muted-foreground">
            Ranked on interest only. Add each card's rewards rates below to compare what you earn.
          </p>
        )}
      </div>

      <div className="card-forged p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your cards</h3>
        {cards.map(a => {
          const opt = result.ranked.find(r => r.id === a.id);
          const out = result.excluded.find(e => e.id === a.id);
          return (
            <div key={a.id} className="py-2 border-b border-border last:border-0">
              {/* One line per card from sm: name, the answer for this amount, then the rewards link
                  (ask 1be673ad: stacked, the row left 1101px of a 1296px card unused at 1440). On a
                  phone the link wraps under the name as before. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium min-w-0 truncate flex-1">
                  {a.name}
                  {DEBIT_ACCOUNT_TYPES.includes(a.account_type) && <span className="text-[11px] text-muted-foreground font-normal"> · Debit</span>}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {out?.why === 'not-open' ? `Opens ${a.card_start_date}`
                    : out?.why === 'over-limit' ? 'Not enough room'
                      : out?.why === 'not-enough-cash' ? 'Not enough cash'
                      : opt && amount > 0 ? `Net ${formatCurrency(opt.netValue)}` : ''}
                </span>
                <button type="button" className="text-[11px] text-primary hover:underline shrink-0 basis-full sm:basis-auto text-left"
                  onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>
                  {editing === a.id ? 'Close' : 'Rewards & welcome offer'}
                </button>
              </div>
              {editing === a.id && (
                <RewardsEditor card={a} onSave={patch => { update.mutate({ id: a.id, ...patch }); setEditing(null); }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
