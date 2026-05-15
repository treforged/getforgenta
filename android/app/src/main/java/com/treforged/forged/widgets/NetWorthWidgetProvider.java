package com.treforged.forged.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.text.format.DateUtils;
import android.widget.RemoteViews;

import com.treforged.forged.MainActivity;
import com.treforged.forged.R;

import java.text.NumberFormat;
import java.util.Locale;

public class NetWorthWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            updateWidget(context, manager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_networth);

        WidgetSnapshot snap = WidgetSnapshot.load(context);
        if (snap != null) {
            NumberFormat fmt = NumberFormat.getCurrencyInstance(Locale.US);
            fmt.setMaximumFractionDigits(0);
            String amount = fmt.format(snap.netWorth);
            boolean positive = snap.netWorth >= 0;

            views.setTextViewText(R.id.widget_amount, amount);
            views.setTextColor(R.id.widget_amount,
                context.getResources().getColor(positive ? R.color.widget_gold : R.color.widget_red, null));

            CharSequence ago = snap.updatedAtMs > 0
                ? DateUtils.getRelativeTimeSpanString(snap.updatedAtMs)
                : "Tap to sync";
            views.setTextViewText(R.id.widget_updated, ago);
        } else {
            views.setTextViewText(R.id.widget_amount, "--");
            views.setTextViewText(R.id.widget_updated, "Open Forgenta to sync");
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(context, 1, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        manager.updateAppWidget(widgetId, views);
    }
}
