import { useState } from "react";
import { C } from "../theme.js";

const REPO_URL = "https://github.com/rexmikakka-bit/visviva";

// A slimmed-down EFT dump for diagnostic context — always includes charges/implants/boosters
// (unlike ExportFitModal's user-toggleable export) since a bug report benefits from the full picture.
function fitAsEFT(activeFit, slots, implants, boosters) {
  if (!activeFit?.ship) return null;
  const lines = [`[${activeFit.ship}, ${activeFit.fitName ?? "Unnamed"}]`];
  for (const sec of ["high", "mid", "low", "rigs"]) {
    for (const slot of (slots?.[sec] ?? [])) {
      if (!slot.typeID) { lines.push(""); continue; }
      lines.push(slot.ammo ? `${slot.name}, ${slot.ammo}` : slot.name);
    }
    if (sec !== "rigs") lines.push("");
  }
  const filledImplants = (implants ?? []).filter(i => i.name && i.name !== "[Empty]");
  if (filledImplants.length) { lines.push(""); for (const imp of filledImplants) lines.push(imp.name); }
  if (boosters?.length) { lines.push(""); for (const b of boosters) lines.push(b.name ?? ""); }
  return lines.join("\n");
}

export function FeedbackModal({activeFit, slots, implants, boosters, onClose}) {
  const [kind, setKind] = useState("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [includeFit, setIncludeFit] = useState(!!activeFit?.ship);
  const [copied, setCopied] = useState(false);

  const buildBody = () => {
    const eft = includeFit ? fitAsEFT(activeFit, slots, implants, boosters) : null;
    const lines = [
      details.trim() || "(no details provided)",
      "",
      "---",
      `Time: ${new Date().toISOString()}`,
      `Platform: ${navigator.userAgent}`,
    ];
    if (eft) lines.push("", `Fit: ${activeFit.ship} — ${activeFit.fitName}`, "```", eft, "```");
    return lines.join("\n");
  };

  const issueURL = () => {
    const params = new URLSearchParams({
      title: title.trim() || (kind === "bug" ? "Bug report" : "Feedback"),
      body: buildBody(),
      labels: kind === "bug" ? "bug,user-report" : "enhancement,user-report",
    });
    return `${REPO_URL}/issues/new?${params.toString()}`;
  };

  const copyDetails = () => {
    const txt = `${title.trim() || "(no title)"}\n\n${buildBody()}`;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(done).catch(() => {
        const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta); done();
      });
    } else {
      const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta); done();
    }
  };

  const openIssue = () => {
    const win = window.open(issueURL(), "_blank", "noopener,noreferrer");
    if (!win) copyDetails(); // popup blocked — fall back to clipboard so nothing is lost
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={onClose}>
      <div style={{width:"100%",maxHeight:"88vh",overflowY:"auto",boxSizing:"border-box",background:C.surface,borderRadius:"16px 16px 0 0",padding:20,boxShadow:"0 -8px 32px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>Send Feedback</div>
        <div style={{fontSize:11,color:C.textMute,marginBottom:14,lineHeight:1.5}}>
          Opens a pre-filled GitHub issue on VisViva's repo. You review it there before it's submitted — nothing is sent automatically.
        </div>

        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {["bug","idea"].map(k=>(
            <button key={k} onClick={()=>setKind(k)} style={{flex:1,padding:"9px 0",borderRadius:8,border:`1px solid ${kind===k?C.accentBorder:C.border}`,background:kind===k?C.accentLight:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,color:kind===k?C.accent:C.textMid}}>
              {k==="bug"?"\u{1F41E} Bug":"\u{1F4A1} Idea"}
            </button>
          ))}
        </div>

        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder={kind==="bug"?'Short summary, e.g. "RAH split wrong on Astarte"':"Short summary of your idea"}
          style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,marginBottom:8}}/>

        <textarea value={details} onChange={e=>setDetails(e.target.value)} placeholder="What happened? What did you expect instead?" rows={5}
          style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"inherit",resize:"vertical",marginBottom:10}}/>

        {activeFit?.ship&&(
          <div onClick={()=>setIncludeFit(v=>!v)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",cursor:"pointer"}}>
            <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${includeFit?C.accent:C.border}`,background:includeFit?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:12,fontWeight:700}}>{includeFit?"✓":""}</div>
            <span style={{fontSize:12,color:C.text}}>Include current fit ({activeFit.ship} — {activeFit.fitName})</span>
          </div>
        )}

        <button onClick={openIssue} style={{width:"100%",marginTop:14,padding:14,borderRadius:10,border:"none",background:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
          Open GitHub Issue
        </button>
        <button onClick={copyDetails} style={{width:"100%",marginTop:8,padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.textMid,fontSize:12,cursor:"pointer"}}>
          {copied ? "✓ Copied — paste anywhere" : "Copy report to clipboard instead"}
        </button>
        <button onClick={onClose} style={{width:"100%",marginTop:8,padding:10,borderRadius:10,border:"none",background:"transparent",color:C.textMute,fontSize:12,cursor:"pointer"}}>
          Cancel
        </button>
      </div>
    </div>
  );
}
