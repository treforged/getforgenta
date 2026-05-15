package com.treforged.forged.widgets;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

public class WidgetSnapshot {
    static final String PREFS_NAME = "forgenta_widget";
    static final String KEY = "snapshot";

    public final double monthEndCash;
    public final double netWorth;
    public final String currency;
    public final long updatedAtMs; // epoch millis

    public WidgetSnapshot(double monthEndCash, double netWorth, String currency, long updatedAtMs) {
        this.monthEndCash = monthEndCash;
        this.netWorth = netWorth;
        this.currency = currency;
        this.updatedAtMs = updatedAtMs;
    }

    public static WidgetSnapshot load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY, null);
        if (json == null) return null;
        try {
            JSONObject obj = new JSONObject(json);
            return new WidgetSnapshot(
                obj.optDouble("monthEndCash", 0),
                obj.optDouble("netWorth", 0),
                obj.optString("currency", "USD"),
                obj.optLong("updatedAtMs", 0)
            );
        } catch (JSONException e) {
            return null;
        }
    }

    public static void save(Context context, double monthEndCash, double netWorth, String currency) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("monthEndCash", monthEndCash);
            obj.put("netWorth", netWorth);
            obj.put("currency", currency);
            obj.put("updatedAtMs", System.currentTimeMillis());
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, obj.toString())
                .apply();
        } catch (JSONException e) {
            // ignore — widget will show stale data
        }
    }
}
