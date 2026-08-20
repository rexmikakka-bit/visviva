import { useState, useEffect, useCallback } from "react";
import { C } from "../theme.js";
import * as esi from "../lib/esi.js";
import { esiFittingToImportShape, slotsToEsiFitting } from "../lib/esi-fits.js";
import { ESI_CLIENT_ID } from "../esi-config.js";
import { tidByName, TYPES } from "../calc.js";
import { eveIcon } from "../lib/icons.js";

// Friendlier text for the handful of failure modes the rest of this file needs to show inline.
function friendlyError(e) {
  if (!ESI_CLIENT_ID) return "ESI isn't configured yet — an application needs to be registered at developers.eveonline.com first (see src/esi-config.js).";
  if (e?.code === "ESI_REAUTH_REQUIRED") return "Your EVE session expired — log in again.";
  if (e?.code === "ESI_NOT_LINKED") return "That character isn't linked anymore.";
  return e?.message || String(e);
}

// Shared row-list character switcher. Renders nothing if zero or one character is linked (nothing
// to switch between) — callers should still show their own "not connected" state in that case.
function CharacterPicker({ characters, activeId, onSwitch }) {
  if (characters.length < 2) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {characters.map(c => (
        <button key={c.characterId} onClick={() => onSwitch(c.characterId)}
          style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: c.characterId === activeId ? C.accentLight : "transparent",
            border: `1px solid ${c.characterId === activeId ? C.accentBorder : C.border}`,
            color: c.characterId === activeId ? C.accent : C.textMid }}>
          {c.characterName}
        </button>
      ))}
    </div>
  );
}

// Reusable hook: tracks linked characters + active character, re-reading from esi.js's storage
// whenever a login/logout happens in this component tree.
function useEsiCharacters() {
  const [characters, setCharacters] = useState(() => esi.listCharacters());
  const [activeId, setActiveId] = useState(() => esi.getActiveCharacterId());
  const [loginError, setLoginError] = useState(() => esi.getLastLoginError());
  const refresh = useCallback(() => {
    setCharacters(esi.listCharacters());
    setActiveId(esi.getActiveCharacterId());
    setLoginError(esi.getLastLoginError());
  }, []);
  // Native login completes via an appUrlOpen deep link (App.jsx), not a page load, so this
  // component won't otherwise learn about it if it was already mounted when that happened.
  useEffect(() => esi.onCharactersChanged(refresh), [refresh]);
  const switchActive = useCallback((id) => { esi.setActiveCharacterId(id); refresh(); }, [refresh]);
  const remove = useCallback((id) => { esi.removeCharacter(id); refresh(); }, [refresh]);
  return { characters, activeId, loginError, refresh, switchActive, remove };
}

// ─── Settings > ESI panel: connect/manage characters, sync skills ─────────────────────────────
export function EsiSettingsPanel({ setSkills }) {
  const { characters, activeId, loginError, refresh, switchActive, remove } = useEsiCharacters();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [syncedMsg, setSyncedMsg] = useState(null);

  // Web build: if this load is the SSO redirect landing back with ?code=&state=, complete it.
  useEffect(() => {
    esi.handleWebRedirectOnLoad()
      .then(result => { if (result) refresh(); })
      .catch(e => setError(friendlyError(e)));
  }, [refresh]);

  const connect = async () => {
    setError(null);
    try { await esi.beginLogin(); }
    catch (e) { setError(friendlyError(e)); }
  };

  const syncSkills = async () => {
    if (!activeId) return;
    setBusy(true); setError(null); setSyncedMsg(null);
    try {
      const resp = await esi.getCharacterSkills(activeId);
      // Full map, not a merge: an untrained skill is ABSENT from ESI's response, and an absent
      // skill key means level V in this app — so merging left every untrained skill at V.
      const full = esi.esiSkillsToFullSkillMap(resp);
      setSkills(full);
      // Also cached per character, so a fit that names this pilot (slots.pilot = "esi:<id>") can be
      // calculated with their sheet offline, without disturbing the app-wide one.
      esi.storeCharacterSkills(activeId, full);
      setSyncedMsg(`Synced ${Object.values(full).filter(v => v > 0).length} trained skills.`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  const activeChar = characters.find(c => c.characterId === activeId);

  return (
    <div>
      <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>EVE ESI Connection</div>
        <div style={{ fontSize: 11, color: C.textMute, marginBottom: 10 }}>
          Connect an EVE character to sync skills and import/export saved fits directly from the game.
        </div>

        {characters.length === 0 ? (
          <>
            <div style={{ marginBottom: 10, padding: "8px 12px", background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 8, fontSize: 11, color: C.textMute, textAlign: "center" }}>
              Not connected
            </div>
            <button onClick={connect} style={{ width: "100%", padding: "10px 0", background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Connect with EVE SSO
            </button>
          </>
        ) : (
          <>
            <CharacterPicker characters={characters} activeId={activeId} onSwitch={switchActive} />
            {activeChar && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{activeChar.characterName}</div>
                  <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>{activeChar.scopes?.length ?? 0} scopes granted</div>
                </div>
                <button onClick={() => remove(activeChar.characterId)} style={{ background: "none", border: `1px solid ${C.danger}`, color: C.danger, borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Unlink
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <button onClick={syncSkills} disabled={busy || !activeId} style={{ flex: 1, padding: "10px 0", background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Syncing…" : `Sync Skills from ${activeChar?.characterName ?? "character"}`}
              </button>
              <button onClick={connect} style={{ padding: "10px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMid, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                + Add
              </button>
            </div>
            {syncedMsg && <div style={{ fontSize: 11, color: C.success, marginTop: 6 }}>✓ {syncedMsg}</div>}
          </>
        )}
        {(error || loginError) && <div style={{ fontSize: 11, color: C.danger, marginTop: 8, lineHeight: 1.5, wordBreak: "break-word" }}>{error || loginError}</div>}
      </div>
    </div>
  );
}

// ─── Settings > Skills: align the whole sheet to one of your characters ───────────────────────
// Lives in the SKILLS tab rather than the ESI tab because that is where you are when you notice
// your levels are wrong. Every linked character gets its own button: EVE players routinely fly
// several, and which one the ESI tab happens to have marked "active" is not the question being
// asked here — "match THIS pilot" is.
export function EsiSkillAlignPanel({ setSkills }) {
  const { characters } = useEsiCharacters();
  const [busy, setBusy] = useState(null);      // characterId currently syncing
  const [done, setDone] = useState(null);      // {name, trained, total}
  const [error, setError] = useState(null);

  const align = async (c) => {
    setBusy(c.characterId); setError(null); setDone(null);
    try {
      const resp = await esi.getCharacterSkills(c.characterId);
      // The FULL map, not a merge — see esiSkillsToFullSkillMap. A merge leaves untrained skills
      // unset, and unset means V.
      const full = esi.esiSkillsToFullSkillMap(resp);
      setSkills(full);
      esi.storeCharacterSkills(c.characterId, full);
      const trained = Object.values(full).filter(v => v > 0).length;
      setDone({ name: c.characterName, trained, total: Object.keys(full).length });
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ marginBottom: 14, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>Match a character</div>
      <div style={{ fontSize: 10, color: C.textMute, marginBottom: characters.length ? 9 : 0, lineHeight: 1.5 }}>
        {characters.length
          ? "Sets every skill to that pilot's trained level. Anything they haven't trained is set to 0, not left at the level-V default."
          : "Connect a character in the ESI tab to copy their trained skills here."}
      </div>
      {characters.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {characters.map(c => (
            <button key={c.characterId} onClick={() => align(c)} disabled={busy != null} className="press"
              style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                cursor: busy != null ? "default" : "pointer", opacity: busy != null && busy !== c.characterId ? 0.5 : 1,
                background: C.accentLight, border: `1px solid ${C.accentBorder}`, color: C.accent }}>
              {busy === c.characterId ? "Syncing…" : c.characterName}
            </button>
          ))}
        </div>
      )}
      {done && <div style={{ fontSize: 10, color: C.success, marginTop: 8 }}>
        ✓ Matched {done.name} — {done.trained} of {done.total} skills trained, the rest set to 0.
      </div>}
      {error && <div style={{ fontSize: 10, color: C.danger, marginTop: 8, lineHeight: 1.5 }}>{error}</div>}
    </div>
  );
}

// ─── Hamburger menu > Import from ESI ──────────────────────────────────────────────────────────
export function EsiImportModal({ onClose, onImport }) {
  const { characters, activeId, switchActive } = useEsiCharacters();
  const [fittings, setFittings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const load = useCallback((characterId) => {
    if (!characterId) return;
    setLoading(true); setError(null); setFittings(null);
    esi.getCharacterFittings(characterId)
      .then(setFittings)
      .catch(e => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(activeId); }, [activeId, load]);

  const importOne = (fitting) => {
    try {
      const parsed = esiFittingToImportShape(fitting);
      onImport(parsed);
      onClose();
    } catch (e) { setError(friendlyError(e)); }
  };

  // Search matches the HULL as well as the fit name — a pilot with 200 saved fits looks for "every
  // Legion I have" far more often than for a fit whose name they remember exactly.
  const q = search.trim().toLowerCase();
  const shipNameOf = f => TYPES[f?.ship_type_id]?.n ?? "";
  const shown = q
    ? (fittings ?? []).filter(f => String(f.name ?? "").toLowerCase().includes(q) || shipNameOf(f).toLowerCase().includes(q))
    : (fittings ?? []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ width: "100%", maxHeight: "88vh", overflowY: "auto", boxSizing: "border-box", background: C.surface, borderRadius: "16px 16px 0 0", padding: 20, boxShadow: "0 -8px 32px rgba(0,0,0,.5)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>Import from EVE</div>
        {characters.length === 0 && <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "24px 0" }}>Connect a character in Settings → ESI first.</div>}
        <CharacterPicker characters={characters} activeId={activeId} onSwitch={switchActive} />
        {loading && <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "16px 0" }}>Loading saved fittings…</div>}
        {error && <div style={{ fontSize: 11, color: C.danger, marginBottom: 10 }}>{error}</div>}
        {fittings && fittings.length === 0 && <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "16px 0" }}>No saved fittings on this character.</div>}
        {fittings && fittings.length > 0 && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fits or hulls…"
                 style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.text, fontSize: 13, outline: "none" }} />
        )}
        {fittings && fittings.length > 0 && shown.length === 0 && (
          <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "16px 0" }}>No fit matches “{search.trim()}”.</div>
        )}
        {shown.map(f => (
          <div key={f.fitting_id} onClick={() => importOne(f)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, cursor: "pointer" }}>
            <img src={eveIcon(f.ship_type_id, 32)} alt="" width={32} height={32}
                 style={{ width: 32, height: 32, borderRadius: 5, flexShrink: 0, background: C.surface }}
                 onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>{shipNameOf(f) || "Unknown hull"} · {f.items?.length ?? 0} items</div>
            </div>
          </div>
        ))}
        <button onClick={onClose} style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMute, fontSize: 13, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Hamburger menu > Export to EVE ────────────────────────────────────────────────────────────
export function EsiExportModal({ activeFit, slots, drones, cargoItems, fighters, implants, boosters, onClose }) {
  const { characters, activeId, switchActive } = useEsiCharacters();
  const [incCharges, setIncCharges] = useState(true);
  const [incImplants, setIncImplants] = useState(false);
  const [incBoosters, setIncBoosters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const CheckRow = ({ label, val, setVal }) => (
    <div onClick={() => setVal(v => !v)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer" }}>
      <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${val ? C.accent : C.border}`, background: val ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontSize: 12, fontWeight: 700 }}>
        {val ? "✓" : ""}
      </div>
      <span style={{ fontSize: 13, color: C.text }}>{label}</span>
    </div>
  );

  const doExport = async () => {
    if (!activeId || !activeFit?.ship) return;
    setBusy(true); setError(null); setDone(false);
    try {
      const shipTid = tidByName(activeFit.ship);
      const fitting = slotsToEsiFitting(
        shipTid, activeFit.fitName, slots, drones, cargoItems, fighters,
        { includeCharges: incCharges, includeImplants: incImplants, includeBoosters: incBoosters, implants, boosters }
      );
      await esi.createCharacterFitting(activeId, fitting);
      setDone(true);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ width: "100%", boxSizing: "border-box", background: C.surface, borderRadius: "16px 16px 0 0", padding: 20, boxShadow: "0 -8px 32px rgba(0,0,0,.5)" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Export to EVE</div>
        <div style={{ fontSize: 11, color: C.textMute, marginBottom: 12 }}>Saves this fit into the selected character's in-game Fittings.</div>
        {!activeFit?.ship ? (
          <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "16px 0" }}>Open a fit first.</div>
        ) : characters.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMute, textAlign: "center", padding: "16px 0" }}>Connect a character in Settings → ESI first.</div>
        ) : (
          <>
            <CharacterPicker characters={characters} activeId={activeId} onSwitch={switchActive} />
            <CheckRow label="Loaded charges (goes to cargo hold — EVE doesn't save per-module ammo)" val={incCharges} setVal={setIncCharges} />
            <CheckRow label="Implants (as a cargo-hold shopping list)" val={incImplants} setVal={setIncImplants} />
            <CheckRow label="Boosters (as a cargo-hold shopping list)" val={incBoosters} setVal={setIncBoosters} />
            <button onClick={doExport} disabled={busy} style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 10, border: "none", background: done ? C.success : C.accent, color: done ? "#0e0e10" : "#fff", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {done ? "✓ Saved to EVE" : busy ? "Saving…" : "Save to In-Game Fittings"}
            </button>
          </>
        )}
        {error && <div style={{ fontSize: 11, color: C.danger, marginTop: 10 }}>{error}</div>}
        <button onClick={onClose} style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMute, fontSize: 13, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
