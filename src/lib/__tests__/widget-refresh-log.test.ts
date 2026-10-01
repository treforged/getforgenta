// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { backgroundVia } from '../widget-refresh-log';

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
