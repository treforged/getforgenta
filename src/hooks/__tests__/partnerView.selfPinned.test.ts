/**
 * SOURCE LOCK: the files partner view must NEVER reach into (design §2 sweep, §5).
 *
 * These are grep-locks on the source, not behavioural tests, because the failure they
 * guard against — someone "completing" the viewedUserId sweep into a file that must stay
 * pinned to the owner — passes every behavioural test until a partner is actually linked.
 *
 *  - Bank connections are never partner-visible: useFinancialConnections / usePlaidItems
 *    stay keyed and filtered on the OWN user, always.
 *  - Home-screen widgets only ever sync the OWNER's numbers: useWidgetSync must refuse in
 *    partner view (isPartnerView guard) and must never consume viewedUserId.
 *  - Premium status is the owner's own: SubscriptionContext stays pinned.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('partner view — files that stay pinned to the owner', () => {
  it('useFinancialConnections never consumes the lens and still filters on user.id', () => {
    const code = stripComments(read('src/hooks/useFinancialConnections.ts'));
    expect(code).not.toMatch(/viewedUserId|useViewedProfile/);
    expect(code).toContain(".eq('user_id', user.id)");
  });

  it('usePlaidItems never consumes the lens', () => {
    const code = stripComments(read('src/hooks/usePlaidItems.ts'));
    expect(code).not.toMatch(/viewedUserId|useViewedProfile/);
  });

  it('useWidgetSync refuses in partner view and never consumes viewedUserId', () => {
    const code = stripComments(read('src/hooks/useWidgetSync.ts'));
    expect(code).not.toMatch(/viewedUserId/);
    expect(code).toMatch(/isPartnerView/);
  });

  it('SubscriptionContext never consumes the lens', () => {
    const code = stripComments(read('src/contexts/SubscriptionContext.tsx'));
    expect(code).not.toMatch(/viewedUserId|useViewedProfile/);
  });

  it('partner_links reads stay pinned to the OWN user — the link list is never lensed', () => {
    const code = stripComments(read('src/hooks/usePartnerLink.ts'));
    // The status query must be built from user.id, not viewedUserId.
    expect(code).not.toMatch(/\.or\([^)]*viewedUserId/);
  });
});
