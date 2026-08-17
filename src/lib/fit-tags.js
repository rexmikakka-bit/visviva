// Tags are the fit browser's SECOND axis. `fitsDB` is keyed by hull name, so a doctrine spanning
// four hulls is four separate navigations with no view that shows it whole — a tag cuts across that.
//
// A fit stores tag NAMES, and colours live in a separate registry keyed by tag. Same reasoning as
// `slots.environment` storing a name rather than an id: a name survives a lost or rebuilt registry,
// and a tag with no registry entry falls back to a deterministic palette colour instead of becoming
// a ghost reference. The cost is that renaming has to walk the DB, which is nothing at these volumes.
//
// Pure and DOM-free so the regression suite can exercise it in Node.

// A new tag is auto-assigned a colour from this palette by hash, so creating one never blocks on a
// colour decision. Recolouring is an explicit later edit.
export const TAG_PALETTE = ["#4f8ef7", "#34d399", "#f59e0b", "#ef4444", "#a78bfa", "#22d3ee", "#ec4899", "#84cc16"];

export const MAX_TAG_LEN = 24;

// Display form: trimmed, internal whitespace collapsed, length-capped.
export function normalizeTag(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LEN);
}

// Identity form. Tags match case-INSENSITIVELY — "flykiller" and "Flykiller" are one tag — while the
// spelling that was entered first is the one displayed.
export function tagKey(name) {
  return normalizeTag(name).toLowerCase();
}

// Every tag on a fit, normalized and de-duplicated. Total by design: a fit predating tags, or one
// whose `tags` was hand-edited into something that isn't an array, reads as untagged rather than
// throwing on render.
export function tagsOf(fit) {
  const out = [], seen = new Set();
  for (const t of (Array.isArray(fit?.tags) ? fit.tags : [])) {
    const n = normalizeTag(t), k = tagKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

export function hasTag(fit, name) {
  const k = tagKey(name);
  return !!k && tagsOf(fit).some((t) => tagKey(t) === k);
}

// Tag edits deliberately do NOT touch `modified`. That field means "the fit was edited", and filing
// a fit under a doctrine is not a change to the fit.
export function withTag(fit, name) {
  const n = normalizeTag(name);
  if (!n || hasTag(fit, n)) return fit;
  return { ...fit, tags: [...tagsOf(fit), n] };
}

export function withoutTag(fit, name) {
  const k = tagKey(name);
  if (!k) return fit;
  return { ...fit, tags: tagsOf(fit).filter((t) => tagKey(t) !== k) };
}

export function toggleTag(fit, name) {
  return hasTag(fit, name) ? withoutTag(fit, name) : withTag(fit, name);
}

// Every tag in use, with how many fits carry it. Sorted alphabetically rather than by count: this
// list is navigation, and a list that reorders itself as you tag defeats muscle memory.
export function allTags(fitsDB) {
  const by = new Map();
  for (const fits of Object.values(fitsDB ?? {})) {
    if (!Array.isArray(fits)) continue;
    for (const f of fits) {
      for (const t of tagsOf(f)) {
        const k = tagKey(t);
        const cur = by.get(k);
        if (cur) cur.count++;
        else by.set(k, { key: k, name: t, count: 1 });
      }
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The cross-hull view the whole feature exists for.
export function fitsWithTag(fitsDB, name) {
  const k = tagKey(name);
  if (!k) return [];
  const out = [];
  for (const [ship, fits] of Object.entries(fitsDB ?? {})) {
    if (!Array.isArray(fits)) continue;
    for (const f of fits) if (hasTag(f, k)) out.push({ ship, fit: f });
  }
  return out.sort((a, b) => a.ship.localeCompare(b.ship) || String(a.fit?.name).localeCompare(String(b.fit?.name)));
}

function hashKey(k) {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// A registry MISS is normal, not an error — see the header. An entry that isn't a plain hex colour
// is treated as a miss too, so a corrupt registry degrades to the palette instead of emitting
// garbage into a `style`.
export function colorForTag(name, colors) {
  const k = tagKey(name);
  const set = colors?.[k];
  if (typeof set === "string" && /^#[0-9a-f]{6}$/i.test(set)) return set;
  return TAG_PALETTE[hashKey(k) % TAG_PALETTE.length];
}

export function setTagColor(colors, name, color) {
  const k = tagKey(name);
  if (!k) return colors ?? {};
  return { ...(colors ?? {}), [k]: color };
}

// Rename across every fit. Renaming ONTO an existing tag merges into it, which `tagsOf`'s de-dup
// handles for free — a fit carrying both ends up with one.
export function renameTag(fitsDB, from, to) {
  const fromK = tagKey(from), n = normalizeTag(to);
  if (!fromK || !n) return fitsDB ?? {};
  const out = {};
  for (const [ship, fits] of Object.entries(fitsDB ?? {})) {
    out[ship] = Array.isArray(fits)
      ? fits.map((f) => (hasTag(f, fromK) ? { ...f, tags: tagsOf({ ...f, tags: tagsOf(f).map((t) => (tagKey(t) === fromK ? n : t)) }) } : f))
      : fits;
  }
  return out;
}

export function removeTagEverywhere(fitsDB, name) {
  const k = tagKey(name);
  if (!k) return fitsDB ?? {};
  const out = {};
  for (const [ship, fits] of Object.entries(fitsDB ?? {})) {
    out[ship] = Array.isArray(fits) ? fits.map((f) => (hasTag(f, k) ? withoutTag(f, k) : f)) : fits;
  }
  return out;
}

// Restoring a backup by MERGE fills in colours it doesn't already have, rather than repainting tags
// the user has since recoloured. Tag names ride along on the fits themselves, so a colour that
// doesn't make it across costs nothing — the tag still appears, in its palette colour.
export function mergeTagColors(current, incoming) {
  const out = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(incoming ?? {})) if (!(k in out)) out[k] = v;
  return out;
}
