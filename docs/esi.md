# ESI connectivity — skills sync, in-game fit import/export

> Referenced from the top-level `CLAUDE.md`. Read this when touching character login, skill sync,
> or ESI-based fit import/export.

Live since 2026-08-09. Character login (EVE SSO + PKCE), skill sync, and importing/exporting fits
directly against a character's in-game saved fittings. The ESI application is registered and
`ESI_CLIENT_ID` is populated; a real login was exercised end-to-end on a device build, which
confirmed the one thing fixtures could never cover — that `login.eveonline.com`'s token endpoint
answers over Capacitor's native networking. Nothing here is pending.

## Files

| File | Role |
| --- | --- |
| `src/esi-config.js` | Client ID, both callback URLs, requested scopes. The client ID is public by design in a PKCE flow — there is no secret here and there must never be one. |
| `src/lib/esi.js` | OAuth2+PKCE login, token storage/refresh, authenticated ESI GET/POST, skill-id → app-skill mapping. |
| `src/lib/esi-fits.js` | ESI saved-fitting JSON ⇄ this app's slot model, both directions. |
| `src/components/esi-ui.jsx` | Character login/switcher (Settings → ESI), Import-from-EVE and Export-to-EVE modals (hamburger menu). |

## Why this needed no backend

PKCE exists specifically so a public client with no client secret (this app, always) can do OAuth
without a server. The remaining question was whether `login.eveonline.com`'s token endpoint
answers a browser's `fetch()` at all (CORS) — docs don't say either way, and a related SSO endpoint
is known to fail CORS preflight (github.com/esi/esi-issues#197). This only matters for the **web**
build; the **native** build sidesteps it entirely: `capacitor.config.json` now sets
`CapacitorHttp.enabled: true`, which makes Capacitor route `fetch()`/`XHR` through native
networking instead of the WebView — not subject to browser CORS at all, since CORS is a browser
concept. Every ESI/SSO call in `esi.js` is a plain `fetch()`; it does not know or care which
transport actually serves it. **This one config line is why the whole feature could be built
backend-less.** If the web build ever turns out to need a proxy for the token exchange specifically
(nothing else), that's a small addition scoped to one function (`tokenRequest` in `esi.js`) — it
does not touch this file's architecture.

## ⚠️ The ESI fittings flag scheme is a STRING ENUM (corrected 2026-08-13)

`/characters/{id}/fittings/` items use **string flags** in both directions: `"HiSlot0".."HiSlot7"`,
`"MedSlot0..7"`, `"LoSlot0..7"`, `"RigSlot0..2"`, `"ServiceSlot0..7"`, `"SubSystemSlot0..3"`, plus
`"Cargo"`, `"DroneBay"`, `"FighterBay"` and `"Invalid"` (entries ESI wants discarded). It is **not**
the classic numeric inventory-flag scheme (LoSlot0=11, HiSlot0=27, RigSlot0=92, Cargo=5, …) that the
old XML API and the SDE's `invFlags` table used. The numbers are silently rejected.

This project previously documented the numeric scheme, sourced from `Pyfa-master/service/port/esi.py`
— which still sends numeric `INV_FLAGS`. **That was the bug**: every module of an imported fit failed
its flag lookup and was dropped, leaving a bare hull, and every exported fit was rejected the same
way. The authoritative source is CCP's own published schema,
**https://esi.evetech.net/meta/openapi.json** (`CharactersCharacterIdFittingsGet` and the POST request
body) — check the schema, not a port of it. Note `/latest/swagger.json` now 404s; `/latest` still
works as a request base.

Numeric flags are still **accepted on import**, because a fitting JSON written by an older tool is a
real thing a user will paste at us and the two schemes cannot be confused — one is a number. Export
emits strings only. `SubSystemSlot<n>` is derived from the type's `subSystemSlot` attribute (attr
1366), which CCP still ships in the old 125-128 numbering, so it names the slot **index** (125 →
`SubSystemSlot0`). Pinned by regression section **13l**.

**The wider lesson still holds, with a correction: read the live schema first, then pyfa.** pyfa's
source is authoritative for *dogma effects* because eos hand-implements them; it is not authoritative
for an API contract CCP has since changed underneath it.

Also confirmed there (and it matches a well-known in-game limitation): a saved fitting does **not**
record which module a charge was loaded into. pyfa's own export aggregates all loaded charges,
fit-wide, into a flat cargo-hold quantity (flag=Cargo) rather than per-module, and its import just
dumps everything with flag=Cargo into the cargo hold — no attempt to guess which module a charge
belongs to. `esi-fits.js` does the same on both sides, deliberately, rather than inventing a
round-trip precision ESI itself doesn't support.

## What's verified (no live ESI calls needed for any of this)

- PKCE `code_verifier`/`code_challenge` generation against the **RFC 7636 canonical test vector** —
  byte-exact match.
- JWT payload decode, including non-ASCII character names (UTF-8 through the base64url path).
- `esiFittingToImportShape()` → `buildSlotsFromEFT()` → `slotsToEsiFitting()` round-trip, including
  the T3-cruiser subsystem case (`SubSystemSlot0..3` preserved exactly).
- Unknown/unpublished `type_id`s in an ESI fitting are skipped, not mis-placed or crash-inducing.
- Skill-id → app-skill mapping reuses `calc.js`'s existing `SKILL_CAMEL_TO_PYFA` (now exported) —
  159/163 skill keys resolve to a real ESI skill_id; the 4 that don't are a pre-existing gap in that
  map (unrelated skill-name typos), not something ESI sync introduced. They just don't sync; nothing
  breaks.
- Every UI state (not connected, connected/one character, connected/multiple characters, no active
  fit, "ESI isn't configured yet") renders correctly with a fake character record injected directly
  into `localStorage` (same technique as the Optimize Fit Price verification), confirmed live
  in the dev server, no crashes, no console errors.
- The Android manifest's deep-link intent-filter (`eveauth-visviva://auth-callback`) and the `CapacitorHttp`
  config both compile in and show up correctly in a built debug APK (checked with `aapt2 dump
  xmltree` and by reading the synced `android/app/src/main/assets/capacitor.config.json`).

## The registered application (things that break login if changed)

The app is registered at developers.eveonline.com as Application Type "Authentication & API Access",
public client / PKCE. Two of its settings are mirrored in this repo and must stay in sync with it:

- **Both callback URLs** — the web origin and `eveauth-visviva://auth-callback` — are registered
  there. ESI SSO matches `redirect_uri` exactly, so a URL the application does not list is rejected
  outright. This is one of the three reasons the `visviva` name is frozen (see the top of
  `CLAUDE.md`).
- **Scopes** are fixed at grant time. Adding one to `ESI_SCOPES` does not retroactively extend
  existing tokens, so every already-logged-in character has to log in again to pick it up.

Changing the client ID or either callback is a re-registration, not an edit.
