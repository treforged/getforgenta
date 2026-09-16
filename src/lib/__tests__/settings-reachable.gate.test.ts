// SETTINGS STAYS REACHABLE, AT BOTH WIDTHS, AND SIGN OUT DID NOT VANISH WITH THE DRAWER.
//
// Tre, 2026-09-16: "pressing the user icon in the top left takes the user to settings. pressing the
// hamburger and settings also takes you there. to many places. make it more like intagrams where
// you can only get there from the hamburger page." Then: "the hamburger should open the settings
// page, including the log out button, like how instagram does it."
//
// Narrowing the ways into a screen is exactly the change that can accidentally leave it with NONE,
// and this app has already paid for that shape once: a safe-area bug made the hamburger untappable
// and, because it was the only route, put Settings out of reach on every phone
// (`MobileTopBar.tsx`, Tre from TestFlight 2026-08-19). It threw nothing and no test saw it.
//
// ⚠️ THE TRAP THIS EXISTS FOR, AND IT NEARLY SHIPPED. "Only from the hamburger page" reads as
// "delete the Account page's Settings button". But `primary-nav.ts` records that THE DESKTOP RAIL
// HAS NO SETTINGS ROW - it was removed deliberately, on the stated reasoning that "the Account page
// links to it". The hamburger is `lg:hidden`. So deleting that button outright would have left
// DESKTOP with no route to Settings at all, while every unit test stayed green. The button is
// therefore `hidden lg:inline-flex`, and this gate holds both halves against each other.
//
// WHY A SOURCE SCAN: jsdom has no layout, so it cannot evaluate a `lg:` breakpoint or tell a
// visible control from a hidden one - this repo has measured that trap on scroll geometry and again
// on colour. A source scan proves the ROUTE EXISTS AND IS DECLARED. It cannot prove the control is
// visible, tappable, or that the breakpoint is the right one; only a browser can, and
// `npm run walk:routes` opens every route for real.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf8');

const topBar = read('src/components/layout/MobileTopBar.tsx');
const account = read('src/pages/Account.tsx');
const settings = read('src/pages/Settings.tsx');
const identity = read('src/components/layout/IdentityBadge.tsx');
const navRoutes = read('src/lib/nav-routes.ts');

describe('the instrument can tell these files apart (positive controls)', () => {
  it('the files are non-empty and are the ones named', () => {
    // A resolver that read nothing would make every assertion below vacuously true.
    expect(topBar.length).toBeGreaterThan(500);
    expect(account.length).toBeGreaterThan(500);
    expect(settings.length).toBeGreaterThan(500);
    expect(topBar).toContain('MobileTopBar');
    expect(settings).toContain('export default function Settings');
  });
});

describe('MOBILE: the hamburger is the one route, and it is on the Account tab', () => {
  it('the hamburger links to /settings', () => {
    expect(topBar, 'the hamburger no longer points at Settings - it is the only phone route').toContain('to="/settings"');
  });

  it('it is gated to the Account tab by the SHARED constant, not a retyped path', () => {
    // A hand-typed '/account' silently stops matching after a rename and takes Settings with it.
    expect(topBar).toContain('ACCOUNT_TAB_PATH');
    expect(navRoutes, 'ACCOUNT_TAB_PATH must be exported from the route list it belongs to').toContain('export const ACCOUNT_TAB_PATH');
  });

  it('and that constant is DERIVED from TAB_ROOT_PATHS rather than standing alone', () => {
    // `satisfies` makes a rename of the tab a COMPILE error here instead of a dead predicate.
    expect(navRoutes).toMatch(/ACCOUNT_TAB_PATH\s*=\s*'\/account'\s*satisfies/);
  });

  it('the drawer is gone - the hamburger opens a page, not a panel', () => {
    expect(topBar, 'a drawer still opens; Tre asked for the settings page itself').not.toContain('Open menu"\n          aria-expanded');
    expect(topBar).not.toContain('setOpenedAt');
  });
});

describe('DESKTOP: the Account page keeps the door the rail does not have', () => {
  it('Account still links to /settings', () => {
    expect(account, 'the desktop rail has NO settings row - this link is the only desktop route').toContain('to="/settings"');
  });

  it('and that link is shown at lg and up', () => {
    // The exact failure this catches: someone reads "only from the hamburger" and deletes it, or
    // hides it at every width.
    const link = account.slice(account.indexOf('to="/settings"') - 400, account.indexOf('to="/settings"') + 200);
    expect(link, 'the Settings link must render at lg and up, or desktop has no route at all').toContain('lg:inline-flex');
  });
});

describe('the identity badge is no longer a second door', () => {
  it('goes to the Account tab, not to Settings', () => {
    expect(identity).toContain('to="/account"');
    expect(identity, 'the user icon still opens Settings - that is the duplication reported').not.toContain('to="/settings"');
  });
});

describe('SIGN OUT survived the drawer being deleted', () => {
  it('Settings carries an ordinary Sign Out', () => {
    // It only ever lived in the drawer. Removing the drawer without this would have deleted the
    // everyday "log me out of this phone" from the mobile app entirely.
    expect(settings, 'no ordinary Sign Out on the Settings page').toContain('>Sign Out<');
  });

  it('and it is NOT the same control as Sign Out All Devices', () => {
    // One ends this session; the other revokes every session on every device. Same words, very
    // different blast radius - merging them would hand a routine action a security action's reach.
    expect(settings).toContain('Sign out all devices');
    expect(settings).toContain('signOut({ scope: \'global\' })');
  });
});
