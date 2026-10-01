// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WidgetBridge } from '../widget-bridge';

type HostWindow = { ForgentaWidgetHost?: { postMessage: (json: string) => void } };

describe('WidgetBridge in a browser (ask e74da89c)', () => {
  afterEach(() => { delete (window as unknown as HostWindow).ForgentaWidgetHost; });

  const payload = { monthEndCash: 12.5, netWorth: 300, currency: 'USD', updatedAt: '2026-10-01T00:00:00.000Z' };

  it('forwards the payload to the hidden widget host as JSON', async () => {
    const postMessage = vi.fn();
    (window as unknown as HostWindow).ForgentaWidgetHost = { postMessage };
    await WidgetBridge.updateWidget(payload);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual(payload);
  });

  it('is still a quiet no-op in an ordinary browser', async () => {
    await expect(WidgetBridge.updateWidget(payload)).resolves.toBeUndefined();
  });
});
