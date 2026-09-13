// §1B Stage 7A — merchant memory, as a COUNT rather than a list.
//
// Tre, 2026-09-13: "I want to hide the merchant memory. I wanted to save automatically, but it
// doesn't need to explicitly have every single one in merchant memory and settings. We could just
// have a section that says how many are linked and then give them the option to clear it."
//
// ⚠️ THIS IS A SURFACE CHANGE, NOT A BEHAVIOUR CHANGE. Nothing about how a merchant is remembered
// moved. `deriveMerchantRules` still reads the user's own `category_override` decisions, and
// `merchantRuleFor` still speaks for a charge exactly as before.
//
// ⚠️ AND HIDING THE LIST DOES NOT STRAND A WRONG MEMORY, which is the thing worth checking before
// removing the only editor. `deriveMerchantRules` is MOST-RECENT-WINS, not most-frequent (see its
// header): re-labelling a single charge of that merchant, from Bank Activity, immediately becomes
// the rule. That is why the copy below points there — the correction route is real, it is just no
// longer a list of every merchant. Tre's "self-correcting and accurate every single time, based on
// accumulation of user data and selections" is a description of how it already works.
//
// ⚠️ WHAT THE LIST DID CARRY AND THIS DOES NOT: a per-device "stop remembering this merchant"
// switch (`suppressed`). Nothing else in the app sets it, so it is now unreachable, and
// `merchant-memory.ts` argues the opposite case — "a rule you cannot see is a rule you cannot
// undo". Recorded rather than quietly dropped: the state is still honoured if a device already
// carries it, and a per-merchant control may need a home that is not a full list.
import { Tag } from 'lucide-react';
import { useMerchantMemory } from '@/hooks/useMerchantMemory';
import { CROWD_PRIVACY_NOTE } from '@/lib/crowd-category';

export default function MerchantRulesSettings() {
  const { rules, isLoading } = useMerchantMemory();

  const merchantCount = Object.keys(rules).length;
  /**
   * ⚠️ A COUNT ON A SCREEN HAS TO BE THE REAL ONE. This is the number of derived RULES — merchants
   * the app will actually stop asking about — not a row count of the reviews table, which includes
   * links, ignores and superseded answers and would read high for no reason the user could check.
   */
  const decisionCount = Object.values(rules).reduce((n, r) => n + r.decidedCount, 0);

  // Renders nothing until something has been learned: a card reading "0 merchants" is a control
  // that tells the user only that a feature they have not used yet exists.
  if (isLoading || merchantCount === 0) return null;

  return (
    <div className="card-forged p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Tag size={14} className="text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Merchant memory</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The app remembers{' '}
            <span className="text-foreground font-medium">
              {merchantCount} {merchantCount === 1 ? 'merchant' : 'merchants'}
            </span>{' '}
            from {decisionCount} {decisionCount === 1 ? 'label' : 'labels'} you have set, and stops
            asking about them.
          </p>
          {/* The correction route, said plainly — because removing the list removed the obvious
              one. This is true rather than reassuring: the most recent answer wins, so one
              re-label is the whole fix. */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Got one wrong? Re-label any charge of that merchant in Transactions and the app takes
            the newest answer as the rule.
          </p>
          {/* Slice 6 requires this note wherever the shared map is in play, and Settings is where a
              person comes looking. ⚠️ It is deliberately specific about what is NOT sent: a vague
              "we use aggregated data" reassures nobody and tells them nothing. The sentence itself
              lives in `crowd-category.ts` so the copy here and the copy on the charge row cannot
              come to say two different things. */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Shared suggestions. </span>
            {CROWD_PRIVACY_NOTE}
          </p>
        </div>
      </div>
    </div>
  );
}
