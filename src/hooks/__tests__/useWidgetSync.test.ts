// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidgetSync } from '../useWidgetSync';

const mockUpdateWidget = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/plugins/widget-bridge', () => ({
  WidgetBridge: { updateWidget: mockUpdateWidget },
}));

describe('useWidgetSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire when enabled is false', async () => {
    renderHook(() =>
      useWidgetSync({ monthEndCash: 100, netWorth: 5000, enabled: false }),
    );
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).not.toHaveBeenCalled();
  });

  it('fires with correct payload after 500ms debounce', async () => {
    renderHook(() =>
      useWidgetSync({ monthEndCash: 1240.55, netWorth: 28430.10, enabled: true }),
    );
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).toHaveBeenCalledOnce();
    const payload = mockUpdateWidget.mock.calls[0][0];
    expect(payload.monthEndCash).toBe(1240.55);
    expect(payload.netWorth).toBe(28430.10);
    expect(payload.currency).toBe('USD');
    expect(payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('debounces: multiple rapid re-renders produce one call with the latest values', async () => {
    const { rerender } = renderHook(
      ({ cash }: { cash: number }) =>
        useWidgetSync({ monthEndCash: cash, netWorth: 1000, enabled: true }),
      { initialProps: { cash: 100 } },
    );
    rerender({ cash: 200 });
    rerender({ cash: 300 });
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).toHaveBeenCalledOnce();
    expect(mockUpdateWidget.mock.calls[0][0].monthEndCash).toBe(300);
  });

  it('does not fire when toggled enabled → disabled before the timer fires', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWidgetSync({ monthEndCash: 100, netWorth: 1000, enabled }),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).not.toHaveBeenCalled();
  });

  it('fires again when values change after first call', async () => {
    const { rerender } = renderHook(
      ({ cash }: { cash: number }) =>
        useWidgetSync({ monthEndCash: cash, netWorth: 1000, enabled: true }),
      { initialProps: { cash: 500 } },
    );
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).toHaveBeenCalledOnce();

    rerender({ cash: 750 });
    await act(() => vi.runAllTimersAsync());
    expect(mockUpdateWidget).toHaveBeenCalledTimes(2);
    expect(mockUpdateWidget.mock.calls[1][0].monthEndCash).toBe(750);
  });
});
