import { registerPlugin } from '@capacitor/core';
import { getWidgetHost } from '@/lib/widget-host';

export interface WidgetPayload {
  monthEndCash: number;
  netWorth: number;
  currency: string;
  updatedAt: string; // ISO 8601
  /** See `WidgetDebtPayment` in src/lib/widget-snapshot.ts. Optional; older readers ignore it. */
  nextDebtPayments?: { name: string; amount: number | null; dueDate: string | null }[];
}

export interface WidgetBridgePlugin {
  updateWidget(payload: WidgetPayload): Promise<void>;
}

class WidgetBridgeWeb implements WidgetBridgePlugin {
  async updateWidget(payload: WidgetPayload): Promise<void> {
    // A plain browser has nowhere to put this, so it stays a no-op. The one exception is the
    // hidden background WebView that refreshes widgets with the app closed (ask e74da89c): it has
    // no Capacitor bridge, so the payload goes back through its own message channel instead.
    getWidgetHost()?.post(JSON.stringify(payload));
  }
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge', {
  web: () => new WidgetBridgeWeb(),
});
