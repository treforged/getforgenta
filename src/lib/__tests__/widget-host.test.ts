// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { getWidgetHost, isWidgetHost } from '../widget-host';

const asWin = (o: object) => o as unknown as Window;

describe('getWidgetHost', () => {
  it('is null in an ordinary page, including the real jsdom window', () => {
    expect(getWidgetHost(asWin({}))).toBeNull();
    expect(isWidgetHost(asWin({}))).toBe(false);
    expect(isWidgetHost()).toBe(false);
  });

  it('posts the exact string through the Android channel', () => {
    const postMessage = vi.fn();
    getWidgetHost(asWin({ ForgentaWidgetHost: { postMessage } }))!.post('{"a":1}');
    expect(postMessage).toHaveBeenCalledWith('{"a":1}');
  });

  it('posts through the iOS channel when Android is absent', () => {
    const postMessage = vi.fn();
    getWidgetHost(asWin({ webkit: { messageHandlers: { forgentaWidgetHost: { postMessage } } } }))!.post('x');
    expect(postMessage).toHaveBeenCalledWith('x');
  });

  it('prefers Android when both exist', () => {
    const android = vi.fn();
    const ios = vi.fn();
    getWidgetHost(asWin({
      ForgentaWidgetHost: { postMessage: android },
      webkit: { messageHandlers: { forgentaWidgetHost: { postMessage: ios } } },
    }))!.post('x');
    expect(android).toHaveBeenCalledOnce();
    expect(ios).not.toHaveBeenCalled();
  });

  it('is null when postMessage is not a function', () => {
    expect(getWidgetHost(asWin({ ForgentaWidgetHost: { postMessage: 'nope' } }))).toBeNull();
  });

  it('is null when reading the channel throws', () => {
    const win = {};
    Object.defineProperty(win, 'ForgentaWidgetHost', { get: () => { throw new Error('x'); } });
    expect(getWidgetHost(asWin(win))).toBeNull();
  });
});
