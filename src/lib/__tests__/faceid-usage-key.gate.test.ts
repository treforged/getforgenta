// FACE ID NEEDS ITS USAGE STRING, OR iOS KILLS THE APP THE FIRST TIME IT ASKS.
//
// The biometric plugin has been in package.json since May, and ios/App/App/Info.plist carried NO
// NSFaceIDUsageDescription (ask 3b0b7002, 2026-09-29). iOS terminates an app that calls Face ID
// without that string, so the plugin was dead code on every Face ID iPhone. This pins the pair:
// if the plugin is a dependency, the plist must carry a non-empty reason.
//
// Positive control: the plist must parse to other keys we know exist, so an unreadable file cannot
// pass as "no key needed". DOES NOT COVER: whether Face ID works on a device (needs a phone).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const value = (key: string) =>
  (plist.match(new RegExp(`<key>${key}</key>[ \t\r\n]*<string>([^<]*)</string>`)) || [])[1];

describe('Face ID usage description', () => {
  it('reads the plist (control)', () => {
    expect(value('CFBundleIdentifier')).toBeTruthy();
  });

  it('carries NSFaceIDUsageDescription whenever the biometric plugin is a dependency', () => {
    const hasPlugin = Boolean(pkg.dependencies?.['@aparajita/capacitor-biometric-auth']);
    expect(hasPlugin).toBe(true);
    expect((value('NSFaceIDUsageDescription') ?? '').trim().length).toBeGreaterThan(10);
  });
});
