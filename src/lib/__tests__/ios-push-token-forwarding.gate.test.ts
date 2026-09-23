/**
 * GATE: the iOS AppDelegate forwards the APNs device token to @capacitor/push-notifications.
 *
 * APNs delivers the token to the AppDelegate, not to the plugin. The plugin only hears it through
 * two NotificationCenter posts that its README tells you to add by hand. They were missing from
 * this repo for its whole history, so no iPhone ever produced a push token: every iOS row in
 * push_registration_status read permission=granted then timeout, while Android (FCM delivers to
 * the plugin directly) registered fine. No JS test could see it - the defect is in Swift.
 *
 * Source-level, like native-glass-bridge.gate.test.ts: it proves the forwarding is DECLARED, not
 * that APNs answers. Only a device can prove that.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DELEGATE = resolve(__dirname, '../../../ios/App/App/AppDelegate.swift');

/** The `func application(...)` body that handles `selector`, or null when there is none. */
export function delegateBody(swift: string, selector: string): string | null {
  const at = swift.indexOf(selector);
  if (at < 0) return null;
  const open = swift.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < swift.length; i++) {
    if (swift[i] === '{') depth++;
    else if (swift[i] === '}' && --depth === 0) return swift.slice(open + 1, i);
  }
  return null;
}

const PAIRS = [
  ['didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data', '.capacitorDidRegisterForRemoteNotifications'],
  ['didFailToRegisterForRemoteNotificationsWithError error: Error', '.capacitorDidFailToRegisterForRemoteNotifications'],
] as const;

describe('iOS push token forwarding', () => {
  it('positive control: the helper finds a method that certainly exists', () => {
    const swift = readFileSync(APP_DELEGATE, 'utf8');
    expect(delegateBody(swift, 'didFinishLaunchingWithOptions')).toBeTruthy();
    expect(delegateBody(swift, 'noSuchSelectorAnywhere')).toBeNull();
  });

  for (const [selector, notification] of PAIRS) {
    it(`${selector.split(' ')[0]} posts ${notification}`, () => {
      const body = delegateBody(readFileSync(APP_DELEGATE, 'utf8'), selector);
      expect(body, `AppDelegate has no ${selector.split(' ')[0]} - iOS will never get a push token`).not.toBeNull();
      expect(body).toContain('NotificationCenter.default.post');
      expect(body).toContain(notification);
    });
  }
});
