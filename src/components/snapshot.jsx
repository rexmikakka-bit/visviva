import { useState, useRef, useEffect, useMemo } from "react";
import { C } from "../theme.js";
import { eveRender } from "../lib/icons.js";
import { computeCommandBursts, computeProjectedReps, calcRangeFactor, tidByName, TYPES } from "../calc.js";
import { WARFARE_BUFF_UNIT } from "../lib/core.js";
import { getCachedPrices, fetchPrices } from "../prices.js";

// ── Export Snapshot ─────────────────────────────────────────────────────────────
// Renders a shareable image of the fit. Layout follows the approved fit-card mockup
// (fit-card-concept.html). Module names are left-flush in a clean column; ammo, clip
// EHP, range and heat sit in a right-aligned cluster. Tracking shows only on real
// turrets. Projected Links/Incoming list each source fit + hull with accurate values.
//
// Rasterised with html2canvas, which is BUNDLED (not a CDN) so this works offline — the
// shipped app runs from a webview with no network. Do not swap it for a CDN script, and
// do not add a Google-Fonts <link>: the card uses the system font stack on purpose.

const T = {
  outer: "#080b10", card: "#0d121a", panel: "#141a24",
  line: "rgba(255,255,255,.075)", line2: "rgba(255,255,255,.045)",
  text: "#e3e8ef", muted: "#8592a2", dim: "#586576",
  accent: "#3aa6d8", faction: "#4cae8a",
  em: "#4d90d9", th: "#d9584f", kin: "#c1c9d3", exp: "#e0932e",
  good: "#4cbf8a", warn: "#e0a83c", bad: "#e0584f", onl: "#4a5a6c",
  // Overheat, deliberately its own token rather than borrowing exp. Deeper than the amber it
  // used to share so it stops competing with the damage bars for attention, while staying
  // ~4.5:1 on the card background — it marks a state you still want to notice.
  overheat: "#c2610f",
};
const DMG = { em: T.em, th: T.th, kin: T.kin, exp: T.exp };
const CARD_W = 1140;
const FLAME = "M12 23a7 7 0 007-7c0-2-1-4-2.5-5.5 0 1.5-1 2.4-2 2.4 1-3-1-5.9-4.5-7.9.5 3-1.5 4.5-3 6.5C5 13 5 14.5 5 16a7 7 0 007 7z";

const fmt = (n, d = 0) =>
  n == null || !Number.isFinite(n) ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const fmtK = (n) => (n == null || !Number.isFinite(n) ? "-"
  : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const mmss = (s) => (s == null || !Number.isFinite(s) ? "-"
  : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
// EHP from raw HP + a layer's resist profile (0–100). Mirrors calc.js layerEHP.
const ehpOf = (hp, res) => { if (!hp) return 0; const a = ((res?.em ?? 0) + (res?.th ?? 0) + (res?.kin ?? 0) + (res?.exp ?? 0)) / 4 / 100; return hp / Math.max(0.0001, 1 - a); };

const isReal = (m) => m && m.type !== "empty" && m.name && !/^\[Empty/.test(m.name);

// ── shorthand: implants / boosters ────────────────────────────────────────────────
const GREEK = "Alpha|Beta|Gamma|Delta|Epsilon|Omega";
function shortImplant(name) {
  const nick = name.match(/[''`']([^''`']+)[''`']/)?.[1];
  const code = name.match(/\b([A-Z]{1,4}-\d{3,4})\b/)?.[1];
  if (nick && code) return `${nick} ${code}`;
  if (/Mindlink/i.test(name)) return name.replace(/\s*(Command|Warfare|Foreman|Mining)\s*/gi, " ").replace(/\s+/g, " ").trim();
  // CCP ships BOTH "Zor's Custom Navigation Link" and "Zor's Custom Navigation Hyper-Link". The old
  // "Zor's Nav" abbreviated them to the same string, so the card could not tell you which one was
  // fitted — and Hyper-Link is the one people actually fly. Keep the word that separates them.
  if (/Zor'?s/i.test(name)) return /hyper/i.test(name) ? "Zor's Nav Hyper-Link" : "Zor's Nav Link";
  if (nick) return nick;
  if (code) return code;
  const base = name.replace(/\s*-\s*(Basic|Standard|Improved|Enhanced|Advanced).*$/i, "").trim();
  return base.split(/\s+/).length > 3 ? base.split(/\s+/).slice(-2).join(" ") : base;
}
function shortenImplants(implants) {
  const real = (implants ?? []).filter((i) => i?.name && i.name !== "[Empty]");
  const setOrder = [], sets = {}, singles = [];
  for (const i of real) {
    const m = i.name.match(new RegExp(`^(High-grade|Mid-grade|Low-grade)\\s+(.+?)\\s+(${GREEK})$`));
    if (m) {
      const key = `${m[1]}|${m[2]}`;
      if (!sets[key]) { sets[key] = { grade: m[1], nick: m[2], n: 0 }; setOrder.push(key); }
      sets[key].n++;
    } else singles.push(shortImplant(i.name));
  }
  return { sets: setOrder.map((k) => sets[k]), singles };
}
function boosterParts(name) {
  const s = (name || "").replace(/\bBooster\b/gi, "").replace(/[''`']([^''`']+)[''`']/g, "\u0001$1\u0001").replace(/\s{2,}/g, " ").trim();
  return s.split("\u0001"); // odd indices are the bold nickname
}

// ── per-module engine stats ──────────────────────────────────────────────────────
// slotEngineStats is keyed by the very slot objects we were handed, so .get(m) works by
// reference. A REAL turret carries {dmgMult, tracking}; webs/tackle/EWAR also carry a
// `tracking` field but NO dmgMult, so tracking must key off dmgMult, not tracking alone.
function modMeta(m, cs) {
  const es = cs?.slotEngineStats?.get(m);
  if (!es) return {};
  if (es.isMissile) return { weapon: true, rng: es.optimal != null ? `${es.optimal} km` : null };
  if (es.dmgMult != null && es.tracking != null) {
    const rng = es.falloff > 0 ? `${es.optimal} + ${es.falloff} km` : (es.optimal != null ? `${es.optimal} km` : null);
    return { weapon: true, rng, trk: es.tracking };
  }
  if (es.isAAR || es.isASB) return { clip: es.totalEHP };
  if (es.isRAH && es.rahResistPct) return { rah: es.rahResistPct }; // [em,th,kin,exp] adapted resist %
  if (es.isWDFG && es.warpScrambleRange != null) return { rng: `${Math.round(es.warpScrambleRange / 1000)} km` };
  // Generic ranged module (web, scram, neut, EWAR, remote): show range only — NO tracking.
  if (es.optimal != null && es.optimal > 0) return { rng: es.falloff > 0 ? `${es.optimal} + ${es.falloff} km` : `${es.optimal} km` };
  return {};
}

function prepRack(mods, cs) {
  const out = [], idx = {};
  for (const m of (mods ?? []).filter(isReal)) {
    const meta = modMeta(m, cs);
    if (meta.weapon) {
      const key = `${m.name}|${m.ammo || ""}|${m.state || ""}`;
      if (idx[key] != null) { out[idx[key]].n++; continue; }
      idx[key] = out.length;
      out.push({ m, meta, n: 1 });
    } else out.push({ m, meta, n: 1 });
  }
  return out;
}

// ── projected effects (Links + Incoming) ─────────────────────────────────────────
const shortBurst = (label) => (label || "").replace(/\s*Charge\s*$/i, "").trim();
function warfareFamily(buffID, chargeName = "") {
  if (buffID >= 10 && buffID <= 12) return "Shield Warfare";
  if (buffID >= 13 && buffID <= 15) return "Armor Warfare";
  if (buffID === 16) return "Information Warfare";
  if (/shield/i.test(chargeName)) return "Shield Warfare";
  if (/armor/i.test(chargeName)) return "Armor Warfare";
  if (/sensor|electronic hardening|scan/i.test(chargeName)) return "Information Warfare";
  if (/mining|harvest/i.test(chargeName)) return "Mining Foreman";
  return "Skirmish Warfare";
}
// Buff value already includes skill/mindlink/ship bonuses (read from the calculated fit).
// Most buffs are percentages; buffIDs 3 (cap) and 17 (speed) are absolute — WARFARE_BUFF_UNIT.
function fmtBuff(buffID, value) {
  const unit = WARFARE_BUFF_UNIT[buffID];
  const v = Math.round(value * 10) / 10;
  const sign = v > 0 ? "+" : "";
  return unit ? `${sign}${v}${unit}` : `${sign}${v}%`;
}
function buildProjected(cmdFits, projFits, fitsDB, skills) {
  const links = [];
  for (const cf of (cmdFits ?? [])) {
    const fit = fitsDB?.[cf.ship]?.find((f) => f.name === cf.fitName);
    if (!fit) continue;
    let bursts = [];
    try { bursts = computeCommandBursts({ name: cf.ship, typeID: tidByName(cf.ship) }, fit.slots, skills, { implants: fit.implants, boosters: fit.boosters }); } catch { /* skip */ }
    if (!bursts.length) continue;
    const byCharge = {}, order = []; let warfare = null;
    for (const b of bursts) {
      const nm = shortBurst(b.label);
      warfare = warfare ?? warfareFamily(b.buffID, b.label);
      if (!byCharge[nm]) { byCharge[nm] = []; order.push(nm); }
      byCharge[nm].push(fmtBuff(b.buffID, b.value));
    }
    links.push({ fitName: cf.fitName || cf.ship, hull: cf.ship, warfare: warfare ?? "Warfare Link",
      bursts: order.map((nm) => ({ name: nm, pct: byCharge[nm].join(" · ") })) });
  }
  const incoming = [];
  const remoteReps = { shield: 0, armor: 0, hull: 0 };
  for (const pf of (projFits ?? [])) {
    const fit = fitsDB?.[pf.ship]?.find((f) => f.name === pf.fitName);
    if (!fit) continue;
    let eff;
    try { eff = computeProjectedReps({ name: pf.ship, typeID: tidByName(pf.ship) }, fit.slots, skills, { implants: fit.implants, boosters: fit.boosters, drones: fit.drones }); } catch { continue; }
    const rangeM = (pf.rangeKm ?? 30) * 1000;
    const rf = (o, fo) => calcRangeFactor(o, fo, rangeM, true);
    const fx = [];
    const add = (name, e, hostile = true) => fx.push({ name, eff: e, hostile });
    for (const w of (eff.webs || [])) { const f = rf(w.optimal, w.falloff); if (f > 0.01) add("Stasis Webifier", `\u2212${Math.abs(w.speedFactor * f).toFixed(0)}% speed`); }
    for (const n of (eff.neuts || [])) { const f = rf(n.optimal, n.falloff); const v = n.gjPerSec * f; if (v > 0.1) add("Energy Neut", `\u2212${v.toFixed(0)} GJ/s`); }
    for (const p of (eff.painters || [])) { const f = rf(p.optimal, p.falloff); const v = p.sigBonus * f; if (v > 0.1) add("Target Painter", `+${v.toFixed(0)}% sig`); }
    for (const d of (eff.damps || [])) { const f = rf(d.optimal, d.falloff); if (d.lockBonus < 0) add("Sensor Damp", `${(d.lockBonus * f).toFixed(0)}% lock`); if (d.scanResBonus < 0) add("Sensor Damp", `${(d.scanResBonus * f).toFixed(0)}% scan`); }
    for (const t of (eff.trackDisr || [])) { const f = rf(t.optimal, t.falloff); if (t.tracking < 0) add("Tracking Disr", `${(t.tracking * f).toFixed(0)}% track`); }
    for (const g of (eff.guideDisr || [])) { const f = rf(g.optimal, g.falloff); if (g.missileRange < 0) add("Guidance Disr", `${(g.missileRange * f).toFixed(0)}% mis. rng`); }
    for (const r of (eff.reps || [])) { const f = rf(r.optimal, r.falloff); const v = r.rawPS * f; if (v > 0.1) { remoteReps[r.kind] = (remoteReps[r.kind] ?? 0) + v; add(`Remote ${r.kind === "shield" ? "Shield" : r.kind === "armor" ? "Armor" : "Hull"} Rep`, `+${v.toFixed(0)} hp/s`, false); } }
    if (fx.length) incoming.push({ fitName: pf.fitName || pf.ship, hull: pf.ship, rangeKm: pf.rangeKm ?? 30, effects: fx });
  }
  return { links, incoming, remoteReps };
}

// ── sub-components ────────────────────────────────────────────────────────────────
function ModRow({ m, meta, n }) {
  const st = m.state || "online";
  const bl = st === "active" ? T.good : st === "overheated" ? T.overheat : st === "offline" ? T.dim : T.onl;
  const hasRight = m.ammo || meta.clip != null || meta.rng || meta.trk != null || meta.rah || st === "overheated";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, padding: "3px 0 3px 10px",
      borderLeft: `2px solid ${bl}`, lineHeight: 1.15, opacity: st === "offline" ? 0.5 : 1,
      background: st === "overheated" ? "linear-gradient(90deg,rgba(194,97,15,.10),transparent 55%)" : "none",
    }}>
      <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                     fontSize: 14, fontWeight: 500, color: st === "offline" ? T.muted : T.text }}>
        {n > 1 && <b style={{ color: T.muted, fontWeight: 700 }}>{n}× </b>}{m.name}
      </span>
      {hasRight && (
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          {m.ammo && <span style={{ fontSize: 12, color: T.accent, fontWeight: 500, whiteSpace: "nowrap" }}>{m.ammo}</span>}
          {meta.clip != null && <span style={{ fontSize: 11.5, color: T.faction, fontWeight: 600, whiteSpace: "nowrap" }}>{fmtK(meta.clip)} clip</span>}
          {meta.rah && (
            <span style={{ display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
              {meta.rah.map((v, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ color: T.dim, margin: "0 2px" }}>/</span>}
                  <span style={{ color: [DMG.em, DMG.th, DMG.kin, DMG.exp][i] }}>{Number(v.toFixed(1))}%</span>
                </span>
              ))}
            </span>
          )}
          {meta.rng && <span style={{ color: "#8fb0c6", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{meta.rng}</span>}
          {meta.trk != null && <span style={{ color: T.dim, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{meta.trk} rad/s</span>}
          {st === "overheated" && <svg viewBox="0 0 24 24" width={13} height={13} fill={T.overheat}><path d={FLAME} /></svg>}
        </span>
      )}
    </div>
  );
}

function Rack({ label, mods, cs }) {
  const rows = prepRack(mods, cs);
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
        <span style={{ fontSize: 11, letterSpacing: ".5px", color: T.muted, fontWeight: 600, textTransform: "uppercase" }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: T.line2 }} />
        <span style={{ fontSize: 11, color: T.dim, fontWeight: 600 }}>{rows.reduce((a, r) => a + r.n, 0)}</span>
      </div>
      {rows.map((r, i) => <ModRow key={i} {...r} />)}
    </div>
  );
}

function LoadoutRow({ k, children }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 12.5 }}>
      <span style={{ fontSize: 10, letterSpacing: ".5px", color: T.dim, fontWeight: 600, width: 62, flexShrink: 0, textTransform: "uppercase" }}>{k}</span>
      <span style={{ color: T.muted, fontWeight: 500, lineHeight: 1.35 }}>{children}</span>
    </div>
  );
}

// The trailing figure is EHP, not raw HP. Raw HP next to a resist profile invites exactly the wrong
// arithmetic — the resists are right there, so the number beside them should already have them
// applied. Taken from calcFitStats' own per-layer EHP rather than recomputed here, so the card and
// the Stats tab cannot disagree.
function ResistRow({ name, ehp, res }) {
  if (!res) return null;
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{name}</div>
      {["em", "th", "kin", "exp"].map((k) => (
        <div key={k} style={{ position: "relative", height: 24, borderRadius: 5, background: "rgba(255,255,255,.045)", overflow: "hidden", display: "grid", placeItems: "center" }}>
          <i style={{ position: "absolute", left: 0, bottom: 0, top: 0, width: `${Math.max(0, Math.min(100, res[k] ?? 0))}%`, background: DMG[k], opacity: 0.28 }} />
          <span style={{ position: "relative", fontSize: 13, fontWeight: 600, color: T.text }}>{res[k] != null ? res[k].toFixed(1) : "-"}</span>
        </div>
      ))}
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, textAlign: "right" }}>{fmtK(ehp)}</div>
    </>
  );
}

function KV({ k, v, unit, color, kColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2.5px 0", fontSize: 13 }}>
      <span style={{ color: kColor ?? T.muted, fontWeight: 500 }}>{k}</span>
      <span style={{ fontWeight: 600, color: color ?? T.text }}>
        {v}{unit && <small style={{ color: T.dim, fontWeight: 500, fontSize: 11 }}> {unit}</small>}
      </span>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 11, padding: "11px 13px" }}>
      <div style={{ fontSize: 11, letterSpacing: ".5px", color: T.muted, fontWeight: 600, marginBottom: 7, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function HeroStat({ cap, num, numColor, sub, bars }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 11, padding: "13px 15px", textAlign: "left" }}>
      <div style={{ fontSize: 11, letterSpacing: ".5px", color: T.muted, fontWeight: 600, textTransform: "uppercase" }}>{cap}</div>
      <div style={{ fontWeight: 700, fontSize: 36, lineHeight: 1, margin: "4px 0 3px", letterSpacing: "-.02em", color: numColor }}>{num}</div>
      <div style={{ fontSize: 12.5, color: T.muted, fontWeight: 500, display: "flex", justifyContent: "flex-start", gap: 12 }}>{sub}</div>
      <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", marginTop: 9, background: "rgba(0,0,0,.25)" }}>
        {bars.filter((x) => x.w > 0).map((x, i) => <i key={i} style={{ display: "block", height: "100%", width: `${x.w}%`, background: x.c }} />)}
      </div>
    </div>
  );
}

function Ptag({ kind }) {
  const link = kind === "link";
  return (
    <span style={{
      fontSize: 9.5, letterSpacing: ".4px", fontWeight: 700, padding: "3px 7px", borderRadius: 5, textTransform: "uppercase", flexShrink: 0,
      background: link ? "rgba(58,166,216,.13)" : "rgba(224,168,60,.11)", color: link ? T.accent : T.warn,
      border: `1px solid ${link ? "rgba(58,166,216,.28)" : "rgba(224,168,60,.26)"}`,
    }}>{link ? "Links" : "Incoming"}</span>
  );
}
function SrcLine({ fitName, hull, tail }) {
  return (
    <span style={{ fontSize: 13, color: T.muted, fontWeight: 500 }}>
      <b style={{ color: T.text, fontWeight: 600 }}>{fitName}</b> · {hull}{tail ? ` · ${tail}` : ""}
    </span>
  );
}
function Chip({ dot, name, eff }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 7, background: "rgba(255,255,255,.04)", border: `1px solid ${T.line}`, fontSize: 12.5, fontWeight: 500, color: T.text }}>
      <i style={{ width: 6, height: 6, borderRadius: 99, flexShrink: 0, background: dot }} />
      {name}{eff && <small style={{ color: T.muted, fontWeight: 500, fontSize: 11.5 }}>{eff}</small>}
    </span>
  );
}
function Projected({ links, incoming }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 11, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {links.map((lk, i) => (
        <div key={`l${i}`} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ptag kind="link" /><SrcLine fitName={lk.fitName} hull={lk.hull} tail={lk.warfare} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {lk.bursts.map((b, j) => <Chip key={j} dot={T.accent} name={b.name} eff={b.pct} />)}
          </div>
        </div>
      ))}
      {incoming.map((inc, i) => (
        <div key={`i${i}`} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Ptag kind="inc" /><SrcLine fitName={inc.fitName} hull={inc.hull} tail={`${inc.rangeKm} km`} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {inc.effects.map((x, j) => <Chip key={j} dot={x.hostile ? T.warn : T.good} name={x.name} eff={x.eff} />)}
          </div>
        </div>
      ))}
      {incoming.length === 0 && links.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Ptag kind="inc" /><span style={{ fontSize: 12.5, color: T.dim, fontWeight: 500 }}>No hostile effects projected</span>
        </div>
      )}
    </div>
  );
}

// The card renders off-screen at a fixed 1140px so the exported image is consistent regardless of the
// phone's viewport. The two columns stretch to equal height, so a tall loadout grows the whole card.
function FitCard({ cardRef, fitName, shipName, shipTypeID, shipFaction, shipClass, slots, cs, drones, fighters, implants, boosters, projected }) {
  const s = cs ?? {};
  const dmg = s.totalDps ?? {};
  const dmgTotal = (dmg.em ?? 0) + (dmg.th ?? 0) + (dmg.kin ?? 0) + (dmg.exp ?? 0);
  const ehp = s.totalEHP ?? 0;
  const capD = s.capDelta ?? 0;
  const layerColor = { shield: T.accent, armor: T.faction, hull: T.dim };
  const activeDrones = (drones ?? []).filter((d) => d?.name);
  const activeFighters = (fighters ?? []).filter((f) => f?.name);
  const imp = shortenImplants(implants);
  const bst = (boosters ?? []).filter((b) => b?.name && b.active !== false);
  const proj = projected ?? { links: [], incoming: [], remoteReps: {} };
  const showProj = proj.links.length > 0 || proj.incoming.length > 0;

  const priceHub = (() => { try { return localStorage.getItem('axis_pricehub') ?? 'Jita'; } catch { return 'Jita'; } })();
  const cachedPrices = getCachedPrices(priceHub);
  const fmtISKShort = (n) => n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1e3).toFixed(1)}K`;
  const priceBreakdown = (() => {
    if (!cachedPrices.size) return null;
    let fit = 0, character = 0;
    const addFit = (id, qty = 1) => { if (id > 0) fit += (cachedPrices.get(id) ?? 0) * qty; };
    const addChar = (id) => { if (id > 0) character += cachedPrices.get(id) ?? 0; };
    const ship = shipTypeID ? (cachedPrices.get(shipTypeID) ?? null) : null;
    const allSlots = [...(slots?.high ?? []), ...(slots?.mid ?? []), ...(slots?.low ?? []), ...(slots?.rigs ?? []), ...(slots?.subsystems ?? [])];
    for (const m of allSlots) {
      if (!isReal(m)) continue;
      if (m.typeID > 0) addFit(m.typeID);
      if (m.ammo) { const nm = m.ammo.replace(/\s*\(\d+\)$/, ''); const id = tidByName(nm); if (id) addFit(id); }
    }
    // Drones and fighters are priced by the UNIT, so the stack size counts: five Hobgoblin IIs are
    // five hulls, and a fighter's `qty` is SQUADRONS — six Templar IIs to a squadron. This block
    // used to add one of each and ignore both quantities, which understated a carrier badly.
    for (const d of (drones ?? [])) { const id = d?.typeID > 0 ? d.typeID : (d?.name ? tidByName(d.name) : 0); if (id) addFit(id, d.qty ?? 1); }
    for (const f of (fighters ?? [])) {
      const id = f?.typeID > 0 ? f.typeID : (f?.name ? tidByName(f.name) : 0);
      if (id) addFit(id, (f.qty ?? 1) * ((TYPES[id]?.attrs?.fighterSquadronMaxSize) || 1));
    }
    for (const i of (implants ?? [])) { if (i?.name && i.name !== '[Empty]') { const id = tidByName(i.name); if (id) addChar(id); } }
    for (const b of (boosters ?? [])) { if (b?.name) { const id = tidByName(b.name); if (id) addChar(id); } }
    const total = (ship ?? 0) + fit + character;
    return total > 0 ? { ship, fit, character, total } : null;
  })();

  // Rep = local rep EHP/s + projected remote-rep EHP/s (folded in). Sustained stays local.
  const projRep = ehpOf(proj.remoteReps?.shield, s.resists?.shield) + ehpOf(proj.remoteReps?.armor, s.resists?.armor) + ehpOf(proj.remoteReps?.hull, s.resists?.hull);
  const rep = (s.armorRepEhpS ?? 0) + (s.shieldRepEhpS ?? 0) + projRep;
  const sust = (s.armorRepSustainedEhpS ?? 0) + (s.shieldRepSustainedEhpS ?? 0);
  const eyebrow = [shipFaction, shipClass].filter(Boolean).join(" • ") || shipName;

  // Tactical mode (T3 destroyers + Anhinga). Mirrors the selector in tabs.jsx: the mode lives on
  // slots.tactical and defaults to the first mode when the user hasn't picked one.
  const MODE_SETS = { Skua: ["Defense", "Sharpshooter", "Propulsion"], Anhinga: ["Primary", "Secondary", "Tertiary"] };
  const shipModes = MODE_SETS[shipName] ?? (tidByName(`${shipName} Defense Mode`) ? ["Defense", "Sharpshooter", "Propulsion"] : null);
  const tacticalMode = shipModes ? (slots?.tactical ?? shipModes[0]) : null;

  // Pilot security-status bonus (CONCORD tank ships / AT damage frigates). Show the configured sec
  // when the hull carries the relevant effect, so the snapshot reflects the pilot the fit assumes.
  const secEffs = shipTypeID ? (TYPES[shipTypeID]?.e ?? []) : [];
  const showPilotSec = secEffs.includes(6871) || secEffs.includes(12165);
  const pilotSecVal = slots?.pilotSec ?? 0;

  return (
    <div ref={cardRef} style={{
      width: CARD_W, minHeight: 720, display: "flex", alignItems: "stretch", overflow: "hidden",
      background: T.card, color: T.text, borderRadius: 14, border: "1px solid rgba(255,255,255,.08)",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", boxSizing: "border-box",
    }}>
      {/* ── LEFT: loadout ── */}
      <div style={{ width: 500, flexShrink: 0, padding: "24px 22px 18px", display: "flex", flexDirection: "column", borderRight: `1px solid ${T.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 11, background: T.panel, border: `1px solid ${T.line}`, display: "grid", placeItems: "center", overflow: "hidden" }}>
            {shipTypeID ? <img src={eveRender(shipTypeID, 64)} width={60} height={60} alt="" /> : <span style={{ fontSize: 22, color: T.accent }}>◆</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ fontSize: 11, letterSpacing: ".5px", color: T.accent, fontWeight: 600, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eyebrow}</div>
            <div style={{ fontWeight: 700, fontSize: 27, lineHeight: 1.1, letterSpacing: "-.01em", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shipName}</div>
            <div style={{ fontSize: 13, color: T.muted, fontWeight: 500, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fitName || "Untitled Fit"}</div>
            {tacticalMode && (
              <span style={{ display: "inline-block", marginTop: 5, fontSize: 10, letterSpacing: ".4px", fontWeight: 700, textTransform: "uppercase", color: T.accent, background: "rgba(58,166,216,.13)", border: "1px solid rgba(58,166,216,.28)", borderRadius: 5, padding: "2px 7px" }}>{tacticalMode} Mode</span>
            )}
            {showPilotSec && (
              <span style={{ display: "inline-block", marginTop: 5, marginLeft: tacticalMode ? 6 : 0, fontSize: 10, letterSpacing: ".4px", fontWeight: 700, textTransform: "uppercase", color: T.accent, background: "rgba(58,166,216,.13)", border: "1px solid rgba(58,166,216,.28)", borderRadius: 5, padding: "2px 7px" }}>Sec {pilotSecVal.toFixed(1)}</span>
            )}
          </div>
          {priceBreakdown != null && (
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <div style={{ fontSize: 10, letterSpacing: ".5px", color: T.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 }}>Est. Value</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: T.accent, lineHeight: 1 }}>{fmtISKShort(priceBreakdown.total)}</div>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 4, lineHeight: 1.3 }}>Ship: {priceBreakdown.ship > 0 ? fmtISKShort(priceBreakdown.ship) : "N/A"}</div>
              <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.3 }}>Fit: {fmtISKShort(priceBreakdown.fit)}</div>
              {priceBreakdown.character > 0 && (
                <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.3 }}>Character: {fmtISKShort(priceBreakdown.character)}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 11, color: T.muted, fontWeight: 500, marginBottom: 14, flexWrap: "wrap" }}>
          {[["Active", T.good], ["Overheated", T.overheat], ["Online", T.onl]].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}</span>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          {/* Subsystems FIRST, matching the Fit tab's own rack order (SECS in tabs.jsx). On a T3
              cruiser they are not accessories — they decide the slot layout, the bonuses and half
              the fit's identity, so a card that omitted them was describing a different ship. Rack
              renders nothing when the array is empty, so every non-T3 hull is unaffected. */}
          <Rack label="Subsystems" mods={slots?.subsystems} cs={cs} />
          <Rack label="High" mods={slots?.high} cs={cs} />
          <Rack label="Mid" mods={slots?.mid} cs={cs} />
          <Rack label="Low" mods={slots?.low} cs={cs} />
          <Rack label="Rigs" mods={slots?.rigs} cs={cs} />
        </div>

        <div style={{ marginTop: 14, paddingTop: 13, borderTop: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {activeDrones.length > 0 && (
            <LoadoutRow k="Drones">
              {activeDrones.map((d, i) => (
                <span key={i}>{i > 0 && " · "}
                  {d.active ? <b style={{ color: T.text, fontWeight: 600 }}>{d.qty}× {d.name}</b> : <span style={{ color: T.bad, opacity: 0.75 }}>{d.qty}× {d.name}</span>}
                </span>
              ))}
            </LoadoutRow>
          )}
          {activeFighters.length > 0 && (
            <LoadoutRow k="Fighters">
              {activeFighters.map((f, i) => (
                <span key={i}>{i > 0 && " · "}
                  {f.active !== false ? <b style={{ color: T.text, fontWeight: 600 }}>{f.qty ?? 1}× {f.name}</b> : <span style={{ color: T.bad, opacity: 0.75 }}>{f.qty ?? 1}× {f.name}</span>}
                </span>
              ))}
            </LoadoutRow>
          )}
          {(imp.sets.length > 0 || imp.singles.length > 0) && (
            <LoadoutRow k="Implants">
              {imp.sets.map((st, i) => (
                <span key={`s${i}`}>{i > 0 && " · "}{st.grade} <b style={{ color: T.text, fontWeight: 600 }}>{st.nick}</b> ×{st.n}</span>
              ))}
              {imp.singles.map((nm, i) => <span key={`i${i}`}>{(imp.sets.length > 0 || i > 0) && " · "}{nm}</span>)}
            </LoadoutRow>
          )}
          {bst.length > 0 && (
            <LoadoutRow k="Boosters">
              {bst.map((b, i) => {
                const parts = boosterParts(b.name);
                return <span key={i}>{i > 0 && " · "}{parts.map((p, j) => j % 2 ? <b key={j} style={{ color: T.text, fontWeight: 600 }}>{p}</b> : p)}</span>;
              })}
            </LoadoutRow>
          )}
        </div>
      </div>

      {/* ── RIGHT: stats ── */}
      <div style={{ flex: 1, minWidth: 0, padding: "22px 22px 18px", display: "flex", flexDirection: "column", gap: 13 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <HeroStat cap="Total DPS" num={fmt(s.totalDps?.total)} numColor={T.accent}
            sub={<><span>Volley <b style={{ color: T.text }}>{fmtK(s.totalVolley?.total)}</b></span><span>Drone DPS <b style={{ color: T.text }}>{fmt((s.droneDps?.total ?? 0) + (s.fighterDps?.total ?? 0))}</b></span></>}
            bars={dmgTotal > 0 ? ["em", "th", "kin", "exp"].map((k) => ({ w: ((dmg[k] ?? 0) / dmgTotal) * 100, c: DMG[k] })) : []} />
          <HeroStat cap="Effective HP" num={fmtK(ehp)} numColor="#fff"
            sub={<><span>Rep <b style={{ color: T.good }}>{fmt(rep)}</b> ehp/s</span><span>Sust <b style={{ color: T.text }}>{fmt(sust)}</b></span></>}
            bars={ehp > 0 ? [["shield", s.shieldEHP], ["armor", s.armorEHP], ["hull", s.hullEHP]].map(([k, v]) => ({ w: ((v ?? 0) / ehp) * 100, c: layerColor[k] })) : []} />
        </div>

        <div>
          <div style={{ fontSize: 12, color: T.muted, fontWeight: 600, marginBottom: 7 }}>Resist Profile</div>
          <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 11, padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "50px repeat(4,1fr) 58px", gap: "6px 9px", alignItems: "center" }}>
              <div />
              {[["EM", T.em], ["TH", T.th], ["KIN", T.kin], ["EXP", T.exp]].map(([l, c]) => (
                <div key={l} style={{ fontSize: 10.5, letterSpacing: ".3px", fontWeight: 600, textAlign: "center", color: c }}>{l}</div>
              ))}
              <div style={{ fontSize: 10.5, fontWeight: 600, textAlign: "center", color: T.dim }}>EHP</div>
              <ResistRow name="Shield" ehp={s.shieldEHP} res={s.resists?.shield} />
              <ResistRow name="Armor" ehp={s.armorEHP} res={s.resists?.armor} />
              <ResistRow name="Hull" ehp={s.hullEHP} res={s.resists?.hull} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <Block title="Mobility">
            <KV k="Speed" v={fmt(s.maxVelocityAB ?? s.maxVelocity)} unit="m/s" />
            <KV k="Align" v={fmt(s.alignTime, 2)} unit="s" />
            <KV k="Sig" v={fmt(s.sigRadius)} unit="m" />
            <KV k="Warp" v={fmt(s.warpSpeed, 2)} unit="au/s" />
          </Block>
          <Block title="Targeting">
            <KV k="Range" v={fmt(s.targetRange, 1)} unit="km" />
            <KV k="Scan res" v={fmt(s.scanRes)} unit="mm" />
            <KV k="Sensor" v={fmt(s.sensorStrength, 1)} />
            <KV k="Targets" v={fmt(s.maxTargets)} />
          </Block>
          <Block title="Capacitor">
            <KV k="Capacity" v={fmtK(s.capCapacity)} unit="GJ" />
            <KV k="Delta" v={`${capD >= 0 ? "+" : ""}${fmt(capD, 2)}`} color={capD >= 0 ? T.good : T.bad} />
            <KV k={s.capStable ? "Stable at" : "Unstable"} kColor={s.capStable ? T.good : T.bad}
                v={s.capStable ? `${((s.capLevel ?? 1) * 100).toFixed(0)}%` : mmss(s.capTime)}
                color={s.capStable ? T.good : T.bad} />
          </Block>
        </div>

        {showProj && (
          <div>
            <div style={{ fontSize: 12, color: T.muted, fontWeight: 600, marginBottom: 7 }}>Projected</div>
            <Projected links={proj.links} incoming={proj.incoming} />
          </div>
        )}

        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${T.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Two different kinds of text that were sharing one style. "All skills V" QUALIFIES every
              number on the card and is the first thing a reader should check; the trademark line is
              boilerplate nobody needs to read twice. Separated by weight and colour rather than by
              adding a row, since the footer is height-constrained. */}
          <div style={{ fontSize: 11, fontWeight: 500, display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            <span style={{ color: T.text, fontWeight: 700, letterSpacing: ".02em", flexShrink: 0 }}>All skills V</span>
            <span style={{ color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>EVE Online is a trademark of Fenris Creations.</span>
          </div>
          <div style={{ fontWeight: 700, letterSpacing: ".04em", fontSize: 13, color: T.accent }}>AXIS</div>
        </div>
      </div>
    </div>
  );
}

// ── the modal: preview + save/share ─────────────────────────────────────────────
function SnapshotModal({ onClose, cmdFits, projFits, fitsDB, skills, priceHub = "Jita", priceSource = "fuzzwork", ...cardProps }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pricesReady, setPricesReady] = useState(false);
  const projected = useMemo(() => buildProjected(cmdFits, projFits, fitsDB, skills), [cmdFits, projFits, fitsDB, skills]);

  const render = async () => {
    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(cardRef.current, { backgroundColor: T.outer, scale: 2, logging: false, useCORS: true });
  };

  // Warm the price cache so the card's Est. Value block renders even when the Stats tab
  // (which normally fetches) was never opened. Best-effort: an offline webview just skips it.
  useEffect(() => {
    let dead = false;
    const priceHub = (() => { try { return localStorage.getItem("axis_pricehub") ?? "Jita"; } catch { return "Jita"; } })();
    const { shipTypeID, slots, drones, fighters, implants, boosters } = cardProps;
    const ids = [];
    if (shipTypeID) ids.push(shipTypeID);
    for (const rack of ["high", "mid", "low", "rigs", "subsystems"]) for (const m of (slots?.[rack] ?? [])) {
      if (!isReal(m)) continue;
      if (m.typeID > 0) ids.push(m.typeID);
      if (m.ammo) { const id = tidByName(m.ammo.replace(/\s*\(\d+\)$/, "")); if (id) ids.push(id); }
    }
    for (const d of ([...(drones ?? []), ...(fighters ?? [])])) { if (d?.typeID > 0) ids.push(d.typeID); else if (d?.name) { const id = tidByName(d.name); if (id) ids.push(id); } }
    for (const i of (implants ?? [])) { if (i?.name && i.name !== "[Empty]") { const id = tidByName(i.name); if (id) ids.push(id); } }
    for (const b of (boosters ?? [])) { if (b?.name) { const id = tidByName(b.name); if (id) ids.push(id); } }
    fetchPrices(ids, priceHub, priceSource).then(() => { if (!dead) setPricesReady(true); }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render on open, then re-render once prices land so the value block appears.
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
  }, [pricesReady]);

  const filename = `${(cardProps.fitName || cardProps.shipName || "fit").replace(/[^\w\-]+/g, "_")}.png`;

  // Copy the IMAGE to the clipboard. Sharing used to be the only route, and iOS's share sheet has
  // a "Copy" action that copies the share payload's TITLE, not the file — so copying a snapshot
  // put the fit's name on the clipboard and nothing else. This writes the PNG itself.
  //
  // Safari only honours clipboard.write() when the ClipboardItem is constructed synchronously
  // within the user gesture, so the value has to be the render PROMISE rather than an awaited blob:
  // awaiting first breaks the gesture chain and the write is rejected.
  const copyImage = async () => {
    setBusy(true);
    try {
      if (!navigator.clipboard?.write) throw new Error("clipboard images aren't supported here");
      const png = render().then((canvas) => new Promise((r) => canvas.toBlob(r, "image/png")));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setStatus({ ok: true, msg: "Image copied." });
    } catch (e) {
      setStatus({ ok: false, msg: `Couldn't copy: ${e.message}. Use Save image instead.` });
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const canvas = await render();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      // Web Share with a file is the only thing that reliably works in a mobile webview; fall back to
      // a download link on desktop, and to long-press-the-preview if neither is available.
      //
      // Deliberately no `title`/`text`: with them, iOS shows a text-flavoured sheet and its Copy
      // action grabs the title. Files alone gets you "Save Image" (straight to the camera roll)
      // and a Copy that copies the picture.
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
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
            {busy ? "Working…" : (navigator.canShare ? "Save image" : "Save PNG")}
          </button>
          {navigator.clipboard?.write && (
            <button onClick={copyImage} disabled={busy || !preview} style={{ ...btn(C.surface, C.border, C.text), opacity: busy || !preview ? .5 : 1 }}>
              Copy image
            </button>
          )}
          <button onClick={onClose} style={btn(C.surface, C.border, C.textMid)}>Close</button>
        </div>
        {status && <div style={{ fontSize: 11, color: status.ok ? C.accent : C.danger }}>{status.msg}</div>}
        <div style={{ fontSize: 10, color: C.textMute, textAlign: "center", maxWidth: 320 }}>
          Save image opens the share sheet — pick <strong>Save Image</strong> to put it in your camera roll.
          You can also long-press the preview.
        </div>
      </div>

      {/* The real card renders off-screen at full width so the export is identical on every device. */}
      <div style={{ position: "fixed", left: -99999, top: 0 }}>
        <FitCard cardRef={cardRef} {...cardProps} projected={projected} />
      </div>
    </div>
  );
}

export { SnapshotModal, FitCard };
