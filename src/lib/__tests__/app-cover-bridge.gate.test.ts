import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Ask 98cbf494: the strings that join the AppCover bridge, DERIVED from the files. A mismatch
// rejects "not implemented" on a device and the cover silently falls back to the 2.3 s wait.
const REPO = join(__dirname, '..', '..', '..');
const SWIFT = readFileSync(join(REPO, 'ios/App/App/AppDelegate.swift'), 'utf8');
const VC = readFileSync(join(REPO, 'ios/App/App/ViewController.swift'), 'utf8');
const TS = readFileSync(join(REPO, 'src/plugins/app-cover.ts'), 'utf8');

const block = /public class AppCoverPlugin[\s\S]*?\n\}/.exec(SWIFT)?.[0] ?? '';
const jsName = /\bjsName\s*=\s*"([^"]+)"/.exec(block)?.[1] ?? '';
const methods = [...block.matchAll(/CAPPluginMethod\(\s*name:\s*"([^"]+)"/g)].map(m => m[1]);
const registered = /registerPlugin<[^>]+>\(\s*'([^']+)'/.exec(TS)?.[1] ?? '';
const iface = /export interface AppCoverPlugin\s*\{([\s\S]*?)\n\}/.exec(TS)?.[1] ?? '';
const tsMethods = [...iface.matchAll(/^\s*(\w+)\s*\(/gm)].map(m => m[1]);

describe('AppCover bridge (98cbf494)', () => {
  it('found both sides (an empty pair would agree perfectly)', () => {
    expect(block).not.toBe('');
    expect(jsName).not.toBe('');
    expect(methods.length).toBeGreaterThan(0);
    expect(tsMethods.length).toBeGreaterThan(0);
  });
  it('jsName matches registerPlugin', () => { expect(registered).toBe(jsName); });
  it('Swift methods match the TS interface', () => { expect([...tsMethods].sort()).toEqual([...methods].sort()); });
  it('the plugin is registered in ViewController (in-app plugins are not auto-registered)', () => {
    expect(VC).toMatch(/registerPluginInstance\(AppCoverPlugin\(\)\)/);
  });
  it('the Swift handler refuses in the background', () => {
    const fn = /func jsUnlockPainted\(\)[\s\S]*?\n {4}\}/.exec(SWIFT)?.[0] ?? '';
    expect(fn).toMatch(/applicationState != \.background/);
  });
});
