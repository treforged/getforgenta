package com.treforged.forged.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import com.treforged.forged.MainActivity;
import com.treforged.forged.R;

public class SurplusWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            updateWidget(context, manager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_surplus);

        WidgetSnapshot snap = WidgetSnapshot.load(context);
        // ⚠️ STALE IS TREATED AS ABSENT, NOT AS A NUMBER WITH A CAVEAT. A widget
        // shows a figure without anyone opening the app, so nobody opens the app to
        // check what the home screen already told them — a week-old balance shown
        // confidently is worse than "--", because "--" prompts a tap and a wrong
        // number ends the conversation.
        long now = System.currentTimeMillis();
        if (snap != null && !snap.isStale(now)) {
            // The USER's currency. Formatting a non-USD figure with "$" is a wrong
            // number rendered confidently, which is the same failure as a stale one.
            views.setTextViewText(R.id.widget_amount, WidgetText.formatAmount(snap.monthEndCash, snap.currency));
            // Green when the month ends above zero, red below - the Dashboard's own reading.
            int tone = snap.monthEndCash >= 0 ? R.color.widget_green : R.color.widget_red;
            views.setTextColor(R.id.widget_amount, context.getResources().getColor(tone, null));
            views.setTextViewText(R.id.widget_updated, WidgetText.updatedText(now, snap.updatedAtMs));
            // One line of context under the figure, as on iOS. Hidden when there is none.
            String detail = WidgetText.nextDebtLine(snap);
            views.setTextViewText(R.id.widget_detail, detail == null ? "" : detail);
            views.setViewVisibility(R.id.widget_detail, detail == null ? View.GONE : View.VISIBLE);
        } else {
            // Muted, never the last tone: "--" in confident green reads like a value.
            views.setTextViewText(R.id.widget_amount, "--");
            views.setTextColor(R.id.widget_amount, context.getResources().getColor(R.color.widget_muted, null));
            views.setTextViewText(R.id.widget_updated, "Open Forgenta to sync");
            views.setViewVisibility(R.id.widget_detail, View.GONE);
        }

        // Tap opens the app
        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(context, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        manager.updateAppWidget(widgetId, views);
    }
}
