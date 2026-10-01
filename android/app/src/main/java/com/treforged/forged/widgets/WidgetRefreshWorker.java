package com.treforged.forged.widgets;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.concurrent.futures.CallbackToFutureAdapter;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ListenableWorker;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkerParameters;

import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Refreshes the home-screen widgets every 6 hours while the app is closed (Tre, 2026-10-01, ask
 * e74da89c) by loading the app's OWN /dashboard in a hidden WebView. The page computes the figures
 * with the real engine and hands them back through `window.ForgentaWidgetHost.postMessage`, so no
 * money logic is copied into Java.
 *
 * OFF BY DEFAULT. The app turns it on per user through WidgetBridge.setBackgroundRefresh.
 * Android may defer it under Doze and App Standby, so 6 hours is a floor, not a promise.
 * The page detects this WebView by its channel (src/lib/widget-host.ts) and runs no idle sign-out
 * and no resume recovery in it, because it shares the real session.
 */
public class WidgetRefreshWorker extends ListenableWorker {
    public static final String UNIQUE_NAME = "forgenta-widget-refresh";
    static final String URL = "https://getforgenta.com/dashboard";
    static final long TIMEOUT_MS = 60_000L;
    private static final String TAG = "WidgetRefresh";

    /** Set by MainActivity. The visible app already publishes, and two clients refreshing one
     *  Supabase session at the same moment is how a session gets revoked. */
    public static volatile boolean appInForeground = false;

    public WidgetRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    public ListenableFuture<Result> startWork() {
        return CallbackToFutureAdapter.getFuture(completer -> {
            if (appInForeground) {
                completer.set(Result.success());
                return "skipped: app in foreground";
            }
            final Context ctx = getApplicationContext();
            final Handler main = new Handler(Looper.getMainLooper());
            final AtomicBoolean done = new AtomicBoolean(false);
            main.post(() -> {
                final WebView webView = new WebView(ctx);
                webView.getSettings().setJavaScriptEnabled(true);
                webView.getSettings().setDomStorageEnabled(true);
                webView.measure(
                    View.MeasureSpec.makeMeasureSpec(390, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(844, View.MeasureSpec.EXACTLY));
                webView.layout(0, 0, 390, 844);

                final Runnable finish = () -> {
                    webView.removeJavascriptInterface("ForgentaWidgetHost");
                    webView.stopLoading();
                    webView.destroy();
                    completer.set(Result.success());
                };

                webView.addJavascriptInterface(new Object() {
                    @JavascriptInterface
                    public void postMessage(String json) {
                        // Binder thread. Only the first message or the timeout finishes the work.
                        main.post(() -> {
                            if (done.getAndSet(true)) return;
                            try {
                                JSONObject p = new JSONObject(json);
                                JSONArray debts = p.optJSONArray("nextDebtPayments");
                                WidgetSnapshot.save(ctx, p.getDouble("monthEndCash"), p.getDouble("netWorth"),
                                    p.optString("currency", "USD"), debts == null ? null : debts.toString());
                                WidgetBridgePlugin.updateAllWidgets(ctx);
                            } catch (JSONException e) {
                                Log.w(TAG, "unreadable payload, widget left as it was", e);
                            }
                            finish.run();
                        });
                    }
                }, "ForgentaWidgetHost");

                // Success, not retry: the next period tries again, and a retry backoff only burns battery.
                main.postDelayed(() -> {
                    if (done.getAndSet(true)) return;
                    Log.w(TAG, "timed out after " + TIMEOUT_MS + " ms, widget left as it was");
                    finish.run();
                }, TIMEOUT_MS);

                webView.loadUrl(URL);
            });
            return "forgenta widget refresh";
        });
    }

    public static void schedule(@NonNull Context ctx, boolean enabled) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) {
            wm.cancelUniqueWork(UNIQUE_NAME);
            return;
        }
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(WidgetRefreshWorker.class, 6, TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        wm.enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }
}
