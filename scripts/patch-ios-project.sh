#!/usr/bin/env bash
# Settings that have to live in the generated iOS project rather than in capacitor.config.json.
#
# `ios/` is NOT committed — CI regenerates it with `npx cap add ios` on every run, so anything
# hand-edited in Xcode would be lost. This script is where those edits live instead. Run it after
# `cap add`/`cap sync` and before archiving. Idempotent: safe to run over an existing project.
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy
[ -f "$PLIST" ] || { echo "no $PLIST — run 'npx cap add ios' first"; exit 1; }

# Bundle ID comes from capacitor.config.json so there is exactly one source of truth for it.
APP_ID=$(node -p "require('./capacitor.config.json').appId")

# ── ESI deep link ────────────────────────────────────────────────────────────
# The iOS half of the OAuth callback. Android declares this as an intent-filter in its manifest
# (scheme "eveauth-visviva", host "auth-callback"); iOS needs the scheme in CFBundleURLTypes or the
# redirect from login.eveonline.com has nowhere to land and the login silently never completes.
# Must match ESI_NATIVE_CALLBACK_URL in src/esi-config.js AND a Callback URL registered on the
# ESI application itself.
SCHEME=$(node -p "require('fs').readFileSync('src/esi-config.js','utf8').match(/ESI_NATIVE_CALLBACK_URL\s*=\s*'([a-z][a-z0-9+.-]*):/i)[1]")

$PB -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
$PB -c "Add :CFBundleURLTypes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string $APP_ID" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string $SCHEME" "$PLIST"

# ── iPhone only ──────────────────────────────────────────────────────────────
# Capacitor generates a universal (1,2) app, which is incompatible with the portrait lock below:
# App Store Connect rejects any iPad-capable bundle whose iPad orientation key does not list all
# four orientations (error 90474, "you need to include all of the ... orientations to support iPad
# multitasking"). UIRequiresFullScreen used to exempt you from that; it is ignored as of the iOS 26
# SDK, which is what CI builds against — so keeping portrait means not shipping for iPad.
#
# Little is lost: every layout here is a single narrow column, so an iPad build was a stretched
# phone app rather than a tablet one. Revisit if the app ever grows a wide layout.
PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
sed -i '' 's/TARGETED_DEVICE_FAMILY = "[^"]*";/TARGETED_DEVICE_FAMILY = "1";/g' "$PBXPROJ"
# Fail loudly rather than silently archiving a universal build: if Capacitor ever renames or drops
# the setting, the sed is a no-op and the failure would otherwise surface 15 minutes later inside
# Apple's validator, having burned a build number.
grep -q 'TARGETED_DEVICE_FAMILY = "1";' "$PBXPROJ" || {
  echo "TARGETED_DEVICE_FAMILY not found in $PBXPROJ — the iPhone-only patch did not apply"; exit 1; }

# ── Orientation lock ─────────────────────────────────────────────────────────
# Every layout in the app is built for one narrow column — the fit list, the sticky resource strip,
# the bottom sheets — so a landscape rotation gives a stretched, unusable screen rather than a wider
# one. Android does this with android:screenOrientation in its manifest.
#
# The ~ipad variant is DELETED, not set to portrait: a portrait-only iPad key is precisely what
# Apple's validator rejects, and with an iPhone-only target it would be dead weight anyway.
$PB -c "Delete :UISupportedInterfaceOrientations~ipad" "$PLIST" 2>/dev/null || true
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"

# ── Export compliance ────────────────────────────────────────────────────────
# Declaring this up front skips the "does your app use encryption?" prompt on every single upload.
# False is correct here: the app ships no cryptography of its own and only makes ordinary HTTPS
# calls (CCP's image server, Fuzzwork market prices, ESI). Exempt under the standard HTTPS carve-out.
$PB -c "Delete :ITSAppUsesNonExemptEncryption" "$PLIST" 2>/dev/null || true
$PB -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST"

echo "patched $PLIST:"
echo "  bundle id      $APP_ID"
echo "  url scheme     $SCHEME://"
echo "  device family  iPhone only"
echo "  orientation    portrait only"
echo "  encryption     exempt"
