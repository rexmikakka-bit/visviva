import { useState, useRef } from "react";
import { C } from "../theme.js";
import { BACKUP_APP, KEY_RE, countFits, buildBackup, mergeFitsDB } from "../lib/backup-io.js";

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

  const download = () => {
    try {
      const blob = new Blob([buildBackup()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `visviva-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ ok: true, msg: `Exported ${mine.fits} fit${mine.fits === 1 ? "" : "s"}.` });
    } catch (e) {
      setStatus({ ok: false, msg: `Export failed: ${e.message}` });
    }
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
    if (obj?.app !== BACKUP_APP || !obj?.data) {
      setStatus({ ok: false, msg: "Not a Vis Viva backup file." });
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
        // Only fill in settings that don't exist yet — a merge shouldn't overwrite your skills.
        for (const [k, v] of Object.entries(obj.data)) {
          if (k !== "pyfa-fitsdb" && localStorage.getItem(k) == null) localStorage.setItem(k, v);
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
            placeholder='{"app":"visviva",...}'
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
