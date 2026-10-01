// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ insert }) } }));

import { backgroundVia, logBackgroundRefresh } from '../widget-refresh-log';

const doc = (state: DocumentVisibilityState) => ({ visibilityState: state }) as unknown as Document;
const win = (o: object = {}) => o as unknown as Window;

describe('backgroundVia (ask e74da89c)', () => {
  it('is null for an ordinary visible page, so a normal open logs nothing', () => {
    expect(backgroundVia(win(), doc('visible'))).toBeNull();
  });
  it('is "hidden" when the page publishes while hidden (iOS background reload)', () => {
    expect(backgroundVia(win(), doc('hidden'))).toBe('hidden');
  });
  it('is "host" inside the Android hidden WebView, whatever visibility says', () => {
    const host = win({ ForgentaWidgetHost: { postMessage: () => {} } });
    expect(backgroundVia(host, doc('visible'))).toBe('host');
    expect(backgroundVia(host, doc('hidden'))).toBe('host');
  });
});

describe('logBackgroundRefresh writes native rows only (ask e74da89c)', () => {
  beforeEach(() => insert.mockClear());
  it('writes nothing for web, so desk reads cannot fill the 24-a-day cap', async () => {
    await logBackgroundRefresh('hidden', 'web');
    await logBackgroundRefresh('hidden', '');
    expect(insert).not.toHaveBeenCalled();
  });
  it('writes an ios row with the platform and via', async () => {
    await logBackgroundRefresh('hidden', 'ios');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({ platform: 'ios', via: 'hidden' });
  });
  it('writes an android row from the widget host', async () => {
    await logBackgroundRefresh('host', 'android');
    expect(insert).toHaveBeenCalledWith({ platform: 'android', via: 'host' });
  });
});
