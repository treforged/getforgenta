package com.treforged.forged.widgets;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void updateWidget(PluginCall call) {
        double monthEndCash = call.getDouble("monthEndCash", 0.0);
        double netWorth     = call.getDouble("netWorth", 0.0);
        String currency     = call.getString("currency", "USD");

        Context context = getContext();

        // Persist to SharedPreferences
        WidgetSnapshot.save(context, monthEndCash, netWorth, currency);

        // Broadcast update to both widget providers
        triggerUpdate(context, SurplusWidgetProvider.class);
        triggerUpdate(context, NetWorthWidgetProvider.class);

        call.resolve();
    }

    private void triggerUpdate(Context context, Class<?> providerClass) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, providerClass));
        if (ids.length == 0) return;
        Intent intent = new Intent(context, providerClass);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
