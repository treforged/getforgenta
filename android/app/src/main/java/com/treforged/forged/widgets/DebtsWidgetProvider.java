package com.treforged.forged.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import com.treforged.forged.MainActivity;
import com.treforged.forged.R;

import java.util.List;

/**
 * Next Debt Payments: up to three rows of the Dashboard's Debt Recommendations card, soonest first,
 * exactly as the app sent them in `nextDebtPayments`. Nothing is recalculated here. Matches the
 * iOS `.debts` widget in ForgentaWidgetView.swift.
 */
public class DebtsWidgetProvider extends AppWidgetProvider {

    private static final int[] ROWS = {R.id.debt_row_0, R.id.debt_row_1, R.id.debt_row_2};
    private static final int[] NAMES = {R.id.debt_name_0, R.id.debt_name_1, R.id.debt_name_2};
    private static final int[] DUES = {R.id.debt_due_0, R.id.debt_due_1, R.id.debt_due_2};
    private static final int[] AMOUNTS = {R.id.debt_amount_0, R.id.debt_amount_1, R.id.debt_amount_2};

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            updateWidget(context, manager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_debts);
        for (int row : ROWS) views.setViewVisibility(row, View.GONE);

        WidgetSnapshot snap = WidgetSnapshot.load(context);
        long now = System.currentTimeMillis();
        // Stale is absent, as in the other two widgets. And a snapshot from an app build that never
        // sent the rows is ALSO absent: that is "not sent", not "no debts".
        if (snap != null && !snap.isStale(now) && snap.nextDebtPayments != null) {
            List<DebtPayment> rows = snap.nextDebtPayments;
            if (rows.isEmpty()) {
                views.setViewVisibility(R.id.widget_amount, View.VISIBLE);
                views.setTextViewText(R.id.widget_amount, "No debt payments due.");
                views.setTextViewTextSize(R.id.widget_amount, TypedValue.COMPLEX_UNIT_SP, 13f);
            } else {
                views.setViewVisibility(R.id.widget_amount, View.GONE);
                int muted = context.getResources().getColor(R.color.widget_muted, null);
                int gold = context.getResources().getColor(R.color.widget_gold, null);
                for (int i = 0; i < Math.min(ROWS.length, rows.size()); i++) {
                    DebtPayment row = rows.get(i);
                    views.setViewVisibility(ROWS[i], View.VISIBLE);
                    views.setTextViewText(NAMES[i], row.name);
                    views.setTextViewText(DUES[i], WidgetText.dueText(row.dueDate));
                    views.setTextViewText(AMOUNTS[i], WidgetText.debtAmount(row.amount, snap.currency));
                    views.setTextColor(AMOUNTS[i], row.amount == null ? muted : gold);
                }
            }
            views.setTextViewText(R.id.widget_updated, WidgetText.updatedText(now, snap.updatedAtMs));
        } else {
            views.setViewVisibility(R.id.widget_amount, View.VISIBLE);
            views.setTextViewText(R.id.widget_amount, "--");
            views.setTextViewTextSize(R.id.widget_amount, TypedValue.COMPLEX_UNIT_SP, 30f);
            views.setTextViewText(R.id.widget_updated, "Open Forgenta to sync");
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(context, 2, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        manager.updateAppWidget(widgetId, views);
    }
}
