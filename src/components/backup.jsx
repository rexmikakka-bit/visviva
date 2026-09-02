import { useState, useRef, useEffect } from "react";
import { C } from "../theme.js";
import { isBackupApp, KEY_RE, countFits, buildBackup, mergeFitsDB } from "../lib/backup-io.js";
import { mergeTagColors } from "../lib/fit-tags.js";
import { FITS_KEY, exportFitsBlob, getLoadedFitsDB, replaceFitsDB, isFallbackMode,
         saveUndoSnapshot, readUndoMeta, restoreUndoSnapshot } from "../lib/fits-store.js";
import { parsePyfaXml, convertFitting } from "../lib/pyfa-xml.js";

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

  const mine = countFits(getLoadedFitsDB());

  useEffect(() => { readUndoMeta().then(setUndo).catch(() => {}); }, []);

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
    const okMsg = `Exported ${mine.fits} fit${mine.fits === 1 ? "" : "s"}.`;

    try {
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Axis backup" });
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
        setStatus({ ok: false, msg: `Export failed: ${e.message}` });
        return;
      }
    }
    setStatus({ ok: false, msg: "This device can't save files from the app — use Copy JSON instead." });
  };

  // Blob downloads are unreliable inside a native webview, so always offer the clipboard too.
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(buildBackup(await exportFitsBlob()));
      setStatus({ ok: true, msg: "Backup JSON copied to clipboard." });
    } catch {
      setStatus({ ok: false, msg: "Couldn't copy — use Download instead." });
    }
  };

  const parseBackup = (text) => {
    let obj;
    try { obj = JSON.parse(text); }
    catch { setStatus({ ok: false, msg: "That isn't valid JSON." }); return; }
    if (!isBackupApp(obj?.app) || !obj?.data) {
      setStatus({ ok: false, msg: "Not an Axis backup file." });
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
    r.onerror = () => setStatus({ ok: false, msg: "Couldn't read that file." });
    r.readAsText(f);
    e.target.value = "";
  };

  // The fit library is written through the store, never as a localStorage key — writing the backup's
  // `pyfa-fitsdb` string straight back would leave a stale blob that nothing reads and that the next
  // export would not agree with.
  const apply = async (mode) => {
    const { obj } = pending;
    try {
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
        // Tag colours merge per-tag rather than all-or-nothing. The blanket rule below would drop the
        // whole incoming registry the moment you had a single tag of your own, and the imported fits
        // would arrive carrying tag names with no colours.
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
      // Reloading is the honest way to re-init every piece of state from storage at once.
      window.location.reload();
    } catch (e) {
      setStatus({ ok: false, msg: `Import failed: ${e.message}` });
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
    r.onerror = () => setStatus({ ok: false, msg: "Couldn't read that file." });
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
    if (!fits) { setStatus({ ok: false, msg: "Nothing importable in that file." }); return; }
    setXmlPending({ db, fits, ships: Object.keys(db).length, reloaded, skipped,
                    unresolved: [...unresolved].sort() });
  };

  // Merge only, never replace. mergeFitsDB already suffixes a same-name fit and reallocates every id
  // DB-wide — and it builds its name set AS IT GOES, so the duplicate (ship, name) pairs that exist
  // inside a single pyfa export are separated too rather than collapsing onto one another.
  const applyXml = async () => {
    try {
      await saveUndoSnapshot("pyfa import");
      const merged = mergeFitsDB(await exportFitsBlob(), JSON.stringify(xmlPending.db));
      await replaceFitsDB(JSON.parse(merged));
      window.location.reload();
    } catch (e) {
      setStatus({ ok: false, msg: `Import failed: ${e.message}` });
      setXmlPending(null);
    }
  };

  // ── Clear / undo ────────────────────────────────────────────────────────────────────────────
  // The snapshot is taken before the wipe like any other bulk write, so "clear everything" is itself
  // reversible — which is what makes offering it at all reasonable.
  const clearLibrary = async () => {
    const undoable = !isFallbackMode();
    const warn = `Delete all ${mine.fits.toLocaleString()} fit${mine.fits === 1 ? "" : "s"}?\n\n`
      + `Your skills, settings and tag colours are kept.\n`
      + (undoable ? `You can undo this from here until the next import or reset.`
                  : `This device can't store an undo copy, so this CANNOT be undone. Export a backup first.`);
    if (!window.confirm(warn)) return;
    try {
      await saveUndoSnapshot("clear library");
      await replaceFitsDB({});
      window.location.reload();
    } catch (e) { setStatus({ ok: false, msg: `Couldn't clear: ${e.message}` }); }
  };

  const doUndo = async () => {
    try {
      const r = await restoreUndoSnapshot();
      if (!r) { setStatus({ ok: false, msg: "That undo copy is no longer available." }); setUndo(null); return; }
      window.location.reload();
    } catch (e) { setStatus({ ok: false, msg: `Undo failed: ${e.message}` }); }
  };

  const btn = (bg, border, color) => ({
    padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: bg, border: `1px solid ${border}`, color,
  });

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>Backup &amp; Restore</div>
      <div style={{ fontSize: 11, color: C.textMute, marginBottom: 12, lineHeight: 1.5 }}>
        Your fits live only in this browser's storage. Clearing site data, switching browsers, or
        opening the app on a different port will lose them. Export a file to keep them safe or move
        them to another device.
      </div>

      <div style={{ padding: "10px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    borderRadius: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textMid }}>
          <b style={{ color: C.text }}>{mine.fits}</b> fit{mine.fits === 1 ? "" : "s"} across{" "}
          <b style={{ color: C.text }}>{mine.ships}</b> ship{mine.ships === 1 ? "" : "s"} stored here.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={download} style={btn(C.accent, C.accent, "#0e0e10")}>Download backup</button>
        <button onClick={copyJson} style={btn(C.surface, C.border, C.textMid)}>Copy as JSON</button>
      </div>

      <div style={{ height: 1, background: C.border, margin: "4px 0 16px" }} />

      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>Restore</div>

      {!pending && (
        <>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile}
                 style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...btn(C.surface, C.border, C.textMid), marginBottom: 10 }}>
            Choose backup file…
          </button>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 6 }}>…or paste the JSON:</div>
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
            Load pasted backup
          </button>
        </>
      )}

      {pending && (
        <div style={{ padding: "12px 14px", background: C.surfaceAlt,
                      border: `1px solid ${C.accentBorder ?? C.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: C.text, marginBottom: 4 }}>
            Backup contains <b>{pending.count.fits}</b> fit{pending.count.fits === 1 ? "" : "s"} across{" "}
            <b>{pending.count.ships}</b> ship{pending.count.ships === 1 ? "" : "s"}.
          </div>
          {pending.obj.exportedAt && (
            <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10 }}>
              Exported {new Date(pending.obj.exportedAt).toLocaleString()}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => apply("merge")} style={btn(C.accent, C.accent, "#0e0e10")}>
              Merge (keep mine)
            </button>
            <button
              onClick={() => { if (window.confirm(`Replace ALL ${mine.fits} local fit(s) and settings with this backup? This cannot be undone.`)) apply("replace"); }}
              style={btn(C.surface, C.danger, C.danger)}>
              Replace everything
            </button>
            <button onClick={() => { setPending(null); setPasted(""); }} style={btn(C.surface, C.border, C.textMute)}>
              Cancel
            </button>
          </div>
          <div style={{ fontSize: 10, color: C.textMute, marginTop: 8, lineHeight: 1.5 }}>
            <b>Merge</b> adds the imported fits alongside yours (duplicates get renamed, your skills
            and settings are untouched). <b>Replace</b> wipes everything here first.
          </div>
        </div>
      )}

      {!pending && (
        <>
          <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>Import from pyfa</div>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
            In pyfa, use <b>File &rarr; Backup All Fittings</b> to write an XML file, then choose it
            here. Your existing fits are kept — imported ones are added alongside them.
          </div>

          <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" onChange={onXmlFile}
                 style={{ display: "none" }} />
          {!xmlPending && !xmlBusy && (
            <button onClick={() => xmlRef.current?.click()} style={btn(C.surface, C.border, C.textMid)}>
              Choose pyfa XML file…
            </button>
          )}

          {xmlBusy && (
            <div>
              <div style={{ fontSize: 11, color: C.textMid, marginBottom: 6 }}>
                Converting {xmlBusy.done.toLocaleString()} / {xmlBusy.total.toLocaleString()} fits…
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
                Ready to import <b>{xmlPending.fits.toLocaleString()}</b> fit{xmlPending.fits === 1 ? "" : "s"} across{" "}
                <b>{xmlPending.ships.toLocaleString()}</b> ship{xmlPending.ships === 1 ? "" : "s"}.
              </div>
              <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.6 }}>
                A pyfa XML backup doesn't record implants, boosters, or which module each charge was
                loaded into — it lists all ammo together in the cargo hold. Ammo was put back into{" "}
                <b>{xmlPending.reloaded.toLocaleString()}</b> module{xmlPending.reloaded === 1 ? "" : "s"};
                anything left over stays in cargo.
                {xmlPending.skipped > 0 && <> {xmlPending.skipped} fitting{xmlPending.skipped === 1 ? "" : "s"} couldn't be read and {xmlPending.skipped === 1 ? "was" : "were"} skipped.</>}
                {xmlPending.unresolved.length > 0 && <> {xmlPending.unresolved.length} item name{xmlPending.unresolved.length === 1 ? "" : "s"} weren't recognised (e.g. {xmlPending.unresolved.slice(0, 3).join(", ")}) and were left out.</>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={applyXml} style={btn(C.accent, C.accent, "#0e0e10")}>
                  Add {xmlPending.fits.toLocaleString()} fit{xmlPending.fits === 1 ? "" : "s"}
                </button>
                <button onClick={() => setXmlPending(null)} style={btn(C.surface, C.border, C.textMute)}>
                  Cancel
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
                Undo available — restores the <b>{undo.fits.toLocaleString()}</b> fit{undo.fits === 1 ? "" : "s"}{" "}
                you had before the {undo.label ?? "last change"}.
              </div>
              {/* The copy holds fits and nothing else, so undoing a "Replace everything" restore puts
                  the fits back but leaves the settings that restore overwrote. Said plainly here
                  rather than letting the button imply it reverses the whole operation. */}
              <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
                Taken {undo.at ? new Date(undo.at).toLocaleString() : "earlier"}. Saved fits only —
                skills and settings aren't part of the copy. Replaced by the next import or reset.
              </div>
              <button onClick={doUndo} style={btn(C.surface, C.accent, C.accent)}>
                Undo {undo.label ?? "last change"}
              </button>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>Clear fit library</div>
          <div style={{ fontSize: 10, color: C.textMute, marginBottom: 10, lineHeight: 1.5 }}>
            Deletes every saved fit on this device. Skills, settings and tag colours are kept.
            {!isFallbackMode() && " A copy is kept so you can undo it."}
          </div>
          <button onClick={clearLibrary} disabled={mine.fits === 0}
                  style={{ ...btn(C.surface, C.danger, C.danger), opacity: mine.fits === 0 ? 0.4 : 1 }}>
            Delete all {mine.fits.toLocaleString()} fit{mine.fits === 1 ? "" : "s"}
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
