import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // TODO: set your reverse-DNS bundle id once you pick a name (e.g. com.yourname.evefit).
  // This MUST match the bundle identifier in Xcode and the applicationId in Play Console.
  appId: 'com.example.evefit',
  appName: 'EVE Fit',            // TODO: update once you finalize the app name
  webDir: 'dist',                // Vite's production build output
  backgroundColor: '#0e0e10',    // matches the app's dark theme (no white flash on launch)
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0e0e10',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // DARK = light-colored icons/text, correct for a dark background.
      style: 'DARK',
      backgroundColor: '#0e0e10',
      overlaysWebView: false,   // reserve the status-bar area so the header isn't clipped
    },
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
