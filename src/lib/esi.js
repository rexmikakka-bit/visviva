// EVE SSO (OAuth2 + PKCE) login and ESI (EVE Swagger Interface) client.
//
// This app has no backend, so it uses the PKCE flow CCP designed specifically for clients that
// can't hold a client secret (native apps, SPAs). Two open items block this from being live-
// tested end to end — see CLAUDE.md's "ESI connectivity" section:
//   1. ESI_CLIENT_ID in esi-config.js is empty until an application is registered at
//      https://developers.eveonline.com/applications.
//   2. Whether login.eveonline.com's /v2/oauth/token endpoint sends CORS headers for a plain
//      browser fetch() is unconfirmed from CCP's docs — on native builds this is moot, since
//      CapacitorHttp routes fetch() through native networking instead of the WebView, which
//      isn't subject to CORS at all. The web build may need a small proxy if it turns out CORS
//      really is missing; everything in this file is unaffected either way, since it only ever
//      calls fetch() — it doesn't care whether the request is served by the WebView or native.
//
// Character tokens live in localStorage (axis_esi_chars), same as everything else this app
// persists. Unlike a saved fit, a refresh token is a live credential — bounded by ESI's scopes
// (it can only read skills and read/write fittings, nothing account- or wallet-affecting), but
// still a meaningfully different risk class from the rest of what's stored here.

import { ESI_CLIENT_ID, ESI_CALLBACK_URL, ESI_NATIVE_CALLBACK_URL, ESI_SCOPES } from '../esi-config.js';
import { SKILL_CAMEL_TO_PYFA, SKILL_CATALOG, tidByName } from '../calc.js';

const ESI_BASE = 'https://esi.evetech.net/latest';
const SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize/';
const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';

const CHARS_KEY = 'axis_esi_chars';
const ACTIVE_KEY = 'axis_esi_active';
const PKCE_KEY = 'axis_esi_pkce_pending';

// ─── Storage ────────────────────────────────────────────────────────────────────
// Fires whenever linked characters or the active character change, so every mounted ESI UI
// component stays in sync regardless of which path made the change — needed because the native
// login flow completes via an appUrlOpen deep-link event (App.jsx), not a page load, so a Settings
// panel or import/export modal that was already open won't otherwise know to re-read storage.
const CHANGE_EVENT = 'axis-esi-change';
function notifyChange() { try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch {} }
export function onCharactersChanged(cb) {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

// The native login leg finishes in a deep-link listener (App.jsx), not in a component, so a
// failure there has nowhere to render — it used to go to console.error only, which on a phone is
// no error at all. Parked here and broadcast on the same change event the UI already listens to.
let _lastLoginError = null;
export function getLastLoginError() { return _lastLoginError; }
export function setLastLoginError(e) {
  _lastLoginError = e ? (e.message || String(e)) : null;
  notifyChange();
}

function loadChars() { try { return JSON.parse(localStorage.getItem(CHARS_KEY)) ?? []; } catch { return []; } }
function saveChars(list) { try { localStorage.setItem(CHARS_KEY, JSON.stringify(list)); } catch {} }

export function listCharacters() {
  return loadChars().map(c => ({ characterId: c.characterId, characterName: c.characterName, scopes: c.scopes }));
}
export function getActiveCharacterId() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_KEY)) ?? null; } catch { return null; }
}
export function setActiveCharacterId(characterId) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(characterId)); } catch {}
  notifyChange();
}
export function removeCharacter(characterId) {
  const list = loadChars().filter(c => c.characterId !== characterId);
  saveChars(list);
  if (getActiveCharacterId() === characterId) setActiveCharacterId(list[0]?.characterId ?? null);
  else notifyChange();
}

// ─── PKCE ───────────────────────────────────────────────────────────────────────
function base64url(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
async function challengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// Unsigned JWT payload decode — used only to read character id/name/scopes for local display and
// as the ESI request key. This is NOT a security check: the actual boundary is CCP's servers
// validating the token's signature when we send it back as a Bearer token on every ESI call.
function decodeJwtPayload(jwt) {
  const payloadB64 = jwt.split('.')[1];
  const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(b64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
  return JSON.parse(json);
}

// ─── Login flow ─────────────────────────────────────────────────────────────────
function isNative() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

// Is this deep-link URL our SSO callback? Lives here, next to the redirect_uri it has to agree
// with, because the native listener in App.jsx used to hardcode the prefix separately — and when
// the scheme gained its mandatory `eveauth-` prefix, that copy was missed. The listener then
// rejected every real callback, so Browser.close() never ran and login hung on a spinner forever
// with the token exchange never attempted. One source of truth: ESI_NATIVE_CALLBACK_URL.
// Case-insensitive because a scheme is case-insensitive per RFC 3986 and the OS may normalise it.
export function isEsiCallbackUrl(url) {
  if (typeof url !== 'string' || !ESI_NATIVE_CALLBACK_URL) return false;
  return url.toLowerCase().startsWith(ESI_NATIVE_CALLBACK_URL.toLowerCase());
}

// Kicks off SSO login: opens the system browser (native) or redirects the current tab (web).
export async function beginLogin(scopes = ESI_SCOPES) {
  if (!ESI_CLIENT_ID) throw new Error('ESI_CLIENT_ID is not set — see src/esi-config.js');
  const verifier = randomToken();
  const challenge = await challengeFromVerifier(verifier);
  const state = randomToken();
  const redirectUri = isNative() ? ESI_NATIVE_CALLBACK_URL : ESI_CALLBACK_URL;
  try { localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, redirectUri })); } catch {}
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ESI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const url = `${SSO_AUTHORIZE_URL}?${params.toString()}`;
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.location.href = url;
  }
}

async function tokenRequest(bodyParams) {
  const resp = await fetch(SSO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyParams).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ESI token request failed: ${resp.status} ${text}`);
  }
  return resp.json(); // { access_token, refresh_token, expires_in, token_type }
}

// Completes login given the full callback URL (native deep link, or the web page's own
// location.href after the SSO redirect lands back with ?code=&state=).
export async function completeLoginFromCallback(callbackUrl) {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new Error('Missing code/state in ESI callback URL');
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PKCE_KEY)); } catch {}
  if (!pending || pending.state !== state) {
    throw new Error('ESI login state mismatch (stale or replayed callback) — please try logging in again');
  }
  localStorage.removeItem(PKCE_KEY);
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: ESI_CLIENT_ID,
    code_verifier: pending.verifier,
  });
  const claims = decodeJwtPayload(tok.access_token);
  const characterId = Number(String(claims.sub).split(':').pop());
  const characterName = claims.name ?? `Character ${characterId}`;
  const scopes = Array.isArray(claims.scp) ? claims.scp : (claims.scp ? [claims.scp] : []);
  const rec = {
    characterId, characterName, scopes,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
  };
  saveChars([...loadChars().filter(c => c.characterId !== characterId), rec]);
  _lastLoginError = null;
  setActiveCharacterId(characterId);
  return { characterId, characterName, scopes };
}

// Web-only convenience: call once on app boot. No-ops unless the page just loaded with
// ?code=&state= from an SSO redirect (native builds never hit this — they use the deep-link
// listener instead, see CLAUDE.md's ESI section for the App.jsx wiring).
export async function handleWebRedirectOnLoad() {
  if (typeof window === 'undefined' || isNative()) return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') || !params.has('state')) return null;
  try {
    return await completeLoginFromCallback(window.location.href);
  } finally {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ─── Authenticated requests ─────────────────────────────────────────────────────
async function getValidAccessToken(characterId) {
  const list = loadChars();
  const idx = list.findIndex(c => c.characterId === characterId);
  if (idx < 0) throw Object.assign(new Error('Character not linked'), { code: 'ESI_NOT_LINKED' });
  const rec = list[idx];
  if (rec.expiresAt - 60_000 > Date.now()) return rec.accessToken;
  let tok;
  try {
    tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rec.refreshToken, client_id: ESI_CLIENT_ID });
  } catch (e) {
    throw Object.assign(new Error('EVE session expired — please log in again.'), { code: 'ESI_REAUTH_REQUIRED', cause: e });
  }
  rec.accessToken = tok.access_token;
  rec.refreshToken = tok.refresh_token ?? rec.refreshToken; // CCP may rotate the refresh token
  rec.expiresAt = Date.now() + tok.expires_in * 1000;
  list[idx] = rec;
  saveChars(list);
  return rec.accessToken;
}

async function esiRequest(characterId, method, path, body) {
  const token = await getValidAccessToken(characterId);
  const sep = path.includes('?') ? '&' : '?';
  const resp = await fetch(`${ESI_BASE}${path}${sep}datasource=tranquility`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`ESI ${method} ${path} failed: ${resp.status} ${text}`), { status: resp.status });
  }
  return resp.status === 204 ? null : resp.json();
}

// { skills: [{skill_id, trained_skill_level, active_skill_level, skillpoints_in_skill}], total_sp, unallocated_sp }
export function getCharacterSkills(characterId) {
  return esiRequest(characterId, 'GET', `/characters/${characterId}/skills/`);
}
// [{fitting_id, name, description, ship_type_id, items: [{flag, quantity, type_id}]}]
export function getCharacterFittings(characterId) {
  return esiRequest(characterId, 'GET', `/characters/${characterId}/fittings/`);
}
// fitting: {name, description, ship_type_id, items}. Returns {fitting_id}.
export function createCharacterFitting(characterId, fitting) {
  return esiRequest(characterId, 'POST', `/characters/${characterId}/fittings/`, fitting);
}

// ─── Skill sync ─────────────────────────────────────────────────────────────────
// ESI reports each skill by its typeID, and SKILL_CATALOG already carries the typeID of all 357
// skills — so that is a direct match and the primary path. It also picks up the handful of skills
// whose name in SKILL_CAMEL_TO_PYFA is misspelled and therefore never resolved through tidByName
// (a pre-existing gap, 159 of 163 keys). The name lookup stays as a fallback for anything the
// catalog somehow has no typeID for. Built lazily (not at module load) since TYPES/tidByName need
// the dogma bundle initialised first.
let _skillIdToCamel = null;
function skillIdToCamel() {
  if (_skillIdToCamel) return _skillIdToCamel;
  _skillIdToCamel = {};
  for (const e of SKILL_CATALOG) if (e.typeID) _skillIdToCamel[e.typeID] = e.key;
  for (const [camel, pyfaName] of Object.entries(SKILL_CAMEL_TO_PYFA)) {
    const tid = tidByName(pyfaName);
    if (tid && !_skillIdToCamel[tid]) _skillIdToCamel[tid] = camel;
  }
  return _skillIdToCamel;
}

// Maps an ESI skills response onto this app's {camelCaseSkillKey: level} shape, ready to spread
// into `skills` state (e.g. setSkills(s => ({...s, ...esiSkillsToAppSkills(resp)}))). Skills ESI
// doesn't report (untrained) or that we don't have a mapping for are simply absent from the
// result — callers should merge over existing state/defaults, not replace it.
export function esiSkillsToAppSkills(esiSkillsResponse) {
  const idToCamel = skillIdToCamel();
  const out = {};
  for (const s of esiSkillsResponse?.skills ?? []) {
    const camel = idToCamel[s.skill_id];
    if (camel) out[camel] = s.trained_skill_level;
  }
  return out;
}

/**
 * The same response as a COMPLETE skill map: every catalog skill present, untrained ones at 0.
 *
 * This is what "align to this character" must use, and the distinction is not cosmetic. ESI's
 * /skills/ endpoint lists only what the character has actually trained — an untrained skill is
 * simply absent from the response. In this app an ABSENT skill key means level **V**, not zero
 * (calcFitStats defaults every unset skill to V so a fresh install doesn't show every fit as
 * unflyable). Merging the partial map over existing state therefore left every skill the character
 * has never touched reading V: syncing Rex Mikakka produced a pilot with Ice Harvesting Drone
 * Specialization V, which is exactly backwards from what a sync is for.
 *
 * Starting from the full catalog at 0 makes the character authoritative — nothing is left "unset",
 * so nothing falls through to the V default.
 */
export function esiSkillsToFullSkillMap(esiSkillsResponse) {
  const idToCamel = skillIdToCamel();
  const out = {};
  for (const e of SKILL_CATALOG) out[e.key] = 0;
  for (const s of esiSkillsResponse?.skills ?? []) {
    const camel = idToCamel[s.skill_id];
    if (camel) out[camel] = s.trained_skill_level;
  }
  return out;
}
