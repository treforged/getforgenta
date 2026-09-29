package com.treforged.forged.widgets;

import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

/**
 * The words both home-screen widgets print, kept in pure Java so the JVM tests can press them.
 *
 * It matches the iOS widget (ios/App/ForgentaWidget/ForgentaWidgetView.swift): whole units in the
 * user's own currency, and an "Updated X ago" footer. The footer is the line that tells a person
 * whether to trust the figure, so it is written here once rather than twice in the providers.
 */
public final class WidgetText {
    private WidgetText() {}

    /**
     * "Updated 10 min ago". Under a minute, or a device clock a little behind the app, reads
     * "Updated just now" rather than a zero or a negative age.
     */
    public static String updatedText(long nowMs, long updatedAtMs) {
        long age = nowMs - updatedAtMs;
        if (age < 60_000L) return "Updated just now";
        long minutes = age / 60_000L;
        if (minutes < 60) return "Updated " + minutes + " min ago";
        long hours = minutes / 60;
        if (hours < 24) return "Updated " + hours + " hr ago";
        long days = hours / 24;
        return "Updated " + days + (days == 1 ? " day ago" : " days ago");
    }

    /**
     * Whole units in the user's currency. Both fraction bounds are set, because leaving the
     * minimum to the locale default is how the web chart ticks drifted between ICU builds.
     */
    public static String formatAmount(double amount, String currencyCode) {
        NumberFormat fmt = NumberFormat.getCurrencyInstance(Locale.US);
        try {
            fmt.setCurrency(Currency.getInstance(currencyCode));
        } catch (IllegalArgumentException | NullPointerException e) {
            // An unknown code keeps the default rather than crash the widget.
        }
        fmt.setMinimumFractionDigits(0);
        fmt.setMaximumFractionDigits(0);
        return fmt.format(amount);
    }
}
