// Fill these in once an ESI application is registered at
// https://developers.eveonline.com/applications — Application Type "Authentication & API
// Access", connection type "Public Client / PKCE" (this app has no backend, so it cannot hold
// a client secret; PKCE is the flow designed for exactly that case).
//
// Register BOTH callback URLs below as "Callback URL" entries on the application (ESI SSO
// rejects any redirect_uri that isn't an exact match to one you registered).

// The application's Client ID. Safe to commit to a PUBLIC repo, and it has to be: in a PKCE flow
// the client id is sent in the clear on the authorize URL, so it is public by design. It identifies
// the application, it does not authenticate it — that is what the PKCE code_verifier does.
//
// There is deliberately NO client secret here, and there must never be one. This is a PUBLIC client
// (a mobile app the user installs), so any secret shipped inside it is readable by anyone who
// unzips the APK — which is precisely why PKCE exists and why the token exchange in esi.js sends
// only the verifier.
export const ESI_CLIENT_ID = '6ae86865651f43518c6d866bcb08a6e2';

// Web build's OAuth redirect target — the app's own origin. On load, main.jsx checks
// location.search for ?code=&state= left behind by this redirect (see esi.js#completeLoginFromUrl).
export const ESI_CALLBACK_URL = typeof window !== 'undefined' ? `${window.location.origin}/` : '';

// Native (Capacitor/Android/iOS) build's redirect target — a custom URL scheme, since a mobile
// app has no "origin" a browser can redirect back to. Must match the intent-filter registered in
// android/app/src/main/AndroidManifest.xml (see CLAUDE.md's ESI section); iOS derives its
// CFBundleURLSchemes from THIS constant in scripts/patch-ios-project.sh, so that side follows
// automatically.
//
// The `eveauth-` prefix is MANDATORY, not decoration. developers.eveonline.com accepts only three
// callback schemes — https, http (localhost only), and `eveauth` followed by lower-case letters,
// digits, plus, period or hyphen. A bare `visviva://` is rejected at application-registration time,
// so the redirect could never have been registered and every login would have failed with an
// invalid_request on the redirect_uri.
export const ESI_NATIVE_CALLBACK_URL = 'eveauth-visviva://auth-callback';

// Scopes requested at login. Adding a scope later requires re-login (existing tokens don't
// retroactively gain it) — ESI scopes are fixed at grant time.
export const ESI_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-fittings.read_fittings.v1',
  'esi-fittings.write_fittings.v1',
];
