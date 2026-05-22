package com.treforged.forged;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
import com.treforged.forged.widgets.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {

    private static final String CAP_PREFS  = "CapacitorStorage";
    private static final String BG_RELOAD  = "forged:bg_reload";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);

        // Cold start: clear any bgReload flag left from the previous session.
        // onStop() sets this flag so WebView reloads in the background skip the
        // lock check. A new process/task start is a genuine cold open and must
        // run the full lock check — wipe the flag before the WebView loads.
        if (savedInstanceState == null) {
            prefs().edit().remove(BG_RELOAD).apply();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Mark as a background transition so that if the WebView reloads while
        // the app is paused or the process is suspended, init() skips the lock
        // check. Mirrors applicationDidEnterBackground on iOS.
        prefs().edit().putString(BG_RELOAD, "1").apply();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
    }
}
