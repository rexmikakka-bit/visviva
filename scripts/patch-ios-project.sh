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

# ── Export compliance ────────────────────────────────────────────────────────
# Declaring this up front skips the "does your app use encryption?" prompt on every single upload.
# False is correct here: the app ships no cryptography of its own and only makes ordinary HTTPS
# calls (CCP's image server, Fuzzwork market prices, ESI). Exempt under the standard HTTPS carve-out.
$PB -c "Delete :ITSAppUsesNonExemptEncryption" "$PLIST" 2>/dev/null || true
$PB -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST"

echo "patched $PLIST:"
echo "  bundle id      $APP_ID"
echo "  url scheme     $SCHEME://"
echo "  encryption     exempt"
