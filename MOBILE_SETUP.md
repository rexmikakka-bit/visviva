# Shipping to iOS & Android with Capacitor

This wraps the existing Vite + React app in a native shell — no rewrite. The web code
stays the source of truth; Capacitor produces real `ios/` and `android/` native projects
you build and submit like any native app.

The in-app code changes are already done (see "What's already wired up" at the bottom).
This guide covers everything that has to happen on **your machine**.

---

## 0. Prerequisites

- **Node.js** (already have it).
- **iOS builds require a Mac with Xcode.** No exceptions — Apple's toolchain is Mac-only.
  Install Xcode from the App Store, then run `xcode-select --install` for the CLI tools.
- **Android builds need Android Studio** (any OS). Install it and let it pull down the
  Android SDK + platform tools on first launch.
- Developer accounts (set these up early — Apple's can take a day to activate):
  - **Apple Developer Program** — $99/year.
  - **Google Play Console** — $25 one-time.

---

## 1. Add Capacitor

From the project root:

```bash
npm i @capacitor/core @capacitor/cli
npm i @capacitor/ios @capacitor/android
```

Drop the provided **`capacitor.config.ts`** into the project root (already generated for
you). Open it and set `appId` and `appName` once you've picked a name — `appId` must be
reverse-DNS (e.g. `com.yourname.evefit`) and must match Xcode / Play Console exactly.

Then build the web app and add the native platforms:

```bash
npm run build          # produces dist/
npx cap add ios
npx cap add android
```

Check the new `ios/` and `android/` folders into git — they're part of your app now.

---

## 2. Install the native plugins the app uses

The in-app code already calls these through the Capacitor runtime bridge, so **no import
changes are needed** — just install them and sync:

```bash
npm i @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen
# optional, see "Storage" below:
# npm i @capacitor/preferences
```

- **Haptics** — makes the module-state ticks and subtab swipes fire on iPhones (the web
  Vibration API is a no-op on iOS Safari; this uses the real Taptic Engine).
- **Status Bar** — light icons over the dark theme, kept out of the webview.
- **Splash Screen** — dismissed automatically once React mounts.

---

## 3. One edit you have to make by hand: `index.html`

`env(safe-area-inset-*)` (used to keep the bottom nav clear of the iPhone home indicator)
only works if the viewport opts into the full screen. Update the viewport meta in
`index.html`:

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
```

`viewport-fit=cover` enables the safe-area insets; `user-scalable=no` stops the pinch-zoom
that feels wrong in a native app.

---

## 4. Icons & splash screen

Generate every icon/splash size from a single source image:

```bash
npm i -D @capacitor/assets
# put a 1024x1024 icon at assets/icon.png and a 2732x2732 splash at assets/splash.png
npx capacitor-assets generate
```

Use `#0e0e10` as the splash background so it matches the config and there's no flash.

---

## 5. The build → sync → open loop

Any time you change the web code:

```bash
npm run build && npx cap sync
```

`cap sync` copies `dist/` into both native projects and updates native dependencies.
Then open the platform you're working on:

```bash
npx cap open ios        # opens Xcode
npx cap open android    # opens Android Studio
```

Handy `package.json` scripts to add:

```json
{
  "scripts": {
    "cap:sync": "npm run build && npx cap sync",
    "cap:ios": "npm run build && npx cap sync && npx cap open ios",
    "cap:android": "npm run build && npx cap sync && npx cap open android"
  }
}
```

---

## 6. iOS specifics

1. `npx cap open ios`, select the project target.
2. **Signing & Capabilities** → pick your Team; Xcode auto-manages the provisioning profile.
   Set the Bundle Identifier to match `appId`.
3. Networking is fine as-is: the app only fetches icons over **HTTPS**
   (`images.evetech.net`), so Apple's App Transport Security needs no exceptions.
4. Set the deployment target (iOS 14+ is a safe floor for current Capacitor).
5. Test on a real device, then **Product → Archive** → Distribute App → App Store Connect.
6. In **App Store Connect**: create the app record, upload the build, add it to
   **TestFlight** to test on your devices, then submit for review.

## 7. Android specifics

1. `npx cap open android`, let Gradle sync.
2. Set `applicationId` (matches `appId`) in `android/app/build.gradle`.
3. Create an upload keystore and configure signing (Android Studio: **Build → Generate
   Signed Bundle/APK → Android App Bundle**). **Back up that keystore** — losing it means
   you can never update the app under the same listing.
4. Build a signed **AAB** (Android App Bundle, not APK — Play requires AAB).
5. In **Play Console**: create the app, upload the AAB to the **Internal testing** track
   first, then promote to Production.

---

## 8. Store submission checklist

- **Screenshots** for the required device sizes (both stores).
- **Privacy:** the app stores everything locally and collects no personal data — declare
  "no data collected" on Apple's Privacy Nutrition Label and Google's Data Safety form.
  (If you later add EVE SSO / ESI login, that changes — you'd be handling account tokens.)
- **Content rating** questionnaire (Google) — this is a utility, straightforward.
- **IP disclaimer** in the listing description (see licensing below).
- Apple **Guideline 4.2 (minimum functionality):** you're safe — this is a rich offline
  calculator, not a website wrapper, and the native haptics/status-bar/splash reinforce that.

---

## 9. Licensing — do this before you publish

An EVE fitting tool uses CCP's IP (item names, the SDE data, the image server), so it falls
under CCP's third-party **Developer License Agreement** (developers.eveonline.com; CCP
rebranded to Fenris Creations in 2026, but the license still lives there).

- **Ship it free.** The default developer license is non-commercial — you generally can't
  charge for the app or otherwise monetize it (voluntary donations / in-game ISK are the
  narrow exceptions). If you want to charge, email **developerlicense@ccpgames.com** and
  ask about commercial terms rather than assuming.
- **The required disclaimer is already in the app** (Settings → footer). Mirror it in your
  store listing: *"Unofficial fan-made tool. Not affiliated with or endorsed by CCP Games /
  Fenris Creations. EVE Online and all related materials are the property of CCP hf."*
- **App name:** once you pick one, avoid implying an official affiliation (a distinct,
  original name is cleanest — and steers clear of leaning on the "Pyfa" project name).

---

## 10. Storage (optional hardening, later)

The app uses `localStorage` for saved fits, skills, and prefs. In a Capacitor WebView that
**persists fine across launches** — good enough for v1. The only edge case is the OS
evicting WebView storage under extreme disk pressure (rare). If you want belt-and-suspenders
durability later, install `@capacitor/preferences` and mirror the critical keys
(`pyfa-fitsdb`, `pyfa-activefit`, `pyfa-skills`) into it. Not required to launch.

---

## What's already wired up in the app code

These are done in `App.jsx` — nothing more to change for them:

- **Haptics** route through `window.Capacitor.Plugins.Haptics` when running natively, with
  the web `navigator.vibrate` fallback. (Bridge-based, so it never breaks the web build.)
- **Status bar + splash** are configured on mount via the same bridge (no-op on web).
- **Safe-area insets** on the bottom nav (and the settings footer) via
  `env(safe-area-inset-bottom)` — needs the `index.html` viewport change in step 3.
- **IP disclaimer** in the Settings sheet footer.
