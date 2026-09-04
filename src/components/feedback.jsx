import { useState } from "react";
import { C } from "../theme.js";
import { useSheetDrag, sheetTransform, SheetGrabber } from "../lib/use-sheet-drag.jsx";
import { fitToEFT } from "../lib/eft-export.js";

const REPO_URL = "https://github.com/rexmikakka-bit/visviva";

// The export sheet's own dump, not a second hand-rolled one: this used to walk the racks itself and
// so silently dropped the drone bay, fighters, cargo, offline modules and abyssal rolls — every one
// of which changes the numbers a report is about. Nothing is opt-out here the way it is in the
// export sheet, since a report benefits from the whole picture.
const reportEFT = (ship, name, fit) =>
  fitToEFT({ ...fit, ship, name: name || "Unnamed" });

// A number can be decided entirely by state that lives OUTSIDE the fit being edited: the system's
// environment, and other pilots' fits projected at it. A report with none of that attached is
// usually unreproducible, and the reporter has no particular reason to suspect a command burst is
// what moved the figure they are reporting.
//
// Referenced fits are dumped IN FULL rather than named. A name means nothing to whoever reads the
// issue — they do not have the reporter's library, and "Guardian — Logi" is not a fit.
function effectsContext(slots, projFits, cmdFits) {
  const entries = [
    ...(cmdFits ?? []).map(c => ({ ...c, kind: "Command link" })),
    ...(projFits ?? []).map(p => ({ ...p, kind: "Projected" })),
  ];
  const nLink = (cmdFits ?? []).length, nProj = (projFits ?? []).length;
  const summary = [
    slots?.environment ? "environment" : null,
    nLink ? `${nLink} link${nLink > 1 ? "s" : ""}` : null,
    nProj ? `${nProj} projected` : null,
  ].filter(Boolean).join(", ");
  return { environment: slots?.environment ?? null, entries, summary };
}

export function FeedbackModal({activeFit, slots, implants, boosters, drones, fighters, cargo,
                               projFits, cmdFits, fitsDB, onClose}) {
  const sheet = useSheetDrag(onClose);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [copied, setCopied] = useState(false);
  const ctx = effectsContext(slots, projFits, cmdFits);
  // One switch for the whole attachment, not one per kind. The projected fits are only ever
  // meaningful ALONGSIDE the fit they are projected at, so a reporter choosing between them is
  // choosing between two halves of the same reproduction.
  const [include, setInclude] = useState(true);
  const canAttach = !!activeFit?.ship || !!ctx.summary;

  const buildBody = ({attachments = true} = {}) => {
    const lines = [
      details.trim() || "(no details provided)",
      "",
      "---",
      `Time: ${new Date().toISOString()}`,
      `Platform: ${navigator.userAgent}`,
    ];
    if (!attachments || !include) return lines.join("\n");
    if (activeFit?.ship) lines.push(
      "", `Fit: ${activeFit.ship} — ${activeFit.fitName}`,
      "```", reportEFT(activeFit.ship, activeFit.fitName, {slots, implants, boosters, drones, fighters, cargo}), "```");
    if (ctx.summary) {
      if (ctx.environment) lines.push("", `Environment: ${ctx.environment}`);
      for (const e of ctx.entries) {
        // `active` is opt-OUT, matching App.jsx. A toggled-off entry is still reported: "I turned it
        // off and it still applied" is exactly the bug this section exists to make visible.
        const off = e.active === false ? " (toggled off)" : "";
        const range = e.rangeKm != null ? ` @ ${e.rangeKm} km` : "";
        lines.push("", `${e.kind}: ${e.ship} — ${e.fitName}${range}${off}`);
        const fit = fitsDB?.[e.ship]?.find(f => f.name === e.fitName);
        if (fit) lines.push("```", reportEFT(e.ship, e.fitName, fit), "```");
        else lines.push("(no longer in the fit library)");
      }
    }
    return lines.join("\n");
  };

  // No bug/idea split: both kinds opened the same issue on the same repo and differed only by
  // label, so the choice asked the reporter to categorise their own report before they had written
  // it — and got it wrong often enough to be worth nothing. Triage reads the text anyway.
  const issueURL = (body) => {
    const params = new URLSearchParams({
      title: title.trim() || "Feedback",
      body,
      labels: "user-report",
    });
    return `${REPO_URL}/issues/new?${params.toString()}`;
  };

  const writeClipboard = (txt, done) => {
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

  const flagCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const copyDetails = () => writeClipboard(`${title.trim() || "(no title)"}\n\n${buildBody()}`, flagCopied);

  // The body is prefilled through a GET, so the whole report has to survive URL encoding — and a
  // newline costs three characters there, so a report carrying a few EFTs inflates well past what
  // GitHub will accept before it answers 414 and the reporter loses everything they typed. Send the
  // prose and the diagnostics, which are what triage reads first, and hand the attachments over via
  // the clipboard rather than silently truncating them.
  const MAX_URL = 6000;
  const openIssue = () => {
    const full = buildBody();
    let body = full;
    if (issueURL(full).length > MAX_URL) {
      body = `${buildBody({attachments: false})}\n\n(The fit and effects context were too long to`
           + ` prefill here. They are on your clipboard — paste them below.)`;
      writeClipboard(full, flagCopied);
    }
    const win = window.open(issueURL(body), "_blank", "noopener,noreferrer");
    if (!win) copyDetails(); // popup blocked — fall back to clipboard so nothing is lost
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={sheet.dismiss}>
      <div ref={sheet.sheetRef} style={{width:"100%",maxHeight:"88vh",boxSizing:"border-box",background:C.surface,borderRadius:"16px 16px 0 0",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 -8px 32px rgba(0,0,0,.5)",...sheetTransform(sheet)}} onClick={e=>e.stopPropagation()}>
        <SheetGrabber grabHandlers={sheet.grabHandlers}/>
        <div style={{overflowY:"auto",padding:"6px 20px 20px"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>Send Feedback</div>
        <div style={{fontSize:11,color:C.textMute,marginBottom:14,lineHeight:1.5}}>
          Opens a pre-filled GitHub issue on Axis's repo. You review it there before it's submitted — nothing is sent automatically.
        </div>

        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder='Short summary, e.g. "RAH split wrong on Astarte"'
          style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,marginBottom:8}}/>

        <textarea value={details} onChange={e=>setDetails(e.target.value)} placeholder="What happened, and what did you expect instead? Ideas and requests are welcome here too." rows={5}
          style={{width:"100%",boxSizing:"border-box",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:13,fontFamily:"inherit",resize:"vertical",marginBottom:10}}/>

        {/* Opt-in, and it names everything it will attach: this posts saved fits verbatim into a
            public issue, including OTHER people's fits that happen to be projected at this one. */}
        {canAttach&&(
          <div onClick={()=>setInclude(v=>!v)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",cursor:"pointer"}}>
            <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${include?C.accent:C.border}`,background:include?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:12,fontWeight:700}}>{include?"✓":""}</div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12,color:C.text}}>
                {activeFit?.ship?<>Include current fit ({activeFit.ship} — {activeFit.fitName})</>:"Include effects context"}
              </div>
              {!!ctx.summary&&activeFit?.ship&&<div style={{fontSize:11,color:C.textMute,marginTop:2}}>with {ctx.summary}</div>}
            </div>
          </div>
        )}

        <button onClick={openIssue} style={{width:"100%",marginTop:14,padding:14,borderRadius:10,border:"none",background:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
          Open GitHub Issue
        </button>
        <button onClick={copyDetails} style={{width:"100%",marginTop:8,padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.textMid,fontSize:12,cursor:"pointer"}}>
          {copied ? "✓ Copied — paste anywhere" : "Copy report to clipboard instead"}
        </button>
        <button onClick={sheet.dismiss} style={{width:"100%",marginTop:8,padding:10,borderRadius:10,border:"none",background:"transparent",color:C.textMute,fontSize:12,cursor:"pointer"}}>
          Cancel
        </button>
        </div>
      </div>
    </div>
  );
}
