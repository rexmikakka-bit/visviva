// Ordering for the flat "pick a fit" lists — the target-fit, projection and command-ship pickers,
// which flatten every hull's fits into one list where `fitsDB`'s key order means nothing to a user.
//
// Pure and DOM-free so the regression suite can exercise it in Node.

// `fit.modified` is a DISPLAY STRING ("Aug 6, 2026"), written by App.jsx with an explicitly en-US
// `toLocaleDateString`. Two consequences, and the sort has to survive both:
//
//   • It is DAY-GRANULAR. Everything edited today ties, so a comparator built on this alone leaves
//     today's fits in `fitsDB` key order — which is the arbitrary order the sort exists to replace.
//     `byRecentlyModified` breaks ties by name so the list is at least stable and scannable.
//   • It is not guaranteed to parse. A fit restored from an old backup, or one predating the field,
//     has no usable date; those sort to the BOTTOM rather than to 1970-adjacent nonsense at the top.
//
// A monotonic timestamp would be better and is deliberately not being introduced here: it would
// change the saved-fit shape, which means a storage migration, for a browsing aid.
export function modifiedTime(fit) {
  const t = Date.parse(fit?.modified ?? "");
  return Number.isNaN(t) ? -Infinity : t;
}

/** Most recently modified first; same-day ties fall back to fit name, then hull. */
export function byRecentlyModified(a, b) {
  const d = modifiedTime(b.fit) - modifiedTime(a.fit);
  if (d) return d;
  return String(a.fit?.name ?? "").localeCompare(String(b.fit?.name ?? ""))
      || String(a.ship ?? "").localeCompare(String(b.ship ?? ""));
}

// ESI's saved-fitting payload carries NO timestamp — CCP's schema is exactly
// {description, fitting_id, items, name, ship_type_id}. `fitting_id` is the only recency signal
// there is, and it is a good one: it is assigned server-side on save and ascends, and EVE has no
// edit-in-place for a saved fitting (changing one deletes it and saves a new one, taking a new id).
// So highest id first really is "most recently saved first".
export function byNewestFitting(a, b) {
  return (b?.fitting_id ?? 0) - (a?.fitting_id ?? 0);
}
