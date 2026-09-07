// User-facing text, app-wide.
//
// THE KEY IS THE ENGLISH STRING. `t("Fit Tabs")` returns "Fit Tabs" under English with no catalog
// involved, and looks that string up as a key under any other locale. Invented keys (`settings.tabs
// .title`) were the alternative and were rejected: they need a second file to be readable, an
// English catalog that can go missing — which renders the raw key to the user — and a naming
// argument at every call site. Here English is the source of truth by construction, a missing
// translation degrades to English rather than to gibberish, and a reviewer can read the call site.
//
// The cost is that EDITING AN ENGLISH STRING SILENTLY ORPHANS ITS TRANSLATIONS: the old key stops
// matching and every locale falls back to the new English. That is the failure this design accepts,
// and `npm run check`'s catalog audit is what surfaces it — see scripts/check-i18n.mjs.
//
// ⚠ CALL t() AT RENDER TIME, NEVER AT MODULE SCOPE. Module bodies run when App.jsx is imported,
// which is before main.jsx has resolved the stored locale — a `const PRESETS=[{label:t("Alpha")}]`
// therefore bakes in English permanently and never re-evaluates on a switch. Keep the English string
// in the constant and translate where it is rendered: `{t(p.label)}`.
//
// Item names (ships, modules, charges, skills) are deliberately NOT translated. They come from the
// dogma bundle, EFT import/export is a universal English format, and lib/jargon.js builds its search
// index on English names — pyfa makes the same call.

// EVE's own client languages, and only those: CCP publishes canonical in-game terms for the jargon
// this app is made of (capacitor, powergrid, signature radius, stacking penalty), so a translation
// here can match what the player reads in the fitting window rather than inventing a second
// vocabulary. Right-to-left languages are absent on purpose — the UI is inline-styled with explicit
// left/right, padding and transform values throughout, so RTL is layout work, not a catalog.
export const LOCALES = [
  { code: 'en', native: 'English',  english: 'English' },
  { code: 'de', native: 'Deutsch',  english: 'German' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'es', native: 'Español',  english: 'Spanish' },
  { code: 'ru', native: 'Русский',  english: 'Russian' },
  { code: 'ja', native: '日本語',    english: 'Japanese' },
  { code: 'ko', native: '한국어',     english: 'Korean' },
  { code: 'zh', native: '简体中文',   english: 'Simplified Chinese' },
];
export const LOCALE_KEY = 'axis_locale';
const CODES = new Set(LOCALES.map(l => l.code));

// What has actually SHIPPED, as opposed to LOCALES above, which is the target set. A language
// arrives by adding its catalog under src/i18n/ and one line here; the settings list is derived from
// this map, so a half-finished catalog cannot be picked before its commit lands.
//
// Static rather than an import glob, so the bundler names each chunk and a typo is a build error.
const LOADERS = {
  de: () => import('../i18n/de.js'),
  fr: () => import('../i18n/fr.js'),
};

const catalogs = { en: {} };   // en is empty and stays empty: its keys already ARE its values
let _locale = 'en';
let _cat = catalogs.en;
let _plurals = null;           // built lazily; only non-English plural keys need it

export function getLocale() { return _locale; }
export function registerCatalog(code, catalog) { if (CODES.has(code) && catalog) catalogs[code] = catalog; }
/** The locales Settings may offer: English plus whatever has a catalog to load. */
export function availableLocales() { return LOCALES.filter(l => l.code === 'en' || LOADERS[l.code]); }

/** Downloads a locale's catalog. Safe to call for 'en' or for an already-loaded locale. */
export async function loadLocale(code) {
  if (!CODES.has(code) || catalogs[code]) return;
  try {
    const mod = await LOADERS[code]?.();
    registerCatalog(code, mod?.default);
  } catch (e) { /* a chunk that won't load leaves the locale English, which is a working app */ }
}

/**
 * Switches locale for every subsequent t(). Synchronous and takes effect on the next READ, so pair
 * it with a re-render exactly as theme.js's setTheme is paired — App.jsx calls both in its render
 * body. A locale whose catalog has not loaded yet stays English rather than half-translating.
 */
export function applyLocale(code) {
  const next = CODES.has(code) && catalogs[code] ? code : 'en';
  if (next === _locale) return;
  _locale = next;
  _cat = catalogs[next];
  _plurals = null;
}

/**
 * Resolves the stored preference and loads its catalog. Called by main.jsx BEFORE React mounts, so
 * a Russian user's first paint is Russian rather than a frame of English that then flips.
 * @returns the locale that is now ready — 'en' if there is no pref, or if its catalog failed
 */
export async function initLocale() {
  let pref = 'en';
  try { pref = localStorage.getItem(LOCALE_KEY) ?? 'en'; } catch { /* private mode */ }
  if (!CODES.has(pref) || pref === 'en') return 'en';
  await loadLocale(pref);
  applyLocale(pref);
  return getLocale();
}

// {name} placeholders. Left alone when the param is missing, so a typo shows itself in the UI
// instead of silently rendering an empty gap.
function fill(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

function pluralForms(forms, n) {
  if (_locale === 'en') return (n === 1 ? forms.one : forms.other) ?? forms.other;
  try {
    _plurals ??= new Intl.PluralRules(_locale);
    return forms[_plurals.select(n)] ?? forms.other;
  } catch { return forms.other; }
}

/**
 * @param key    the English string, or {one,other} for something that counts. The `other` form is
 *               the catalog key in both cases, so a plural entry is found by one lookup either way.
 * @param params values for {placeholders}; `n` additionally selects the plural form
 *
 * Russian and Polish take four forms where English takes two, which is why the catalog is allowed to
 * answer with a form MAP rather than a string: the shape of the plural belongs to the target
 * language, not to English's idea of it.
 */
export function t(key, params) {
  const plural = key && typeof key === 'object';
  const lookup = plural ? key.other : key;
  if (typeof lookup !== 'string') return '';
  const hit = _cat[lookup];
  if (typeof hit === 'string') return fill(hit, params);
  if (hit && typeof hit === 'object') return fill(pluralForms(hit, params?.n ?? 0), params);
  return fill(plural ? pluralForms(key, params?.n ?? 0) : lookup, params);
}

/** Test seam — the suite installs catalogs directly rather than fetching chunks. */
export function _resetI18n() { for (const c of Object.keys(catalogs)) if (c !== 'en') delete catalogs[c]; applyLocale('en'); }
