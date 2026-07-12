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
const _ICON_FILES   = import.meta.glob("../assets/icons/*.png",   { eager: true, query: "?url", import: "default" });
const _RENDER_FILES = import.meta.glob("../assets/renders/*.png", { eager: true, query: "?url", import: "default" });

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

const eveIcon = (typeID, size = 32) => {
  if (!typeID) return null;
  const iid = TYPE_ICONS[typeID];
  if (iid != null && _iconByID[iid]) return _iconByID[iid];                 // bundled (offline)
  return `https://images.evetech.net/types/${typeID}/icon?size=${size}`;    // fallback (online only)
};

const eveRender = (typeID, size = 64) => {
  if (!typeID) return null;
  if (_renderByType[typeID]) return _renderByType[typeID];                  // bundled (offline)
  return `https://images.evetech.net/types/${typeID}/render?size=${size}`;  // fallback (online only)
};

const hasLocalArt = () => Object.keys(_iconByID).length > 0;

export { eveIcon, eveRender, hasLocalArt };
