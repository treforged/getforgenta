// EVERY POPUP IS A DIALOG - a census, and a ratchet.
//
// A `modal-overlay` with no `role="dialog"` inside it is a popup a screen reader never announces:
// focus moves into something with no name and no boundary. On 2026-09-23 ModalShell and FormModal
// were fixed (ccd141f7) and 14 files still had the bare shape (MobileNav only MENTIONS the class in a comment).
//
// THE LIST BELOW MAY ONLY SHRINK. A new file with the bare shape fails ("add role=dialog"), and a
// listed file that has been fixed ALSO fails ("take it off the list") - so the list cannot quietly
// go stale and start hiding a regression in a file that was once fixed.
//
// Candidates are found by the SHAPE (`modal-overlay` in the source), never by the correctness
// marker, so a broken popup cannot hide by being unlabelled. It is a SOURCE check per file: it
// cannot tell which of two overlays in one file carries the role, and it cannot see a popup that
// is not built on `modal-overlay` (Radix dialogs already carry the role themselves).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..');

const NOT_YET_DIALOGS = new Set<string>([
  'components/builds/BuildFormModal.tsx',
  'components/builds/MaintenanceFormModal.tsx',
  'components/dashboard/SubscriptionExpiryBanner.tsx',
  'components/shared/AppLockSetupModal.tsx',
  'components/shared/AppTour.tsx',
  'components/shared/CalcDrawer.tsx',
  'components/shared/InstructionsModal.tsx',
  'components/vehicles/BuyItDialog.tsx',
  'components/vehicles/LumpSumPanel.tsx',
  'pages/Accounts.tsx',
  'pages/BudgetControl.tsx',
  'pages/Forecast.tsx',
  'pages/SavingsGoals.tsx',
  'pages/Transactions.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const withOverlay = walk(SRC)
  .map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))
  .filter(f => /className=[{"'`][^>]*modal-overlay/.test(f.text));

const isDialog = (text: string) => /role=["'](?:alert)?dialog["']/.test(text);

describe('modal-overlay census', () => {
  it('finds the popups it is meant to police (positive control)', () => {
    const names = withOverlay.map(f => f.rel);
    expect(names).toContain('components/shared/ModalShell.tsx');
    expect(names).toContain('components/shared/FormModal.tsx');
    expect(withOverlay.length).toBeGreaterThanOrEqual(10);
  });

  it('the two fixed shells read as dialogs (the detector can say yes)', () => {
    for (const rel of ['components/shared/ModalShell.tsx', 'components/shared/FormModal.tsx']) {
      expect(isDialog(withOverlay.find(f => f.rel === rel)!.text)).toBe(true);
    }
  });

  it('no NEW popup ships without role="dialog"', () => {
    const offenders = withOverlay
      .filter(f => !isDialog(f.text) && !NOT_YET_DIALOGS.has(f.rel))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the not-yet list only holds files that still need it (it may only shrink)', () => {
    const stale = [...NOT_YET_DIALOGS].filter(rel => {
      const f = withOverlay.find(x => x.rel === rel);
      return !f || isDialog(f.text);
    });
    expect(stale).toEqual([]);
  });
});
