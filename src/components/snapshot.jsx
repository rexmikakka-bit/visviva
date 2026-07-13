import { useState, useRef, useEffect } from "react";
import { C } from "../theme.js";
import { eveIcon, eveRender } from "../lib/icons.js";

// ── Export Snapshot ─────────────────────────────────────────────────────────────
// Renders a shareable image of the fit. Layout follows the approved fit-card mockup: racks + loadout
// on the left, hero stats / resist profile / mobility-targeting-capacitor on the right.
//
// Rasterised with html2canvas, which is BUNDLED (not a CDN) so this works offline — the shipped app
// runs from a webview with no network. Do not swap it for a CDN script.

const DMG_COLORS = { em: "#5b8dd6", th: "#d2504a", kin: "#8b96a5", exp: "#c9a13b" };
const CARD_W = 1140;

const fmt = (n, d = 0) =>
  n == null || !Number.isFinite(n) ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const fmtK = (n) => (n == null || !Number.isFinite(n) ? "-"
  : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

function Rack({ label, mods }) {
  const rows = (mods ?? []).filter((m) => m && m.type !== "empty" && m.name && !/^\[Empty/.test(m.name));
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#5d6b7c", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {rows.map((m, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: 11.5, color: "#c8d2dd" }}>
          <i style={{ width: 5, height: 5, borderRadius: 99, flexShrink: 0,
                      background: m.state === "active" ? "#4ea3d8" : m.state === "overheated" ? "#d2504a" : "#4a5a6c" }} />
          {m.typeID && <img src={eveIcon(m.typeID, 32)} width={16} height={16} alt="" style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
          {m.ammo && <span style={{ fontSize: 10, color: "#6f8091", flexShrink: 0 }}>{m.ammo}</span>}
        </div>
      ))}
    </div>
  );
}

function ResistRow({ name, res }) {
  if (!res) return null;
  return (
    <>
      <div style={{ fontSize: 10, color: "#8a97a6", padding: "3px 0" }}>{name}</div>
      {["em", "th", "kin", "exp"].map((k) => (
        <div key={k} style={{ position: "relative", height: 16, background: "#141a22", borderRadius: 3, overflow: "hidden" }}>
          <i style={{ position: "absolute", inset: 0, width: `${Math.max(0, Math.min(100, res[k]))}%`, background: DMG_COLORS[k], opacity: 0.45 }} />
          <span style={{ position: "relative", display: "block", textAlign: "center", fontSize: 9.5, lineHeight: "16px", color: "#dbe4ee", fontWeight: 600 }}>
            {res[k] != null ? res[k].toFixed(1) : "-"}
          </span>
        </div>
      ))}
    </>
  );
}

function KV({ k, v, unit, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2.5px 0" }}>
      <span style={{ fontSize: 10, color: "#6f8091" }}>{k}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color ?? "#dbe4ee" }}>
        {v}{unit && <small style={{ fontSize: 9, fontWeight: 400, color: "#6f8091" }}> {unit}</small>}
      </span>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div style={{ background: "#0d1218", border: "1px solid #1c2530", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#5d6b7c", textTransform: "uppercase", marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
}

// The card itself — rendered off-screen at a fixed 1140px so the exported image is consistent
// regardless of the phone's viewport.
function FitCard({ cardRef, fitName, shipName, shipTypeID, slots, cs, drones, implants, boosters }) {
  const dps = cs?.totalDps?.total ?? cs?.weaponDps?.total ?? 0;
  const dmg = cs?.totalDps ?? cs?.weaponDps ?? {};
  const dmgTotal = (dmg.em ?? 0) + (dmg.th ?? 0) + (dmg.kin ?? 0) + (dmg.exp ?? 0);
  const layers = [
    ["shield", cs?.shieldEHP ?? 0, "#4ea3d8"],
    ["armor", cs?.armorEHP ?? 0, "#c9a13b"],
    ["hull", cs?.hullEHP ?? 0, "#8b96a5"],
  ];
  const ehp = cs?.totalEHP ?? 0;
  const capD = cs?.capDelta ?? 0;

  return (
    <div ref={cardRef} style={{
      width: CARD_W, background: "#080b10", color: "#dbe4ee", padding: 20, boxSizing: "border-box",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", display: "flex", gap: 18,
    }}>
      {/* left: loadout */}
      <div style={{ width: 420, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          {shipTypeID && <img src={eveRender(shipTypeID, 64)} width={46} height={46} alt=""
                              style={{ borderRadius: 6, border: "1px solid #1c2530" }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 1.4, color: "#4ea3d8", textTransform: "uppercase", fontWeight: 700 }}>
              {shipName}
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis" }}>
              {fitName || "Untitled Fit"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 9, color: "#6f8091" }}>
          {[["Active", "#4ea3d8"], ["Overheated", "#d2504a"], ["Offline", "#4a5a6c"]].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <i style={{ width: 5, height: 5, borderRadius: 99, background: c }} />{l}
            </span>
          ))}
        </div>

        <Rack label="High" mods={slots?.high} />
        <Rack label="Mid" mods={slots?.mid} />
        <Rack label="Low" mods={slots?.low} />
        <Rack label="Rigs" mods={slots?.rigs} />

        <div style={{ borderTop: "1px solid #1c2530", marginTop: 8, paddingTop: 8 }}>
          {[["Drones", (drones ?? []).filter((d) => d?.name).map((d) => `${d.qty}× ${d.name}`).join(", ")],
            ["Implants", (implants ?? []).map((i) => i.name).join(", ")],
            ["Boosters", (boosters ?? []).filter((b) => b.active !== false).map((b) => b.name).join(", ")],
          ].map(([k, v]) => v ? (
            <div key={k} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 10 }}>
              <span style={{ width: 56, flexShrink: 0, color: "#5d6b7c", fontWeight: 700 }}>{k}</span>
              <span style={{ color: "#93a1b1", lineHeight: 1.45 }}>{v}</span>
            </div>
          ) : null)}
        </div>
      </div>

      {/* right: stats */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#0d1218", border: "1px solid #1c2530", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, letterSpacing: 1, color: "#5d6b7c", textTransform: "uppercase", fontWeight: 700 }}>Total DPS</div>
            <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, color: "#e8eef5" }}>{fmt(dps)}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#6f8091", marginTop: 2 }}>
              <span>Volley <b style={{ color: "#c8d2dd" }}>{fmtK(cs?.totalVolley?.total ?? cs?.weaponVolley?.total)}</b></span>
              <span>Drones <b style={{ color: "#c8d2dd" }}>{fmt(cs?.droneDps?.total ?? 0)}</b></span>
            </div>
            <div style={{ display: "flex", height: 5, borderRadius: 99, overflow: "hidden", marginTop: 7, background: "#141a22" }}>
              {dmgTotal > 0 && ["em", "th", "kin", "exp"].map((k) => (
                <i key={k} style={{ width: `${((dmg[k] ?? 0) / dmgTotal) * 100}%`, background: DMG_COLORS[k] }} />
              ))}
            </div>
          </div>

          <div style={{ background: "#0d1218", border: "1px solid #1c2530", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, letterSpacing: 1, color: "#5d6b7c", textTransform: "uppercase", fontWeight: 700 }}>Effective HP</div>
            <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, color: "#e8eef5" }}>{fmtK(ehp)}</div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#6f8091", marginTop: 2 }}>
              <span>Rep <b style={{ color: "#5fbf6b" }}>{fmt((cs?.armorRepEhpS ?? 0) + (cs?.shieldRepEhpS ?? 0))}</b> ehp/s</span>
              <span>Cap <b style={{ color: capD >= 0 ? "#5fbf6b" : "#d2504a" }}>{capD >= 0 ? "+" : ""}{fmt(capD, 1)}</b> GJ/s</span>
            </div>
            <div style={{ display: "flex", height: 5, borderRadius: 99, overflow: "hidden", marginTop: 7, background: "#141a22" }}>
              {ehp > 0 && layers.map(([k, v, c]) => <i key={k} style={{ width: `${(v / ehp) * 100}%`, background: c }} />)}
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: "#5d6b7c", textTransform: "uppercase", marginBottom: 5 }}>Resist Profile</div>
          <div style={{ display: "grid", gridTemplateColumns: "52px repeat(4, 1fr)", gap: 3, alignItems: "center" }}>
            <div />
            {["EM", "TH", "KIN", "EXP"].map((l, i) => (
              <div key={l} style={{ fontSize: 9, textAlign: "center", fontWeight: 700, color: Object.values(DMG_COLORS)[i] }}>{l}</div>
            ))}
            <ResistRow name="Shield" res={cs?.resists?.shield} />
            <ResistRow name="Armor" res={cs?.resists?.armor} />
            <ResistRow name="Hull" res={cs?.resists?.hull} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Block title="Mobility">
            <KV k="Speed" v={fmt(cs?.maxVelocityAB ?? cs?.maxVelocity)} unit="m/s" />
            <KV k="Align" v={fmt(cs?.alignTime, 2)} unit="s" />
            <KV k="Sig" v={fmt(cs?.sigRadius)} unit="m" />
            <KV k="Warp" v={fmt(cs?.warpSpeed, 2)} unit="au/s" />
          </Block>
          <Block title="Targeting">
            <KV k="Range" v={fmt(cs?.targetRange, 1)} unit="km" />
            <KV k="Scan res" v={fmt(cs?.scanRes)} unit="mm" />
            <KV k="Sensor" v={fmt(cs?.sensorStrength, 1)} />
            <KV k="Targets" v={fmt(cs?.maxTargets)} />
          </Block>
          <Block title="Capacitor">
            <KV k="Capacity" v={fmtK(cs?.capCapacity)} unit="GJ" />
            <KV k="Delta" v={`${capD >= 0 ? "+" : ""}${fmt(capD, 1)}`} color={capD >= 0 ? "#5fbf6b" : "#d2504a"} />
            <KV k="Stable" v={cs?.capStable ? `${fmt(cs?.capLevel, 1)}%` : `${fmt(cs?.capTime, 1)} min`}
                color={cs?.capStable ? "#5fbf6b" : "#c9a13b"} />
            <KV k="Drone rng" v={fmt((cs?.droneControlRange ?? 0) / 1000)} unit="km" />
          </Block>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid #1c2530",
                      display: "flex", justifyContent: "space-between", fontSize: 9, color: "#4a5a6c" }}>
          <span>Vis Viva — all skills V</span>
          <span>Unofficial fan tool. EVE Online is a trademark of CCP hf.</span>
        </div>
      </div>
    </div>
  );
}

// ── the modal: preview + save/share ─────────────────────────────────────────────
function SnapshotModal({ onClose, ...cardProps }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);

  const render = async () => {
    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(cardRef.current, { backgroundColor: "#080b10", scale: 2, logging: false, useCORS: true });
  };

  // Render once on open so the user sees exactly what they'll get.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const canvas = await render();
        if (!dead) setPreview(canvas.toDataURL("image/png"));
      } catch (e) { if (!dead) setStatus({ ok: false, msg: `Couldn't render: ${e.message}` }); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filename = `${(cardProps.fitName || cardProps.shipName || "fit").replace(/[^\w\-]+/g, "_")}.png`;

  const save = async () => {
    setBusy(true);
    try {
      const canvas = await render();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      // Web Share with a file is the only thing that reliably works in a mobile webview; fall back to
      // a download link on desktop, and to long-press-the-preview if neither is available.
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: cardProps.fitName ?? "Fit" });
        setStatus({ ok: true, msg: "Shared." });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus({ ok: true, msg: `Saved ${filename}` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: `Failed: ${e.message}. Long-press the preview to save it instead.` });
    }
    setBusy(false);
  };

  const btn = (bg, bd, col) => ({ padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
    cursor: "pointer", background: bg, border: `1px solid ${bd}`, color: col });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999,
                                    display: "flex", flexDirection: "column", alignItems: "center",
                                    justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", overflow: "auto",
                                                          display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        {preview
          ? <img src={preview} alt="Fit snapshot" style={{ maxWidth: "100%", borderRadius: 10, border: `1px solid ${C.border}` }} />
          : <div style={{ color: C.textMute, fontSize: 13, padding: 40 }}>Rendering…</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={save} disabled={busy || !preview} style={{ ...btn(C.accent, C.accent, "#0e0e10"), opacity: busy || !preview ? .5 : 1 }}>
            {busy ? "Working…" : (navigator.canShare ? "Share image" : "Save PNG")}
          </button>
          <button onClick={onClose} style={btn(C.surface, C.border, C.textMid)}>Close</button>
        </div>
        {status && <div style={{ fontSize: 11, color: status.ok ? C.accent : C.danger }}>{status.msg}</div>}
        <div style={{ fontSize: 10, color: C.textMute }}>On mobile you can also long-press the image to save it.</div>
      </div>

      {/* The real card renders off-screen at full width so the export is identical on every device. */}
      <div style={{ position: "fixed", left: -99999, top: 0 }}>
        <FitCard cardRef={cardRef} {...cardProps} />
      </div>
    </div>
  );
}

export { SnapshotModal, FitCard };
