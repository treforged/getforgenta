import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE iOS WIDGET BRIDGE GATE.
 *
 * `useWidgetSync` has called `WidgetBridge.updateWidget(payload)` on every platform since the
 * Android widgets shipped. iOS had no native `WidgetBridge`, so on an iPhone the call was rejected
 * as unimplemented and swallowed by a console.warn. This gate holds the joins that close that gap,
 * none of which any compiler can see:
 *   1. Swift `jsName` == the TS `registerPlugin('…')` name
 *   2. every Swift `CAPPluginMethod` exists on the TS interface
 *   3. the plugin INSTANCE is registered in ViewController (a class nobody registers is dead)
 *   4. the payload keys the Swift plugin reads are the keys `WidgetPayload` declares, and the
 *      keys the widget's decoder reads are the same set - three files, one contract
 *   5. App Group id and storage key agree between the plugin and the widget
 *   6. both widget Swift files are in the ForgentaWidget target's Sources phase
 *
 * ⚠️ WHAT THIS DOES NOT PROVE: that the widget renders on a home screen, or that the App Group is
 * shared on a device. Only a signed build does that, and it needs the Apple portal steps in
 * handoff-mac.md. Every side below is DERIVED from the files; hardcoding either side of a join
 * would make it enforce nothing.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const APPDELEGATE = read('ios/App/App/AppDelegate.swift');
const VIEWCONTROLLER = read('ios/App/App/ViewController.swift');
const WIDGET_VIEW = read('ios/App/ForgentaWidget/ForgentaWidgetView.swift');
const WIDGET_ENTRY = read('ios/App/ForgentaWidget/ForgentaWidget.swift');
const TS_SHIM = read('src/plugins/widget-bridge.ts');
// The target is HELD as a patch until the Apple portal steps exist (handoff-mac.md): applied to
// main before then, Release signing fails on the missing "Forged Widget App Store" profile and
// every iOS build goes red. Until applied, the gate checks the patch; after, the project file.
const PROJECT = read('ios/App/App.xcodeproj/project.pbxproj');
const TARGET_APPLIED = PROJECT.includes('/* ForgentaWidget */ = {');
const PBXPROJ = TARGET_APPLIED
  ? PROJECT
  : read('ios/App/ForgentaWidget/add-widget-target.pbxproj.patch')
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n');

const pluginSrc = /public class WidgetBridgePlugin[\s\S]*?\n}\n/.exec(APPDELEGATE)?.[0] ?? '';
const swiftJsName = /\bjsName\s*=\s*"([^"]+)"/.exec(pluginSrc)?.[1] ?? '';
const swiftMethods = [...pluginSrc.matchAll(/CAPPluginMethod\(\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
const registeredName = /registerPlugin<[^>]+>\(\s*'([^']+)'/.exec(TS_SHIM)?.[1] ?? '';
const tsIface = /export interface WidgetBridgePlugin\s*\{([\s\S]*?)\n\}/.exec(TS_SHIM)?.[1] ?? '';
const tsMethods = [...tsIface.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]);
const tsPayload = /export interface WidgetPayload\s*\{([\s\S]*?)\n\}/.exec(TS_SHIM)?.[1] ?? '';
const tsKeys = [...tsPayload.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]).sort();
const pluginKeys = [...new Set([...pluginSrc.matchAll(/call\.get(?:Double|String)\("(\w+)"\)/g)].map((m) => m[1]))].sort();
const decodeSrc = /static func decode[\s\S]*?\n {4}}\n/.exec(WIDGET_VIEW)?.[0] ?? '';
const decoderKeys = [...new Set([...decodeSrc.matchAll(/obj\["(\w+)"\]/g)].map((m) => m[1]))].sort();
const constOf = (src: string, re: RegExp) => re.exec(src)?.[1] ?? '';

describe('positive controls: every parser found its subject', () => {
  it('found the Swift plugin, its jsName and methods', () => {
    expect(pluginSrc).not.toBe('');
    expect(swiftJsName).not.toBe('');
    expect(swiftMethods.length).toBeGreaterThan(0);
  });
  it('found the TS name, interface methods and payload keys', () => {
    expect(registeredName).not.toBe('');
    expect(tsMethods.length).toBeGreaterThan(0);
    expect(tsKeys.length).toBeGreaterThanOrEqual(4);
  });
  it('found the keys the plugin and the decoder read', () => {
    expect(pluginKeys.length).toBeGreaterThanOrEqual(4);
    expect(decoderKeys.length).toBeGreaterThanOrEqual(4);
  });
});

describe('the app -> plugin -> widget joins', () => {
  it('Swift jsName matches the TS registerPlugin name', () => {
    expect(swiftJsName).toBe(registeredName);
  });
  it('every Swift method exists on the TS interface', () => {
    for (const m of swiftMethods) expect(tsMethods).toContain(m);
  });
  it('the plugin instance is registered with the bridge', () => {
    expect(VIEWCONTROLLER).toMatch(/registerPluginInstance\(\s*WidgetBridgePlugin\(\)\s*\)/);
  });
  it('plugin, TS payload and widget decoder read one set of keys', () => {
    expect(pluginKeys).toEqual(tsKeys);
    expect(decoderKeys).toEqual(tsKeys);
  });
  it('App Group and storage key agree between plugin and widget', () => {
    const pGroup = constOf(pluginSrc, /appGroup\s*=\s*"([^"]+)"/);
    const pKey = constOf(pluginSrc, /\bkey\s*=\s*"([^"]+)"/);
    expect(pGroup).not.toBe('');
    expect(constOf(WIDGET_ENTRY, /appGroup\s*=\s*"([^"]+)"/)).toBe(pGroup);
    expect(constOf(WIDGET_ENTRY, /snapshotKey\s*=\s*"([^"]+)"/)).toBe(pKey);
  });
  it(`both widget files are compiled into the ForgentaWidget target (${TARGET_APPLIED ? 'project file' : 'held patch'})`, () => {
    const target = /\/\* ForgentaWidget \*\/ = \{\s*isa = PBXNativeTarget;[\s\S]*?buildPhases = \(\s*(\w+)/.exec(PBXPROJ);
    expect(target).not.toBeNull();
    const phase = new RegExp(`${target![1]} /\\* Sources \\*/ = \\{[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`).exec(PBXPROJ)?.[1] ?? '';
    expect(phase).toContain('ForgentaWidget.swift in Sources');
    expect(phase).toContain('ForgentaWidgetView.swift in Sources');
  });
});
