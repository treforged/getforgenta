import { useMemo, useState } from 'react';
import { FIELD_INPUT } from '@/components/shared/field-classes';
import { ToggleSwitch } from '@/components/shared/ToggleSwitch';
import type { CardRewards } from '@/lib/card-for-purchase';
import {
  CARD_CATALOG, findCatalogProduct, resolveCatalogRewards,
  type CatalogProduct, type ConditionKey, type ConditionalRate, type SourcedRate,
} from '@/lib/card-catalog';

/**
 * "Fill from a public card" inside the Which Card? rewards editor (ask f9b0da16, slice 2).
 *
 * Picking a product resolves its PUBLISHED rates (src/lib/card-catalog.ts) and hands them to the editor,
 * where every field stays editable - the user can override any rate. The three rules that keep it
 * honest live in the resolver and are only surfaced here:
 *   - a membership question left unanswered takes the LOWER rate (Sam, 2026-10-01);
 *   - miles are not turned into a percentage until the user says what a mile is worth to them;
 *   - a rate that is stale or unread (Discover's quarter) is listed as unknown, never guessed.
 * Each product shows the issuer page it was read from and the date it was checked.
 */

function conditionsOf(product: CatalogProduct): ConditionalRate[] {
  const all = [product.base, ...Object.values(product.categories)] as (SourcedRate | ConditionalRate)[];
  const seen = new Set<ConditionKey>();
  return all.filter((r): r is ConditionalRate => {
    if (!('condition' in r) || seen.has(r.condition)) return false;
    seen.add(r.condition);
    return true;
  });
}

function sourceOf(product: CatalogProduct): { url: string; checked: string } {
  const b = product.base;
  const s = 'condition' in b ? b.with : b;
  return { url: s.source_url, checked: s.checked_on };
}

export default function CatalogPicker({ onApply }: { onApply: (rewards: CardRewards) => void }) {
  const [productId, setProductId] = useState('');
  const [answers, setAnswers] = useState<Partial<Record<ConditionKey, boolean>>>({});
  const [cpmText, setCpmText] = useState('');
  const product = productId ? findCatalogProduct(productId) : null;
  const cpm = cpmText.trim() === '' ? null : Number(cpmText);

  const resolved = useMemo(
    () => (product ? resolveCatalogRewards(product, { today: new Date(), answers, centsPerMile: cpm }) : null),
    [product, answers, cpm],
  );

  return (
    <div className="space-y-2" data-testid="catalog-picker">
      <label className="text-[11px] text-muted-foreground block">
        Fill from a public card
        <select
          className={FIELD_INPUT}
          value={productId}
          onChange={e => { setProductId(e.target.value); setAnswers({}); setCpmText(''); }}
          aria-label="Fill from a public card"
        >
          <option value="">Choose a card...</option>
          {CARD_CATALOG.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      {product && resolved && (
        <div className="space-y-2 text-[11px] text-muted-foreground">
          {conditionsOf(product).map(c => (
            <span key={c.condition} className="flex items-center gap-2">
              <ToggleSwitch
                checked={answers[c.condition] === true}
                onPress={() => setAnswers(prev => ({ ...prev, [c.condition]: !(prev[c.condition] === true) }))}
                label={c.question}
              />
              <span>{c.question}</span>
            </span>
          ))}
          {product.unit === 'miles' && (
            <label className="block">
              What is one mile worth to you, in cents?
              <input className={FIELD_INPUT} inputMode="decimal" value={cpmText}
                onChange={e => setCpmText(e.target.value)} placeholder="e.g. 1.0" aria-label="Cents per mile" />
            </label>
          )}
          {resolved.notes.map(n => <p key={n}>{n}</p>)}
          {resolved.unknown.length > 0 && (
            <p data-testid="catalog-unknown">Unknown: {resolved.unknown.join('; ')}</p>
          )}
          <p>
            Rates from{' '}
            <a href={sourceOf(product).url} target="_blank" rel="noopener noreferrer" className="underline">
              the issuer's page
            </a>
            , checked {sourceOf(product).checked}. You can change any rate before saving.
          </p>
          <button
            type="button"
            disabled={!resolved.rewards}
            onClick={() => resolved.rewards && onApply(resolved.rewards)}
            className="btn-press border border-primary text-primary px-3 py-1 text-xs font-semibold disabled:opacity-40"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Use these rates
          </button>
        </div>
      )}
    </div>
  );
}
