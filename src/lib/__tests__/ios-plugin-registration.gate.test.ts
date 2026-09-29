// EVERY IN-APP CAPACITOR PLUGIN IS REGISTERED WITH THE BRIDGE.
//
// A plugin class compiled into the App target is NOT auto-registered - packageClassList covers npm
// plugins only. GlassEffectPlugin compiled, passed native-glass-bridge.gate (names match on both
// sides), and was never registered, so every NativeGlass call rejected "not implemented" and
// useSimGlassExperiment swallowed it (found 2026-09-29, 8a202850, sim run 36614287669: glass log
// lines 0 against 3 control lines).
//
// The class list is DERIVED from the Swift sources, never hand-named. Positive control: the two
// plugins that have always been registered must be found, so a broken matcher cannot pass as clean.
// DOES NOT COVER: whether a registered plugin works on a device.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'ios/App/App';
const swift = readdirSync(DIR).filter(f => f.endsWith('.swift')).map(f => readFileSync(join(DIR, f), 'utf8'));
const pluginClasses = swift.flatMap(src =>
  [...src.matchAll(/class\s+(\w+)\s*:\s*CAPPlugin\b/g)].map(m => m[1]));
const viewController = readFileSync(join(DIR, 'ViewController.swift'), 'utf8');
const registered = new Set([...viewController.matchAll(/registerPluginInstance\(\s*(\w+)\(\)\s*\)/g)].map(m => m[1]));

describe('in-app Capacitor plugins', () => {
  it('finds the plugin classes and registrations at all (control)', () => {
    expect(pluginClasses).toEqual(expect.arrayContaining(['AuthSessionPlugin', 'WidgetBridgePlugin']));
    expect(registered.has('AuthSessionPlugin')).toBe(true);
  });

  it('registers every one of them in ViewController.capacitorDidLoad', () => {
    expect(pluginClasses.filter(c => !registered.has(c))).toEqual([]);
  });
});
