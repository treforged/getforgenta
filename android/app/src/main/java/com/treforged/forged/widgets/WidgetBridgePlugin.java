package com.treforged.forged.widgets;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSArray;
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

        // Optional: an app build that predates the field sends nothing, which is kept as "not sent"
        // rather than "no debts" (WidgetSnapshot.nextDebtPayments stays null).
        JSArray debts = call.getArray("nextDebtPayments", null);

        // Persist to SharedPreferences
        WidgetSnapshot.save(context, monthEndCash, netWorth, currency, debts == null ? null : debts.toString());

        updateAllWidgets(context);

        call.resolve();
    }

    /**
     * Turns the 6-hourly closed-app refresh on or off for this install (ask e74da89c). The app
     * decides per user; it is off unless the app says otherwise.
     */
    @PluginMethod
    public void setBackgroundRefresh(PluginCall call) {
        WidgetRefreshWorker.schedule(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    /** Broadcast an update to every widget provider. Also used by WidgetRefreshWorker. */
    public static void updateAllWidgets(Context context) {
        triggerUpdate(context, SurplusWidgetProvider.class);
        triggerUpdate(context, NetWorthWidgetProvider.class);
        triggerUpdate(context, DebtsWidgetProvider.class);
    }

    private static void triggerUpdate(Context context, Class<?> providerClass) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, providerClass));
        if (ids.length == 0) return;
        Intent intent = new Intent(context, providerClass);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
