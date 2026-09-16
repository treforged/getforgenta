import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativeGlass } from '../native-glass';

/**
 * THE NATIVE GLASS BRIDGE GATE.
 *
 * A Capacitor bridge is joined by STRINGS, in three places that no compiler on either side can
 * see at once:
 *   1. the Swift `jsName` and the JS `registerPlugin('…')` argument must be the same string
 *   2. every Swift `CAPPluginMethod(name: "…")` must exist on the TS interface
 *   3. the Swift file must be in the Xcode target's Sources build phase, or it compiles nowhere
 *      and the failure surfaces at runtime, on a device, as "not implemented on ios"
 *
 * Each of those is silent locally and expensive to find remotely (a CI round-trip, or a
 * TestFlight build on Tre's phone). This gate is the cheap half.
 *
 * ⚠️ WHAT THIS GATE DOES **NOT** PROVE, and it is the important sentence: it does not prove the
 * bridge round-trips. Only a call on a real device does that. It proves the three things above
 * and nothing more. `npx cap sync ios` + `xcodebuild` on the macOS runner
 * (`.github/workflows/codeql-ios.yml`) proves the Swift COMPILES. Neither is a device.
 *
 * Both sides are DERIVED from the files. Hardcoding either side would make this enforce nothing
 * (rules/common/testing.md, "a coupling test that hardcodes one side").
 */

const REPO = join(__dirname, '..', '..', '..');
const SWIFT = readFileSync(join(REPO, 'ios/App/App/GlassEffectPlugin.swift'), 'utf8');
const TS_SHIM = readFileSync(join(REPO, 'src/lib/native-glass.ts'), 'utf8');
const PBXPROJ = readFileSync(join(REPO, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');

const swiftJsName = /\bjsName\s*=\s*"([^"]+)"/.exec(SWIFT)?.[1] ?? '';
const swiftMethods = [...SWIFT.matchAll(/CAPPluginMethod\(\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
const registeredName = /registerPlugin<[^>]+>\(\s*'([^']+)'/.exec(TS_SHIM)?.[1] ?? '';
const tsInterfaceBody = /export interface NativeGlassPlugin\s*\{([\s\S]*?)\n\}/.exec(TS_SHIM)?.[1] ?? '';
const tsMethods = [...tsInterfaceBody.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]);

/**
 * POSITIVE CONTROLS FIRST. Every assertion below this block is "the two sides agree", and two
 * empty sides agree perfectly — a broken regex would report a healthy bridge. So the parsers are
 * required to have found something before their agreement means anything.
 */
describe('the parsers found something (so their agreement means something)', () => {
  it('extracted a jsName from the Swift', () => {
    expect(swiftJsName).not.toBe('');
  });

  it('extracted at least one CAPPluginMethod from the Swift', () => {
    expect(swiftMethods.length).toBeGreaterThan(0);
  });

  it('extracted the registerPlugin name from the TS', () => {
    expect(registeredName).not.toBe('');
  });

  it('extracted at least one method from the TS interface', () => {
    expect(tsMethods.length).toBeGreaterThan(0);
  });
});

describe('the two sides of the bridge agree', () => {
  it('the Swift jsName is the string JS registers', () => {
    expect(registeredName).toBe(swiftJsName);
  });

  it('every Swift plugin method exists on the TS interface', () => {
    const missing = swiftMethods.filter((m) => !tsMethods.includes(m));
    expect(missing).toEqual([]);
  });
});

describe('the Swift file is actually in the Xcode target', () => {
  const fileRef = /([0-9A-F]{24}) \/\* GlassEffectPlugin\.swift \*\/ = \{isa = PBXFileReference/.exec(PBXPROJ)?.[1] ?? '';
  const buildFile = /([0-9A-F]{24}) \/\* GlassEffectPlugin\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/.exec(PBXPROJ);
  const sourcesPhase = /Begin PBXSourcesBuildPhase[\s\S]*?End PBXSourcesBuildPhase/.exec(PBXPROJ)?.[0] ?? '';

  it('has a PBXFileReference', () => {
    expect(fileRef).not.toBe('');
  });

  it('has a PBXBuildFile pointing at that reference', () => {
    expect(buildFile?.[2]).toBe(fileRef);
  });

  it('that PBXBuildFile is listed in the Sources build phase', () => {
    // The phase must be non-empty, or "is listed in it" is vacuous.
    expect(sourcesPhase).toContain('AppDelegate.swift in Sources');
    expect(sourcesPhase).toContain(`${buildFile?.[1]} /* GlassEffectPlugin.swift in Sources */`);
  });
});

describe('the web fallback never throws and echoes', () => {
  it('reports unsupported off-device and hands the token back', async () => {
    const result = await NativeGlass.isSupported({ echo: 'round-trip-token' });
    expect(result.supported).toBe(false);
    expect(result.echo).toBe('round-trip-token');
  });

  it('survives being called with no options', async () => {
    const result = await NativeGlass.isSupported();
    expect(result.supported).toBe(false);
    expect(result.echo).toBe('');
  });
});
