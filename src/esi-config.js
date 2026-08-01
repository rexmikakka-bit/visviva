// Fill these in once an ESI application is registered at
// https://developers.eveonline.com/applications — Application Type "Authentication & API
// Access", connection type "Public Client / PKCE" (this app has no backend, so it cannot hold
// a client secret; PKCE is the flow designed for exactly that case).
//
// Register BOTH callback URLs below as "Callback URL" entries on the application (ESI SSO
// rejects any redirect_uri that isn't an exact match to one you registered).

// The application's Client ID (a UUID-looking string). Empty until registered.
export const ESI_CLIENT_ID = '';

// Web build's OAuth redirect target — the app's own origin. On load, main.jsx checks
// location.search for ?code=&state= left behind by this redirect (see esi.js#completeLoginFromUrl).
export const ESI_CALLBACK_URL = typeof window !== 'undefined' ? `${window.location.origin}/` : '';

// Native (Capacitor/Android/iOS) build's redirect target — a custom URL scheme, since a mobile
// app has no "origin" a browser can redirect back to. Must match the intent-filter registered in
// android/app/src/main/AndroidManifest.xml (see CLAUDE.md's ESI section) and iOS's URL scheme
// config, and must ALSO be registered as a Callback URL on the ESI application above.
export const ESI_NATIVE_CALLBACK_URL = 'visviva://auth-callback';

// Scopes requested at login. Adding a scope later requires re-login (existing tokens don't
// retroactively gain it) — ESI scopes are fixed at grant time.
export const ESI_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-fittings.read_fittings.v1',
  'esi-fittings.write_fittings.v1',
];
