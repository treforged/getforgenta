import { registerPlugin } from '@capacitor/core';

export interface WidgetPayload {
  monthEndCash: number;
  netWorth: number;
  currency: string;
  updatedAt: string; // ISO 8601
}

export interface WidgetBridgePlugin {
  updateWidget(payload: WidgetPayload): Promise<void>;
}

class WidgetBridgeWeb implements WidgetBridgePlugin {
  async updateWidget(_payload: WidgetPayload): Promise<void> {
    // no-op on web; native handles shared storage writes
  }
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge', {
  web: () => new WidgetBridgeWeb(),
});
