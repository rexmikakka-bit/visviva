import TYPE_ICONS from "../data/type-icons.json";

// ── Icons & renders ─────────────────────────────────────────────────────────────
// These are BUNDLED from src/assets/, not fetched. The shipped app has to work offline, so the art
// must be part of the build. Populate the folders with `node scripts/bundle-icons.mjs` (reads a pyfa
// checkout) and commit them; the app then needs no network for images.
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
// (drones, fighters, deployables). Keyed by typeID rather than iconID — see bundle-icons.mjs.
const _TYPE_ICON_FILES = import.meta.glob("../assets/type-icons/*.png", { eager: true, query: "?url", import: "default" });

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

const hasLocalArt = () => Object.keys(_iconByID).length > 0;

export { eveIcon, eveRender, hasLocalArt };
