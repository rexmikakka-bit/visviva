import { useEffect, useRef, useState } from "react";
import marketTreeData from "../data/market-tree.json";
import { C } from "../theme.js";
import { eveIcon } from "../lib/icons.js";
import { BottomSheet, ItemDetailSheet, NumpadModal, SheetSearchBar, useSuppressAccessoryBar } from "./ui.jsx";
import { MT_ALL_ITEMS, MT_CHARGE_GROUPS, MT_CHARGE_ITEMS, MT_CHILDREN, MT_ITEMS, MT_ROOTS, cargoUnitVolume, cargoVolume, getCompatibleCharges, haptic, isChargeType } from "../lib/core.js";
import { TYPES, tidByName } from "../calc.js";
import { nameMatchesQuery } from "../lib/jargon.js";
import { useSwipeBack } from "../lib/use-swipe-back.js";
import { t } from "../lib/i18n.js";

// Module scope, NOT nested inside CargoBrowserSheet — see the ModRow note in ui.jsx. A component
// declared inside another component is a fresh function identity every render, so React rebuilds
// every row's DOM whenever the browser re-renders. Tapping a row with the keyboard up blurs the
// search input, which re-renders the sheet BETWEEN touchstart and click, and the click lands on a
// node that no longer exists. That cost the module browser its whole first tap.
function ItemRow({item,onAdd}){
  return(<div onClick={()=>{onAdd({name:item.name,vol:item.vol??0,typeID:item.typeID});}}
    style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
    <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      {item.typeID?<img className="eve-icon" src={eveIcon(item.typeID,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>{item.icon||"?"}</span>}
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div>
      <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{item.vol!=null?`${item.vol} m3`:""}{item.forMod?` - ${t("fits {mod}",{mod:item.forMod})}`:""}</div>
    </div>
    <span style={{fontSize:11,color:C.accent,fontWeight:700,flexShrink:0}}>+ {t("Add")}</span>
  </div>);
}
function GroupRow({gid,onOpen,chargesOnly}){
  const g=marketTreeData.g[gid];
  // Counted through the same filter the row opens into, or the subtitle promises 16 groups and
  // delivers two.
  const nSub=(MT_CHILDREN[gid]??[]).filter(c=>!chargesOnly||MT_CHARGE_GROUPS.has(c)).length;
  const nItems=((chargesOnly?MT_CHARGE_ITEMS[gid]:MT_ITEMS[gid])??[]).length;
  return(<div onClick={()=>onOpen(gid)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
    <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      {g.i?<img className="eve-icon" src={eveIcon(g.i,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:null}
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13,fontWeight:600,color:C.text}}>{g.n}</div>
      <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{nSub>0?t({one:"{n} group",other:"{n} groups"},{n:nSub}):t({one:"{n} item",other:"{n} items"},{n:nItems})}</div>
    </div>
    <span style={{fontSize:18,color:C.textMute,flexShrink:0}}>{">"}</span>
  </div>);
}

// Same 24px tick the drone and fighter rows use, shrunk one step because two of these share a row.
function FilterCheck({on,muted,label,onClick}){
  return(<button className="press" onClick={onClick} aria-pressed={on}
    style={{flex:1,display:"flex",alignItems:"center",gap:7,padding:"7px 9px",background:on?C.accentLight:"none",border:`1px solid ${on?C.accentBorder:C.border}`,borderRadius:8,cursor:"pointer",textAlign:"left",opacity:on||!muted?1:.55}}>
    <span style={{width:18,height:18,flexShrink:0,borderRadius:4,background:on?C.accent:"none",border:`1px solid ${on?C.accent:C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,lineHeight:1,color:"#fff"}}>{on?"✓":""}</span>
    <span style={{fontSize:11,fontWeight:700,color:on?C.accent:C.textMid}}>{label}</span>
  </button>);
}

export function CargoBrowserSheet({onAdd,onClose,slots,justAdded}){
  const[search,setSearch]=useState("");
  const[path,setPath]=useState([]);
  // Two filters rather than the one "Charges for Active Fit" jump this replaces. That button only
  // existed at the root and dropped you into a flat list you had to leave to browse again, so it
  // could not answer "cap booster charges I have no cap booster fitted for yet", which is most of
  // what a cargo bay is. These stay on across browsing and search, and the fit filter is a NARROWING
  // of the charge filter — the two can't disagree, so toggling either one keeps that invariant.
  const[chargesOnly,setChargesOnly]=useState(false);
  const[fitCharges,setFitCharges]=useState(false);
  // Safe here for the same reason it is in the module browser: the search box is this sheet's only
  // focusable field, so nothing else loses its stock Done/chevron while the sheet is open.
  const searchInputRef=useRef(null);
  const[searchFocused,setSearchFocused]=useState(false);
  useSuppressAccessoryBar();
  const cur=path.length?path[path.length-1]:null;
  const subGroups=(cur==null?MT_ROOTS:(MT_CHILDREN[cur]??[])).filter(g=>!chargesOnly||MT_CHARGE_GROUPS.has(g));
  const items=cur==null?[]:((chargesOnly?MT_CHARGE_ITEMS[cur]:MT_ITEMS[cur])??[]);
  const crumb=path.map(g=>marketTreeData.g[g]?.n).filter(Boolean).join(" > ");

  const fitChargeList=(()=>{
    if(!fitCharges||!slots)return null;
    const seen=new Map();
    for(const sec of ["high","mid","low"]){
      for(const m of (slots[sec]??[])){
        if(m.type==="empty"||!m.name)continue;
        for(const c of getCompatibleCharges(m)){
          if(!seen.has(c.name)){
            const mt=marketTreeData.t[c.typeID];
            seen.set(c.name,{typeID:c.typeID,name:c.name,vol:c.volume??mt?.[2]??0.01,forMod:m.name});
          }
        }
      }
    }
    return Array.from(seen.values()).sort((a,b)=>a.name.localeCompare(b.name));
  })();

  // Per-token, like the module browser: a raw substring needs the punctuation and word order typed
  // exactly, so "navy antimatter s" and "ec 300" both found nothing.
  //
  // Searches the filtered set, not the whole market: a filter you have to remember to turn off
  // before typing is worse than no filter, and searching within the fit's own charges is how you
  // pick one ammo type out of the forty a full rack offers.
  const searchPool=fitCharges?(fitChargeList??[]):MT_ALL_ITEMS;
  const searchResults=search.trim().length>1
    ?searchPool.filter(i=>(fitCharges||!chargesOnly||isChargeType(i.typeID))&&nameMatchesQuery(i.name,search)).slice(0,60)
    :null;

  const openGroup=gid=>setPath(p=>[...p,gid]);
  // Gated on the same condition that renders the breadcrumb's Back arrow below, so the button, the
  // hardware Back and the swipe always agree on whether there is a level to leave. Behind a search or
  // the flat "for active fit" list there is no visible path, so Back belongs to the sheet's dismiss.
  const canGoUp=!searchResults&&!fitCharges&&path.length>0;
  const goUp=()=>{haptic();setPath(p=>p.slice(0,-1));};
  const backSwipe=useSwipeBack(goUp,canGoUp);
  // Turning the charge filter on inside a branch with no charges in it would leave an empty list and
  // a breadcrumb pointing at somewhere you can no longer be. Back out to the deepest ancestor that
  // survives the filter instead, which is a no-op when you were already somewhere charges live.
  const applyChargesOnly=on=>{
    setChargesOnly(on);
    if(!on){setFitCharges(false);return;}
    setPath(p=>{const out=[...p];while(out.length&&!MT_CHARGE_GROUPS.has(out[out.length-1]))out.pop();return out;});
  };

  // 100vh rather than 86vh, for the same reason the module browser uses it: with fillHeight the
  // box is min(height,100%) where 100% is the keyboard-shrunk frame, so at 86vh the sheet rests
  // with a peek gap below the status bar and then snaps its TOP upward the instant the keyboard
  // pushes the frame under 86vh. 100vh asks BottomSheet for a peek that no keyboard can move.
  return(<BottomSheet title={t("Add Cargo")} onClose={onClose} height="100vh" fillHeight
    headerExtra={
      // In the header, not the scroller, so the filters stay reachable at any depth and through a
      // search — the button they replace was only rendered at the root.
      <>
        <div style={{display:"flex",gap:8,padding:"8px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
          <FilterCheck on={chargesOnly} label={t("Charges only")}
            onClick={()=>{haptic("light");applyChargesOnly(!chargesOnly);}}/>
          {/* Muted rather than disabled while the charge filter is off: it is still the fastest way
              in, so tapping it turns both on rather than doing nothing and making you tap twice. */}
          <FilterCheck on={fitCharges} muted={!chargesOnly} label={t("For active fit")}
            onClick={()=>{haptic("light");const next=!fitCharges;setFitCharges(next);if(next)applyChargesOnly(true);}}/>
        </div>
        {/* height:0 so this overlays the top of the list instead of reserving a strip that is empty
            almost all the time. Header rather than inside the scroller for the same reason the module
            browser's toast is: content here needs no scroll-relative positioning. */}
        <div style={{position:"relative",height:0}}>
          {justAdded&&<div key={justAdded.key} className="vv-in" style={{position:"absolute",top:8,right:10,zIndex:20,background:C.accent,color:"#fff",fontSize:11,fontWeight:700,padding:"5px 10px",borderRadius:99,boxShadow:"0 2px 8px rgba(0,0,0,.35)",pointerEvents:"none",maxWidth:"65%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>+ {justAdded.name} (x{justAdded.count.toLocaleString()})</div>}
        </div>
      </>
    }
    footerExtra={
      // Footer, not top-of-sheet: cargo is a multi-add browser — you stay in it stacking ammo and
      // spares — so the keyboard is up while you are reading results, and a top search box wastes
      // the whole tall half of the sheet above a short result list. Drone and fighter browsers
      // close on the first pick and deliberately keep their search at the top instead.
      <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`}}>
        <SheetSearchBar value={search} onChange={setSearch} placeholder={t("Search market...")}
          inputRef={searchInputRef} onDismiss={searchFocused?()=>searchInputRef.current?.blur():null}
          inputProps={{onFocus:()=>setSearchFocused(true),onBlur:()=>setSearchFocused(false)}}/>
      </div>
    }>
    {/* The whole body, so the back-swipe is available over the list and the breadcrumb alike rather
        than only where a row happens to be. */}
    <div {...backSwipe}>
    {/* Sticky, because these now live inside the sheet's own scroller: this used to be a fixed
        header above a NESTED scroller, which meant BottomSheet's onScroll={dismissKeyboardOnScroll}
        never fired here and scrolling the cargo list could not dismiss the keyboard at all. */}
    {canGoUp&&(
      <div style={{position:"sticky",top:0,zIndex:3,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={goUp} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:0}}>&laquo; {t("Back")}</button>
        <span style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{crumb}</span>
      </div>
    )}
    {searchResults?(
      <div>{searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>{t("No items found")}</div>}{searchResults.map(item=><ItemRow key={item.typeID} item={item} onAdd={onAdd}/>)}</div>
    ):fitCharges?(
      <div>{(fitChargeList??[]).length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:12}}>{t("No charge-compatible modules fitted")}</div>}{(fitChargeList??[]).map(item=><ItemRow key={item.typeID??item.name} item={item} onAdd={onAdd}/>)}</div>
    ):(
      <div>
        {subGroups.map(gid=><GroupRow key={gid} gid={gid} onOpen={openGroup} chargesOnly={chargesOnly}/>)}
        {items.map(item=><ItemRow key={item.typeID} item={item} onAdd={onAdd}/>)}
      </div>
    )}
    </div>
  </BottomSheet>);
}

export function CargoScreen({items,setItems,shipCapacity=1150,slots}){
  const[numpad,setNumpad]=useState(null);
  const[info,setInfo]=useState(null);
  const[showCargoPicker,setShowCargoPicker]=useState(false);
  // Confirmation for adds made from the browser, which stays open behind the numpad — so the toast
  // fires when the numpad goes away rather than when the item lands, or it would be covered by it.
  // Only for browser adds: "tap to edit" on a cargo row opens the same numpad, but that is editing
  // rather than adding, and the browser is closed then so there is nothing to show it on.
  const[justAdded,setJustAdded]=useState(null);
  useEffect(()=>{
    if(!justAdded)return;
    const timer=setTimeout(()=>setJustAdded(null),1100);
    return ()=>clearTimeout(timer);
  },[justAdded]);
  // NumpadModal's Confirm calls onConfirm and then onClose in the same handler, so onClose cannot
  // read the new quantity out of `items` yet — this carries it across those two calls. Null when
  // the numpad was dismissed without confirming, in which case the quantity addItem set still stands.
  const confirmedQty=useRef(null);
  const volOf=cargoUnitVolume;
  const used=cargoVolume(items);
  const totalVol=used.toFixed(1);
  const cap=Math.round(shipCapacity||0);
  const free=cap-used;
  const over=free<0;
  // Which figure matters flips with what you are doing: used volume while you load, remaining volume
  // while you decide whether one more thing fits. Not persisted — the screen unmounts with the tab,
  // and used/capacity is the right thing to come back to.
  const[showFree,setShowFree]=useState(false);
  const addItem=item=>{
    const ex=items.find(e=>e.name===item.name);
    if(ex){setItems(items.map(e=>e.name===item.name?{...e,qty:e.qty+1}:e));setNumpad({...ex,qty:ex.qty+1,fromAdd:true});return;}
    const ni={id:Date.now(),name:item.name,qty:1,vol:item.vol??volOf(item),icon:item.icon,typeID:item.typeID};
    setItems(prev=>[...prev,ni]);
    setNumpad({...ni,fromAdd:true});
  };
  const closeNumpad=()=>{
    if(numpad?.fromAdd)setJustAdded({name:numpad.name,count:confirmedQty.current??numpad.qty,key:Date.now()});
    confirmedQty.current=null;
    setNumpad(null);
  };
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      {/* Same treatment as the drone bay readouts and the fitting strip: used volume at full text
          colour, capacity one step back in both colour AND size, tabular-nums, and red once you are
          over. This was 11px at textMute, which is the figure you are actually watching while
          loading cargo. The capacity is a fixed property of the hull — it is context for the number
          that moves, so it should not compete with it at the same size. */}
      {/* Both modes keep the same two-tone shape so the strip does not reflow on tap, and the number
          stays red when over capacity — in free mode that reads as how much has to come back out. */}
      <button className="press" onClick={()=>{haptic();setShowFree(v=>!v);}}
        title={showFree?t("Show used space"):t("Show remaining space")}
        style={{display:"flex",alignItems:"baseline",background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
        <span style={{fontSize:12,fontWeight:700,color:C.text}}>{t("Cargo Bay")}</span>
        <span style={{fontSize:12,marginLeft:8,fontVariantNumeric:"tabular-nums"}}>
          <span style={{fontWeight:700,color:over?C.danger:C.text}}>{showFree?Math.abs(free).toFixed(1):totalVol}</span>
          <span style={{fontSize:10,color:C.textMid}}>{showFree?` ${over?t("m³ over"):t("m³ free")}`:`/${cap.toLocaleString()} m³`}</span>
        </span>
      </button>
      <button className="press" onClick={()=>{haptic();setShowCargoPicker(true);}} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ {t("Add")}</button>
    </div>
    <div style={{height:3,background:C.border}}><div style={{width:`${cap>0?Math.min((used/cap)*100,100):0}%`,height:"100%",background:over?C.danger:C.accent}}/></div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {items.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>{t("Cargo bay is empty")}</div>}
      {items.map(item=>{
        // Resolved once for the row: the icon needs it, and so does the info sheet, which the card
        // won't open without one — an item whose name we can't resolve has nothing to show.
        const tid=item.typeID??tidByName(item.name);
        // The whole card is the info target, so the two controls sitting on it have to stop the
        // click reaching the card — otherwise editing a quantity or removing an item also opens
        // the sheet behind whatever it did.
        return(<div key={item.id} onClick={tid?()=>{haptic();setInfo({typeID:tid,name:item.name});}:undefined}
          style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6,cursor:tid?"pointer":"default"}}>
          <div style={{width:32,height:32,borderRadius:7,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,overflow:"hidden"}}>{tid?<img className="eve-icon" src={eveIcon(tid,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>📦</span>}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{(item.qty*volOf(item)).toFixed(1)} m3</div></div>
          <button className="press" onClick={e=>{e.stopPropagation();haptic();setNumpad(item);}} style={{display:"flex",flexDirection:"column",alignItems:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"5px 10px",cursor:"pointer"}}>
            <span style={{fontSize:14,fontWeight:800,color:C.text}}>{item.qty.toLocaleString()}</span>
            <span style={{fontSize:8,color:C.textMute,marginTop:1}}>{t("tap to edit")}</span>
          </button>
          {/* There was no way to take anything back OUT of the cargo bay. */}
          <button className="press" onClick={e=>{e.stopPropagation();haptic("heavy");setItems(items.filter(i=>i.id!==item.id));}} aria-label={t("Remove {name}",{name:item.name})} title={t("Remove from cargo")}
            style={{width:28,height:28,flexShrink:0,borderRadius:7,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",color:C.danger,fontSize:16,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>&times;</button>
        </div>);
      })}
    </div>
    {numpad&&(()=>{
      const unitVol=volOf(numpad);
      const otherVol=items.filter(i=>i.id!==numpad.id).reduce((s,i)=>s+i.qty*volOf(i),0);
      const fillMax=unitVol>0?Math.max(0,Math.floor((cap-otherVol)/unitVol)):null;
      return <NumpadModal label={numpad.name} initial={numpad.qty} fillMax={fillMax}
        onConfirm={qty=>{confirmedQty.current=qty;setItems(items.map(i=>i.id===numpad.id?{...i,qty}:i));}}
        onClose={closeNumpad}/>;
    })()}
    {showCargoPicker&&<CargoBrowserSheet slots={slots} onAdd={addItem} justAdded={justAdded} onClose={()=>setShowCargoPicker(false)}/>}
    {/* No onSwap: the Variations tab still lists the family, which for the ammo that fills most
        cargo bays is the useful part, but swapping what is in the bay is the browser's job. */}
    {info&&<ItemDetailSheet typeID={info.typeID} name={info.name} onClose={()=>setInfo(null)}/>}
  </div>);
}
