package com.treforged.forged.widgets;

import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One row of the Dashboard's Debt Recommendations card, as the app sends it in
 * `nextDebtPayments` (src/lib/widget-snapshot.ts, buildNextDebtPayments). Mirrors the iOS
 * `DebtPayment` decoder in ForgentaWidgetView.swift.
 *
 * `amount` null means the app has not modelled it ("Not modelled"), never 0. `dueDate` null means
 * no due day is recorded ("no due date set"), never today.
 */
public final class DebtPayment {
    private static final Pattern YMD = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})$");

    public final String name;
    public final Double amount;
    /** The user's local calendar day as the app wrote it, YYYY-MM-DD. */
    public final String dueDate;

    public DebtPayment(String name, Double amount, String dueDate) {
        this.name = name;
        this.amount = amount;
        this.dueDate = dueDate;
    }

    /** Null for a row with no usable name. A bad amount or date is dropped to null, not the row. */
    public static DebtPayment fromJson(JSONObject row) {
        if (row == null) return null;
        Object name = row.opt("name");
        if (!(name instanceof String) || ((String) name).trim().isEmpty()) return null;

        Double amount = null;
        Object a = row.opt("amount");
        if (a instanceof Number) {
            double v = ((Number) a).doubleValue();
            if (!Double.isNaN(v) && !Double.isInfinite(v)) amount = v;
        }

        String due = null;
        Object d = row.opt("dueDate");
        if (d instanceof String) {
            Matcher m = YMD.matcher((String) d);
            if (m.matches()) {
                int month = Integer.parseInt(m.group(2));
                int day = Integer.parseInt(m.group(3));
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) due = (String) d;
            }
        }
        return new DebtPayment((String) name, amount, due);
    }
}
