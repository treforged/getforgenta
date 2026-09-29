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

    private static final String[] MONTHS =
        {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

    /** "Oct 3" from "2026-10-03", or null. The app's own `formatNextDue` wording, as on iOS. */
    public static String shortDate(String ymd) {
        if (ymd == null || ymd.length() != 10) return null;
        try {
            int month = Integer.parseInt(ymd.substring(5, 7));
            int day = Integer.parseInt(ymd.substring(8, 10));
            if (month < 1 || month > 12 || day < 1 || day > 31) return null;
            return MONTHS[month - 1] + " " + day;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** "due Oct 3", or "no due date set" - never a guessed day. */
    public static String dueText(String ymd) {
        String d = shortDate(ymd);
        return d == null ? "no due date set" : "due " + d;
    }

    /** The amount, or "Not modelled" - never $0 for a payment the app has not worked out. */
    public static String debtAmount(Double amount, String currencyCode) {
        return amount == null ? "Not modelled" : formatAmount(amount, currencyCode);
    }

    /**
     * "Next: Car loan $410 · Oct 3", the soonest row, or null when the app sent no rows. Same
     * line the iOS small Month-End Cash widget prints under its figure.
     */
    public static String nextDebtLine(WidgetSnapshot s) {
        if (s == null || s.nextDebtPayments == null || s.nextDebtPayments.isEmpty()) return null;
        DebtPayment first = s.nextDebtPayments.get(0);
        String amount = first.amount == null ? "not modelled" : formatAmount(first.amount, s.currency);
        String date = shortDate(first.dueDate);
        return "Next: " + first.name + " " + amount + " \u00b7 " + (date == null ? "no due date set" : date);
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
