import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ask e74da89c - PROXY GATE for the closed-app widget refresh. Every join below is a string that
 * no compiler checks, and each side is DERIVED from its file. It does NOT prove the refresh runs:
 * only a device shows that iOS grants the task or that Android's hidden WebView publishes.
 */
const REPO = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const APPDELEGATE = read('ios/App/App/AppDelegate.swift');
const PLIST = read('ios/App/App/Info.plist');
const WORKER = read('android/app/src/main/java/com/treforged/forged/widgets/WidgetRefreshWorker.java');
const PLUGIN_JAVA = read('android/app/src/main/java/com/treforged/forged/widgets/WidgetBridgePlugin.java');
const WIDGET_HOST = read('src/lib/widget-host.ts');
const BRIDGE_TS = read('src/plugins/widget-bridge.ts');

const plistArray = (key: string): string[] => {
  // String.raw: in a plain template literal `\s` is just `s`, and this regex silently never matched.
  const m = PLIST.match(new RegExp(String.raw`<key>${key}</key>\s*<array>([\s\S]*?)</array>`));
  return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map(x => x[1]) : [];
};

describe('iOS BGAppRefreshTask joins', () => {
  const swiftId = APPDELEGATE.match(/static let taskId = "([^"]+)"/)?.[1];

  it('finds both sides (positive control)', () => {
    expect(swiftId).toBeTruthy();
    expect(plistArray('BGTaskSchedulerPermittedIdentifiers').length).toBeGreaterThan(0);
  });

  it('the Swift task id is a permitted identifier, and fetch mode is on', () => {
    expect(plistArray('BGTaskSchedulerPermittedIdentifiers')).toContain(swiftId);
    expect(plistArray('UIBackgroundModes')).toContain('fetch');
  });

  it('registers inside didFinishLaunching, before it returns', () => {
    const start = APPDELEGATE.indexOf('didFinishLaunchingWithOptions');
    const end = APPDELEGATE.indexOf('return true', start);
    const reg = APPDELEGATE.indexOf('BGTaskScheduler.shared.register(forTaskWithIdentifier: WidgetRefresh.taskId', start);
    expect(reg).toBeGreaterThan(start);
    expect(reg).toBeLessThan(end);
  });

  it('the plugin announces a publish, which is what completes the task', () => {
    const upd = APPDELEGATE.slice(APPDELEGATE.indexOf('@objc func updateWidget'));
    expect(upd.slice(0, upd.indexOf('call.resolve('))).toContain('post(name: WidgetRefresh.published');
    expect(APPDELEGATE).toContain('forName: WidgetRefresh.published');
  });
});

describe('Android hidden-WebView joins', () => {
  const javaChannel = [...WORKER.matchAll(/addJavascriptInterface\([\s\S]*?\},\s*"([^"]+)"\)/g)].map(m => m[1]);

  it('finds the channel (positive control)', () => {
    expect(javaChannel.length).toBe(1);
  });

  it('the Java channel is the one the page detects', () => {
    expect(WIDGET_HOST).toContain(`.${javaChannel[0]}`);
  });

  it('setBackgroundRefresh exists on both sides of the bridge', () => {
    expect(PLUGIN_JAVA).toMatch(/@PluginMethod\s+public void setBackgroundRefresh\(/);
    expect(BRIDGE_TS).toMatch(/setBackgroundRefresh\(options: \{ enabled: boolean \}\): Promise<void>;/);
  });

  it('skips the run while the visible app is in the foreground', () => {
    expect(WORKER).toMatch(/if \(appInForeground\) \{\s*completer\.set\(Result\.success\(\)\);/);
  });
});
