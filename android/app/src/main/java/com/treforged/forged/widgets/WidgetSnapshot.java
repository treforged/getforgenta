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

    /**
     * After this long without an update, the stored figure stops being
     * information. A widget shows a number without anyone opening the app, so
     * NOBODY OPENS THE APP TO CHECK WHAT THEIR HOME SCREEN ALREADY TOLD THEM —
     * which makes a stale number worse than a blank one. A blank prompts a tap.
     * Seven days is sized against what these figures are: month-end cash and net
     * worth move with every transaction, and a week is long enough to contain a
     * paycheck and a rent payment.
     */
    static final long STALE_AFTER_MS = 7L * 24 * 60 * 60 * 1000;

    /**
     * A snapshot, or null when there is not one worth drawing.
     *
     * ⚠️ THIS USED TO DEFAULT MISSING NUMBERS TO ZERO. `optDouble("netWorth", 0)`
     * meant a malformed or partial snapshot rendered as "$0" in confident gold,
     * and a user whose net worth genuinely is zero looked identical to one whose
     * data never arrived. That is the same error as a gauge drawing a value it
     * never read: there is no failure state a person can see. Missing fields now
     * return null, and the provider draws "--" instead.
     */
    public static WidgetSnapshot load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return parse(prefs.getString(KEY, null));
    }

    /**
     * The trust rules, split out from {@link #load} so they can be EXERCISED.
     *
     * `load` needs an Android Context and therefore only runs on a device; this
     * takes the raw string and runs on the JVM, so `./gradlew testDebugUnitTest`
     * presses every rule below. Splitting it is the difference between a
     * read-and-reason change and a tested one.
     *
     * @return a snapshot, or null when there is not one worth drawing.
     */
    public static WidgetSnapshot parse(String json) {
        if (json == null) return null;
        try {
            JSONObject obj = new JSONObject(json);
            // has() before read: absent is NOT zero.
            if (!obj.has("monthEndCash") || !obj.has("netWorth") || !obj.has("updatedAtMs")) {
                return null;
            }
            double cash = obj.getDouble("monthEndCash");
            double worth = obj.getDouble("netWorth");
            // NaN and Infinity are what a division by a missing denominator looks
            // like, and NumberFormat will happily print them.
            if (Double.isNaN(cash) || Double.isInfinite(cash)) return null;
            if (Double.isNaN(worth) || Double.isInfinite(worth)) return null;

            long updatedAt = obj.getLong("updatedAtMs");
            if (updatedAt <= 0) return null;

            return new WidgetSnapshot(cash, worth, obj.optString("currency", "USD"), updatedAt);
        } catch (JSONException e) {
            return null;
        }
    }

    /** True once this snapshot is too old to be shown as a figure. */
    public boolean isStale(long nowMs) {
        return nowMs - this.updatedAtMs > STALE_AFTER_MS;
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
            // The write failed, so the widget keeps whatever it had. `load` will
            // refuse to draw it once it is older than STALE_AFTER_MS, which is
            // the backstop that makes this ignore safe.
        }
    }
}
