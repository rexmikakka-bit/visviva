package com.rexmikakka.visviva;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered BEFORE super.onCreate, which builds the bridge.
        registerPlugin(SnapshotPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
