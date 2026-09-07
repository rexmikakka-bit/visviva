import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { C } from "../theme.js";
import { isBackupApp, KEY_RE, countFits, buildBackup, mergeFitsDB } from "../lib/backup-io.js";
import { mergeTagColors } from "../lib/fit-tags.js";
import { FITS_KEY, exportFitsBlob, getLoadedFitsDB, replaceFitsDB, isFallbackMode,
         saveUndoSnapshot, readUndoMeta, restoreUndoSnapshot } from "../lib/fits-store.js";
import { parsePyfaXml, convertFitting } from "../lib/pyfa-xml.js";
import { t } from "../lib/i18n.js";

// Almost every sentence in this panel counts something and BOLDS the count. Splitting the JSX into
// fragments either side of each number would hand the translator English clause order and nothing
// else, so the sentence stays one key and its {placeholders} become <b> spans here — t() leaves a
// placeholder it was given no value for verbatim, which is what lets this find them afterwards.
//
// So a counting key names its number something readable (`{fits}`) and is passed `n` SEPARATELY, as
// the plural selector only. `{n}` as the visible token would be substituted by t() before this ran.
// Two counts in one sentence get one key each and are composed by a third: English picks a plural
// form per noun, and only one form can be selected per key.
const boldFill = (text, values, style) =>
  text.split(/(\{[a-zA-Z]+\})/).map((part, i) => {
    const k = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
    return k && k in values ? <b key={i} style={style}>{values[k]}</b> : part;
  });

// How many fittings to convert between yields to the event loop. A full pyfa library is ~1,700 fits
// and converts in well under a second, but on a phone that is still long enough to drop the progress
// bar if it is done in one go.
const XML_CHUNK = 100;

// ── Backup & restore ────────────────────────────────────────────────────────────
// Fits live in this browser's storage and NOWHERE else. No git commit protects them; clearing site
// data, switching browsers, or loading the app from a different port (storage is scoped per origin —
// :5173 and :4173 are different drawers) all lose everything. This makes them a file you can keep.
//
// Settings are localStorage; the fit library is IndexedDB (fits-store.js). Both go into one file
// under the same keys as before, so the format did not change when the fits moved.
//
// Everything under the `pyfa-*` / `pyfa_*` keys is included, so it survives new settings being added
// later without anyone remembering to update this list.

function BackupPanel() {
  const [status, setStatus] = useState(null);       // {ok, msg}
  const [pending, setPending] = useState(null);     // parsed backup awaiting merge/replace choice
  const [pasted, setPasted] = useState("");
  const fileRef = useRef(null);
  const [xmlPending, setXmlPending] = useState(null);   // converted pyfa library awaiting confirmation
  const [xmlBusy, setXmlBusy] = useState(null);         // {done, total} while converting
  const xmlRef = useRef(null);
  const [undo, setUndo] = useState(null);   // meta for the pre-import copy, or null if there isn't one
  const [busy, setBusy] = useState(null);   // label of the bulk write in flight, or null

  const mine = countFits(getLoadedFitsDB());

  useEffect(() => { readUndoMeta().then(setUndo).catch(() => {}); }, []);

  // Every bulk write below ends in a reload, and the work in front of it — merging ~1,700 fits,
  // JSON round-tripping several megabytes — is synchronous and blocks the main thread. Unwrapped
  // that is a frozen panel followed by a blank page, both with no explanation, which on a phone is
  // long enough to read as a crash. So: paint an overlay, wait for it to actually REACH the screen
  // before starting (the double rAF — React's commit lands in a microtask, the first frame paints
  // it, the second callback runs after that paint), then hand over to index.html's boot screen,
  // which covers the reload itself.
  const runBulk = async (label, work) => {
    setBusy(label);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { await work(); } catch (e) { setBusy(null); throw e; }
    // Reloading is the honest way to re-init every piece of state from storage at once. The overlay
    // is deliberately left up: it is the last thing on screen until the page goes away.
    window.location.reload();
  };

  // iOS is the case this has to get right. A WKWebView ignores <a download>, so `a.click()` on a
  // blob: URL silently does nothing — and this used to report ok:true straight afterwards, so the
  // app claimed "Exported N fits" while producing no file at all. That false success is what made
  // it look like backup was broken rather than merely unavailable.
  //
  // The share sheet is the route that actually works inside a webview, and it is a plain web API
  // (navigator.share with a File), so it needs no extra Capacitor plugin and no native rebuild.
  // Order: share sheet -> anchor download (desktop web) -> tell the truth and point at Copy.
  const download = async () => {
    const json = buildBackup(await exportFitsBlob());
    const name = `axis-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const okMsg = t({ one: "Exported {n} fit.", other: "Exported {n} fits." }, { n: mine.fits });

    try {
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t("Axis backup") });
        setStatus({ ok: true, msg: okMsg });
        return;
      }
    } catch (e) {
      // A user dismissing the share sheet throws AbortError — that is a cancel, not a failure,
      // and must not fall through to a second attempt.
      if (e?.name === "AbortError") { setStatus(null); return; }
    }

    // `download` is only honoured where the attribute is actually supported; checking for it is
    // what stops the silent no-op above.
    const a = document.createElement("a");
    if (typeof a.download === "string" && !window.Capacitor?.isNativePlatform?.()) {
      try {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus({ ok: true, msg: okMsg });
        return;
      } catch (e) {
        setStatus({ ok: false, msg: t("Export failed: {err}", { err: e.message }) });
        return;
      }
    }
    setStatus({ ok: false, msg: t("This device can't save files from the app — use Copy JSON instead.") });
  };

  // Blob downloads are unreliable inside a native webview, so always offer the clipboard too.
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(buildBackup(await exportFitsBlob()));
      setStatus({ ok: true, msg: t("Backup JSON copied to clipboard.") });
    } catch {
      setStatus({ ok: false, msg: t("Couldn't copy — use Download instead.") });
    }
  };

  const parseBackup = (text) => {
    let obj;
    try { obj = JSON.parse(text); }
    catch { setStatus({ ok: false, msg: t("That isn't valid JSON.") }); return; }
    if (!isBackupApp(obj?.app) || !obj?.data) {
      setStatus({ ok: false, msg: t("Not an Axis backup file.") });
      return;
    }
    const c = countFits(obj.data["pyfa-fitsdb"]);
    setPending({ obj, count: c });
    setStatus(null);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => parseBackup(String(r.result));
    r.onerror = () => setStatus({ ok: false, msg: t("Couldn't read that file.") });
    r.readAsText(f);
    e.target.value = "";
  };

  // The fit library is written through the store, never as a localStorage key — writing the backup's
  // `pyfa-fitsdb` string straight back would leave a stale blob that nothing reads and that the next
  // export would not agree with.
  const apply = async (mode) => {
    const { obj } = pending;
    try {
      await runBulk(mode === "replace" ? t("Restoring backup…") : t("Merging backup…"), async () => {
        await saveUndoSnapshot(mode === "replace" ? "backup restore" : "backup merge");
        if (mode === "replace") {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (KEY_RE.test(k)) localStorage.removeItem(k);
          }
          for (const [k, v] of Object.entries(obj.data)) if (k !== FITS_KEY) localStorage.setItem(k, v);
          let db = {};
          try { db = JSON.parse(obj.data[FITS_KEY] || "{}") || {}; } catch {}
          await replaceFitsDB(db);
        } else {
          const merged = mergeFitsDB(await exportFitsBlob(), obj.data[FITS_KEY]);
          await replaceFitsDB(JSON.parse(merged));
          // Tag colours merge per-tag rather than all-or-nothing. The blanket rule below would drop
          // the whole incoming registry the moment you had a single tag of your own, and the
          // imported fits would arrive carrying tag names with no colours.
          try {
            const cur = JSON.parse(localStorage.getItem("pyfa-tagcolors") || "{}") || {};
            const inc = JSON.parse(obj.data["pyfa-tagcolors"] || "{}") || {};
            localStorage.setItem("pyfa-tagcolors", JSON.stringify(mergeTagColors(cur, inc)));
          } catch {}
          // Only fill in settings that don't exist yet — a merge shouldn't overwrite your skills.
          for (const [k, v] of Object.entries(obj.data)) {
            if (k !== FITS_KEY && k !== "pyfa-tagcolors" && localStorage.getItem(k) == null) localStorage.setItem(k, v);
          }
        }
      });
    } catch (e) {
      setStatus({ ok: false, msg: t("Import failed: {err}", { err: e.message }) });
      setPending(null);
    }
  };

  // ── pyfa XML ────────────────────────────────────────────────────────────────────────────────
  // A different file from an Axis backup and a different job: a one-way import of someone's whole
  // pyfa library. It shares this panel because "the place my fits come in and out of" is one idea,
  // and a second screen for it would be a second place to look.
  const onXmlFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onerror = () => setStatus({ ok: false, msg: t("Couldn't read that file.") });
    r.onload = () => convertXml(String(r.result));
    r.readAsText(f);
  };

  const convertXml = async (text) => {
    setStatus(null); setXmlPending(null);
    const { fittings, error } = parsePyfaXml(text);
    if (error) { setStatus({ ok: false, msg: error }); return; }

    const db = {};
    const unresolved = new Set();
    let reloaded = 0, skipped = 0;
    setXmlBusy({ done: 0, total: fittings.length });
    for (let i = 0; i < fittings.length; i += XML_CHUNK) {
      for (const raw of fittings.slice(i, i + XML_CHUNK)) {
        const c = convertFitting(raw);
        if (c.error) { skipped++; continue; }
        (db[c.ship] ??= []).push(c.entry);
        reloaded += c.chargesReloaded;
        for (const n of c.unresolved) unresolved.add(n);
      }
      setXmlBusy({ done: Math.min(i + XML_CHUNK, fittings.length), total: fittings.length });
      await new Promise((r) => setTimeout(r, 0));   // let the progress bar actually paint
    }
    setXmlBusy(null);

    const fits = Object.values(db).reduce((n, a) => n + a.length, 0);
    if (!fits) { setStatus({ ok: false, msg: t("Nothing importable in that file.") }); return; }
    setXmlPending({ db, fits, ships: Object.keys(db).length, reloaded, skipped,
                    unresolved: [...unresolved].sort() });
  };

  // Merge only, never replace. mergeFitsDB already suffixes a same-name fit and reallocates every id
  // DB-wide — and it builds its name set AS IT GOES, so the duplicate (ship, name) pairs that exist
  // inside a single pyfa export are separated too rather than collapsing onto one another.
  const applyXml = async () => {
    try {
      await runBulk(t({ one: "Importing {fits} fit…", other: "Importing {fits} fits…" },
                      { n: xmlPending.fits, fits: xmlPending.fits.toLocaleString() }), async () => {
        await saveUndoSnapshot("pyfa import");
        const merged = mergeFitsDB(await exportFitsBlob(), JSON.stringify(xmlPending.db));
        await replaceFitsDB(JSON.parse(merged));
      });
    } catch (e) {
      setStatus({ ok: false, msg: t("Import failed: {err}", { err: e.message }) });
      setXmlPending(null);
    }
  };

  // ── Clear / undo ────────────────────────────────────────────────────────────────────────────
  // The snapshot is taken before the wipe like any other bulk write, so "clear everything" is itself
  // reversible — which is what makes offering it at all reasonable.
  const clearLibrary = async () => {
    const undoable = !isFallbackMode();
    const warn = t({ one: "Delete all {fits} fit?", other: "Delete all {fits} fits?" },
                   { n: mine.fits, fits: mine.fits.toLocaleString() })
      + `\n\n${t("Your skills, settings and tag colours are kept.")}\n`
      + (undoable ? t("You can undo this from here until the next import or reset.")
                  : t("This device can't store an undo copy, so this CANNOT be undone. Export a backup first."));
    if (!window.confirm(warn)) return;
    try {
      await runBulk(t("Clearing library…"), async () => {
        await saveUndoSnapshot("clear library");
        await replaceFitsDB({});
      });
    } catch (e) { setStatus({ ok: false, msg: t("Couldn't clear: {err}", { err: e.message }) }); }
  };

  const doUndo = async () => {
    try {
      await runBulk(t("Restoring your fits…"), async () => {
        if (!(await restoreUndoSnapshot())) {
          setUndo(null);
          throw new Error(t("That undo copy is no longer available."));
        }
      });
    } catch (e) { setStatus({ ok: false, msg: e.message }); }
  };

  // The snapshot's label was written to IndexedDB by whichever operation took it, so it is stored in
  // English and translated here — translating at save time would freeze an undo copy in whatever
  // language it was taken in. One literal key per label, never t(undo.label): a computed key is
  // invisible to the catalog audit, which would then report every translation of one as an orphan.
  const undoLabel = (l) => ({
    "backup restore": t("backup restore"),
    "backup merge": t("backup merge"),
    "pyfa import": t("pyfa import"),
    "clear library": t("clear library"),
  }[l] ?? t("last change"));

  const btn = (bg, border, color) => ({
    padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: bg, border: `1px solid ${border}`, color,
  });

  return (
    <div>
      {/* Covers the whole viewport, not just this panel: the work behind it replaces the entire
          library, so leaving the rest of the app tappable would invite a second write on top of the
          one in flight. PORTALLED to <body> because this panel lives inside the settings sheet,
          which always carries a transform — and a transformed ancestor becomes the containing block
          for position:fixed, which would trap the overlay inside the sheet's own (overflow:hidden)
          box. Same ring, size and colours as index.html's boot screen: the reload swaps one for the
          other mid-operation and the join should be invisible. */}
      {busy && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 14, background: C.bg }}>
          <span className="vv-spin" style={{ width: 30, height: 30, borderRadius: "50%",
                                             border: `3px solid ${C.border}`, borderTopColor: C.accent }} />
          <div style={{ fontSize: 12, color: C.textMid }}>{busy}</div>
          <div style={{ fontSize: 10, color: C.textMute }}>{t("Don't close the app.")}</div>
        </div>, document.body)}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>{t("Backup & Restore")}</div>
      <div style={{ fontSize: 11, color: C.textMute, marginBottom: 12, lineHeight: 1.5 }}>
        {t("Your fits live only in this browser's storage. Clearing site data, switching browsers, or opening the app on a different port will lose them. Export a file to keep them safe or move them to another device.")}
      </div>

      <div style={{ padding: "10px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    borderRadius: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textMid }}>
          {boldFill(
            t("{fitCount} across {shipCount} stored here.", {
              fitCount: t({ one: "{fits} fit", other: "{fits} fits" }, { n: mine.fits }),
              shipCount: t({ one: "{ships} ship", other: "{ships} ships" }, { n: mine.ships }),
            }),
            { fits: mine.fits, ships: mine.ships }, { color: C.text })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={download} style={btn(C.accent, C.accent, "#0e0e10")}>{t("Download backup")}</button>
        <button onClick={copyJson} style={btn(C.surface, C.border, C.textMid)}>{t("Copy as JSON")}</button>
      </div>

      <div style={{ height: 1, background: C.border, margin: "4px 0 16px" }} />

      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>{t("Restore")}</div>

      {!pending && (
        <>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile}
                 style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...btn(C.surface, C.border, C.textMid), marginBottom: 10 }}>
            {t("Choose backup file…")}
          </button>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 6 }}>{t("…or paste the JSON:")}</div>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder='{"app":"axis",...}'
            style={{ width: "100%", boxSizing: "border-box", minHeight: 70, padding: 8, borderRadius: 8,
                     fontSize: 11, fontFamily: "monospace", background: C.surface, border: `1px solid ${C.border}`,
                     color: C.text, resize: "vertical" }}
          />
          <button onClick={() => parseBackup(pasted)} disabled={!pasted.trim()}
                  style={{ ...btn(C.surface, C.border, C.textMid), marginTop: 8,
                           opacity: pasted.trim() ? 1 : 0.4 }}>
            {t("Load pasted backup")}
          </button>
        </>
      )}

      {pending && (
        <div style={{ padding: "12px 14px", background: C.surfaceAlt,
                      border: `1px solid ${C.accentBorder ?? C.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: C.text, marginBottom: 4 }}>
            {boldFill(
              t("Backup contains {fitCount} across {shipCount}.", {
                fitCount: t({ one: "{fits} fit", other: "{fits} fits" }, { n: pending.count.fits }),
                shipCount: t({ one: "{ships} ship", other: "{ships} ships" }, { n: pending.count.ships }),
              }),
              { fits: pending.count.fits, ships: pending.count.ships })}
          </div>
          {pending.obj.exportedAt && (
            <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10 }}>
              {t("Exported {when}", { when: new Date(pending.obj.exportedAt).toLocaleString() })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => apply("merge")} style={btn(C.accent, C.accent, "#0e0e10")}>
              {t("Merge (keep mine)")}
            </button>
            <button
              onClick={() => { if (window.confirm(t({ one: "Replace ALL {n} local fit and your settings with this backup? This cannot be undone.", other: "Replace ALL {n} local fits and your settings with this backup? This cannot be undone." }, { n: mine.fits }))) apply("replace"); }}
              style={btn(C.surface, C.danger, C.danger)}>
              {t("Replace everything")}
            </button>
            <button onClick={() => { setPending(null); setPasted(""); }} style={btn(C.surface, C.border, C.textMute)}>
              {t("Cancel")}
            </button>
          </div>
          <div style={{ fontSize: 10, color: C.textMute, marginTop: 8, lineHeight: 1.5 }}>
            {/* The two bolded words name the buttons above, so they ride in as placeholders rather
                than being spelled out in the sentence — they have to keep matching the buttons, and
                a translator needs them wherever their clause order puts them. */}
            {boldFill(
              t("{merge} adds the imported fits alongside yours (duplicates get renamed, your skills and settings are untouched). {replace} wipes everything here first."),
              { merge: t("Merge"), replace: t("Replace") })}
          </div>
        </div>
      )}

      {!pending && (
        <>
          <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{t("Import from pyfa")}</div>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
            {/* pyfa's own menu path is quoted verbatim and stays English: the reader is looking for
                it in pyfa's window, which has no translation to match. */}
            {boldFill(
              t("In pyfa, use {menu} to write an XML file, then choose it here. Your existing fits are kept — imported ones are added alongside them."),
              { menu: "File → Backup All Fittings" })}
          </div>

          <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" onChange={onXmlFile}
                 style={{ display: "none" }} />
          {!xmlPending && !xmlBusy && (
            <button onClick={() => xmlRef.current?.click()} style={btn(C.surface, C.border, C.textMid)}>
              {t("Choose pyfa XML file…")}
            </button>
          )}

          {xmlBusy && (
            <div>
              <div style={{ fontSize: 11, color: C.textMid, marginBottom: 6 }}>
                {t("Converting {done} / {total} fits…", { done: xmlBusy.done.toLocaleString(), total: xmlBusy.total.toLocaleString() })}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: C.surfaceAlt, overflow: "hidden" }}>
                <div style={{ height: "100%", background: C.accent,
                              width: `${xmlBusy.total ? (xmlBusy.done / xmlBusy.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {xmlPending && (
            <div style={{ padding: "12px 14px", background: C.surfaceAlt,
                          border: `1px solid ${C.accentBorder ?? C.border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>
                {boldFill(
                  t("Ready to import {fitCount} across {shipCount}.", {
                    fitCount: t({ one: "{fits} fit", other: "{fits} fits" }, { n: xmlPending.fits }),
                    shipCount: t({ one: "{ships} ship", other: "{ships} ships" }, { n: xmlPending.ships }),
                  }),
                  { fits: xmlPending.fits.toLocaleString(), ships: xmlPending.ships.toLocaleString() })}
              </div>
              <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.6 }}>
                {boldFill(
                  t("A pyfa XML backup doesn't record implants, boosters, or which module each charge was loaded into — it lists all ammo together in the cargo hold. Ammo was put back into {modCount}; anything left over stays in cargo.", {
                    modCount: t({ one: "{mods} module", other: "{mods} modules" }, { n: xmlPending.reloaded }),
                  }),
                  { mods: xmlPending.reloaded.toLocaleString() })}
                {xmlPending.skipped > 0 && <> {t({ one: "{n} fitting couldn't be read and was skipped.", other: "{n} fittings couldn't be read and were skipped." }, { n: xmlPending.skipped })}</>}
                {xmlPending.unresolved.length > 0 && <> {t({ one: "{n} item name wasn't recognised (e.g. {names}) and was left out.", other: "{n} item names weren't recognised (e.g. {names}) and were left out." }, { n: xmlPending.unresolved.length, names: xmlPending.unresolved.slice(0, 3).join(", ") })}</>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={applyXml} style={btn(C.accent, C.accent, "#0e0e10")}>
                  {t({ one: "Add {fits} fit", other: "Add {fits} fits" }, { n: xmlPending.fits, fits: xmlPending.fits.toLocaleString() })}
                </button>
                <button onClick={() => setXmlPending(null)} style={btn(C.surface, C.border, C.textMute)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}

          <div style={{ height: 1, background: C.border, margin: "16px 0" }} />

          {/* Undo sits above the destructive button on purpose: after a 1,700-fit import the first
              thing someone looks for is the way back, and finding it next to "Clear" makes the
              relationship between the two obvious. */}
          {undo && (
            <div style={{ padding: "12px 14px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                          borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.text, marginBottom: 4 }}>
                {boldFill(
                  t({ one: "Undo available — restores the {fits} fit you had before the {what}.",
                      other: "Undo available — restores the {fits} fits you had before the {what}." },
                    { n: undo.fits, what: undoLabel(undo.label) }),
                  { fits: undo.fits.toLocaleString() })}
              </div>
              {/* The copy holds fits and nothing else, so undoing a "Replace everything" restore puts
                  the fits back but leaves the settings that restore overwrote. Said plainly here
                  rather than letting the button imply it reverses the whole operation. */}
              <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
                {t("Taken {when}. Saved fits only — skills and settings aren't part of the copy. Replaced by the next import or reset.",
                   { when: undo.at ? new Date(undo.at).toLocaleString() : t("earlier") })}
              </div>
              <button onClick={doUndo} style={btn(C.surface, C.accent, C.accent)}>
                {t("Undo {what}", { what: undoLabel(undo.label) })}
              </button>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>{t("Clear fit library")}</div>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
            {t("Deletes every saved fit on this device. Skills, settings and tag colours are kept.")}
            {!isFallbackMode() && ` ${t("A copy is kept so you can undo it.")}`}
          </div>
          <button onClick={clearLibrary} disabled={mine.fits === 0}
                  style={{ ...btn(C.surface, C.danger, C.danger), opacity: mine.fits === 0 ? 0.4 : 1 }}>
            {t({ one: "Delete all {fits} fit", other: "Delete all {fits} fits" }, { n: mine.fits, fits: mine.fits.toLocaleString() })}
          </button>
        </>
      )}

      {status && (
        <div style={{ marginTop: 12, fontSize: 11, color: status.ok ? C.accent : C.danger }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

export { BackupPanel };
