import { useState, useRef } from "react";
import { C } from "../theme.js";
import { isBackupApp, KEY_RE, countFits, buildBackup, mergeFitsDB } from "../lib/backup-io.js";
import { mergeTagColors } from "../lib/fit-tags.js";

// ── Backup & restore ────────────────────────────────────────────────────────────
// Fits live in localStorage and NOWHERE else. No git commit protects them; clearing browser data,
// switching browsers, or loading the app from a different port (localStorage is scoped per origin —
// :5173 and :4173 are different drawers) all lose everything. This makes them a file you can keep.
//
// Everything under the `pyfa-*` / `pyfa_*` keys is included, so it survives new settings being added
// later without anyone remembering to update this list.

function BackupPanel() {
  const [status, setStatus] = useState(null);       // {ok, msg}
  const [pending, setPending] = useState(null);     // parsed backup awaiting merge/replace choice
  const [pasted, setPasted] = useState("");
  const fileRef = useRef(null);

  const mine = countFits(localStorage.getItem("pyfa-fitsdb"));

  // iOS is the case this has to get right. A WKWebView ignores <a download>, so `a.click()` on a
  // blob: URL silently does nothing — and this used to report ok:true straight afterwards, so the
  // app claimed "Exported N fits" while producing no file at all. That false success is what made
  // it look like backup was broken rather than merely unavailable.
  //
  // The share sheet is the route that actually works inside a webview, and it is a plain web API
  // (navigator.share with a File), so it needs no extra Capacitor plugin and no native rebuild.
  // Order: share sheet -> anchor download (desktop web) -> tell the truth and point at Copy.
  const download = async () => {
    const json = buildBackup();
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
      await navigator.clipboard.writeText(buildBackup());
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

  const apply = (mode) => {
    const { obj } = pending;
    try {
      if (mode === "replace") {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (KEY_RE.test(k)) localStorage.removeItem(k);
        }
        for (const [k, v] of Object.entries(obj.data)) localStorage.setItem(k, v);
      } else {
        const merged = mergeFitsDB(localStorage.getItem("pyfa-fitsdb"), obj.data["pyfa-fitsdb"]);
        localStorage.setItem("pyfa-fitsdb", merged);
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
          if (k !== "pyfa-fitsdb" && k !== "pyfa-tagcolors" && localStorage.getItem(k) == null) localStorage.setItem(k, v);
        }
      }
      // Reloading is the honest way to re-init every piece of state from storage at once.
      window.location.reload();
    } catch (e) {
      setStatus({ ok: false, msg: `Import failed: ${e.message}` });
      setPending(null);
    }
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
            style={{ width: "100%", minHeight: 70, padding: 8, borderRadius: 8, fontSize: 11,
                     fontFamily: "monospace", background: C.surface, border: `1px solid ${C.border}`,
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

      {status && (
        <div style={{ marginTop: 12, fontSize: 11, color: status.ok ? C.accent : C.danger }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

export { BackupPanel };
