import TYPE_ICONS from "../data/type-icons.json";

// ── Icons & renders ─────────────────────────────────────────────────────────────
// These are BUNDLED from src/assets/, not fetched. The shipped app has to work offline, so the art
// must be part of the build. Populate the folders with `node scripts/fetch-art.mjs` (downloads from
// CCP's image server) and commit them; the app then needs no network for images.
//
// `scripts/bundle-icons.mjs` copies the same folders out of a pyfa checkout and is what they were
// FIRST built from, but pyfa's art is its ceiling — 32px icons, 64px renders — which testers read as
// blurry on a 3x phone panel. fetch-art.mjs supersedes it for icons and renders; bundle-icons.mjs is
// kept because it is the only thing that maps pyfa's graphicID-named renders to typeIDs, and it
// needs no network.
//
// ⚠ The files under renders/ and hero-renders/ are JPEG bytes with a .png NAME. CCP's render
// endpoint serves JPEG; the extension is kept so these globs stay single-format, and the browser
// dispatches on content sniffing, not on the name. Nothing is lost — the renders never had alpha.
//
// Two things that were previously broken — don't re-break them:
//
//   * The globs used to point at `pyfa-master/`, which is GITIGNORED. On any machine without a pyfa
//     checkout — CI, a release build, a new teammate — they matched nothing and every image silently
//     fell back to the EVE image server. Fine in dev, fatal for an offline app. Never point these at
//     anything outside the repo.
//
//   * Renders are keyed by graphicID in pyfa, NOT typeID, so the old `_renderByType[typeID]` lookup
//     never matched a single hull (0/423) — ship renders always came from the network, even with a
//     pyfa checkout present. bundle-icons.mjs maps graphicID -> typeID when copying, so the files
//     here ARE typeID-named and the lookup finally works.
//
// The image-server fallback stays for the ~1,000 types pyfa has no art for: fine online, hidden by
// onError offline.
const _ICON_FILES      = import.meta.glob("../assets/icons/*.png",      { eager: true, query: "?url", import: "default" });
const _RENDER_FILES    = import.meta.glob("../assets/renders/*.png",    { eager: true, query: "?url", import: "default" });
// Per-typeID icons downloaded from images.evetech.net for types that carry no iconID in CCP's data
// (drones, fighters, deployables). Keyed by typeID rather than iconID — see fetch-art.mjs.
const _TYPE_ICON_FILES = import.meta.glob("../assets/type-icons/*.png", { eager: true, query: "?url", import: "default" });
// 256px renders for the one place a hull's art is shown at the width of the screen — twice the 128px
// of renders/ above, because this one is a picture rather than a label. See
// scripts/fetch-hero-renders.mjs, which also records why 256 and not 512.
const _HERO_FILES      = import.meta.glob("../assets/hero-renders/*.png", { eager: true, query: "?url", import: "default" });

const _iconByID = {};      // iconID -> bundled url
for (const [p, u] of Object.entries(_ICON_FILES)) {
  const m = p.match(/\/(\d+)\.png$/);
  if (m) _iconByID[m[1]] = u;
}

const _renderByType = {};  // typeID -> bundled url
for (const [p, u] of Object.entries(_RENDER_FILES)) {
  const m = p.match(/\/(\d+)\.png$/);
  if (m) _renderByType[m[1]] = u;
}

const _typeIconByID = {};  // typeID -> bundled url (for types with no iconID)
for (const [p, u] of Object.entries(_TYPE_ICON_FILES)) {
  const m = p.match(/\/(\d+)\.png$/);
  if (m) _typeIconByID[m[1]] = u;
}

const _heroByType = {};    // typeID -> bundled 256px url
for (const [p, u] of Object.entries(_HERO_FILES)) {
  const m = p.match(/\/(\d+)\.png$/);
  if (m) _heroByType[m[1]] = u;
}

// ⚠️ SHIPS AND STRUCTURES HAVE NO iconID AT ALL — 417 of 423 hulls and 17 of 18 structures carry
// none, because CCP identifies them by graphicID and lets the client render the model. So the
// iconID lookup can never resolve a hull, and every ship icon in the browser, the fit list and the
// tab strip came off the image server: fine online, blank the moment the phone lost signal.
//
// The RENDER is the same art at 64px and is already bundled for all 440 of them, so it stands in.
// CCP's own image server does effectively this too — a ship's `/icon` is a downscaled render — so
// the offline image matches what was there online rather than being a substitute for it.
const eveIcon = (typeID, size = 32) => {
  if (!typeID) return null;
  const iid = TYPE_ICONS[typeID];
  if (iid != null && _iconByID[iid]) return _iconByID[iid];                 // bundled (offline)
  if (_typeIconByID[typeID]) return _typeIconByID[typeID];                  // drone/fighter/deployable (offline)
  if (_renderByType[typeID]) return _renderByType[typeID];                  // hull/structure render (offline)
  return `https://images.evetech.net/types/${typeID}/icon?size=${size}`;    // fallback (online only)
};

const eveRender = (typeID, size = 64) => {
  if (!typeID) return null;
  if (_renderByType[typeID]) return _renderByType[typeID];                  // bundled (offline)
  return `https://images.evetech.net/types/${typeID}/render?size=${size}`;  // fallback (online only)
};

// The BUNDLED hero render — the offline answer for the one place a hull's art is the subject rather
// than a label, and what that place paints first.
//
// It falls back to the 64px render rather than to the network, because this is the image that has to
// exist: eveRenderHi is layered over it and may never arrive. One hull (Boobook) has no render on
// CCP's server at all and lands here.
const eveHeroRender = (typeID) => {
  if (!typeID) return null;
  return _heroByType[typeID] ?? eveRender(typeID);
};

// A HERO-sized render at 512, fetched.
//
// This is the single spot in the app allowed to prefer the network, and it is safe precisely because
// it cannot fail into nothing: the caller paints eveHeroRender first and only swaps this in once it
// has decoded, so an offline device loses sharpness and keeps the picture. Do not reuse it anywhere
// the image is the only image — that is what eveRender is for.
//
// 512 is fetched rather than bundled because the maths does not work: the art is ~12 KB per hull at
// 256 but ~39 KB at 512, and across 440 hulls that is 5.3 MB against 17 MB — the latter roughly
// doubling the app's download for a picture most sessions never open.
const eveRenderHi = (typeID, size = 512) =>
  typeID ? `https://images.evetech.net/types/${typeID}/render?size=${size}` : null;

// Warm the browser's HTTP cache with a hull's hero render ahead of anyone asking to see it, so the
// ship sheet opens sharp rather than blurred-then-sharp. Nothing here draws: an Image() whose src is
// set performs the fetch and the response lands in the cache, and eveRenderHi's own load in the sheet
// then resolves out of it. Once per hull per session.
//
// Deliberately fire-and-forget. Offline this fails silently and costs nothing that matters — the sheet
// still has the bundled render, which is the whole reason it is safe to prefer the network there at
// all. Do not add error handling that makes a plane look like a failure state.
const _heroPrefetched = new Set();
const prefetchRenderHi = (typeID) => {
  if (!typeID || _heroPrefetched.has(typeID)) return;
  _heroPrefetched.add(typeID);
  const img = new Image();
  img.src = eveRenderHi(typeID);
};

const hasLocalArt = () => Object.keys(_iconByID).length > 0;

export { eveIcon, eveHeroRender, eveRender, eveRenderHi, hasLocalArt, prefetchRenderHi };
