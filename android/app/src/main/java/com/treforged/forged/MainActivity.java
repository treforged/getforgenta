package com.treforged.forged;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
import com.treforged.forged.widgets.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
