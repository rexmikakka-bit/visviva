import { useState, useEffect } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { fmtResource } from '../lib/fmt.js';
import { ESI_SCOPES } from '../esi-config.js';
import { beginLogin, listCharacters, onCharactersChanged, removeCharacter } from '../lib/esi.js';
import { ASSET_SCOPE } from '../lib/abyssal-library.js';
import { forgetCharacterAbyssals } from '../lib/abyssal-store.js';
import { abyssalSourceTree, abyssalBrowseLevel, mergeLinkedCharacters, CHARACTER_SOURCE } from '../lib/abyssal-browser.js';
import { MARKET_SOURCE } from '../lib/variation-items.js';
import { PRICE_MIN, PRICE_STOPS, priceAtStop, stopAtPrice, parsePriceMillions } from '../lib/market-settings.js';

// Settings' switch track and thumb, in the source sheet's compact, borderless row.
function MarketSwitch({label,on,onChange}){
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} onClick={onChange}
    style={{display:'flex',alignItems:'center',gap:12,width:'100%',minHeight:44,padding:'6px 4px',border:0,background:'none',cursor:'pointer'}}>
    <span style={{flex:1,textAlign:'left',fontSize:11,color:C.textMute}}>{label}</span>
    <span aria-hidden="true" style={{flexShrink:0,width:38,height:22,borderRadius:99,background:on?C.accent:C.surfaceAlt,
      border:`1px solid ${on?C.accent:C.borderStrong}`,padding:2,display:'flex',justifyContent:on?'flex-end':'flex-start',alignItems:'center',transition:'background .15s'}}>
      <span style={{width:18,height:18,borderRadius:99,background:on?'#0e0e10':C.textMute}}/>
    </span>
  </button>;
}

// Picking WHICH rolls to compare against. The old version listed every container flat, which is fine
// for one pilot with a hangar and unusable for a player with several characters and years of loot —
// hundreds of rows, no search, no way through them. Containers now nest under their owner and drill
// with `abyssalBrowseLevel`, the same primitive the library screen browses with, so Back and the
// breadcrumb behave the way they already do there.
//
// Search flattens the tree rather than filtering it in place: while you are typing you are looking
// for a container, not navigating to one, and making you drill to a result you can already see would
// be the worse of the two behaviours.
//
// Sources MULTI-select, and picking one no longer closes the sheet: "my hangar and the market" is
// the normal question, and one-at-a-time made answering it a trip through this sheet per half. The
// close button is the only way out, which is also what makes leaving nothing ticked a choice rather
// than an accident.
export function AbyssalSources({records,selection,onChange,onClose,Sheet,market,onMarketChange,onRecordsChange}){
  const [path,setPath]=useState([]),[query,setQuery]=useState('');
  // Linked characters, alongside the ones the saved rolls already name. Kept live because a native
  // login lands via a deep link rather than a page load, so a sheet that was already open when you
  // logged in would otherwise still be showing the list from before.
  const [characters,setCharacters]=useState(listCharacters);
  const [confirmDrop,setConfirmDrop]=useState(''),[loginError,setLoginError]=useState('');
  useEffect(()=>onCharactersChanged(()=>setCharacters(listCharacters())),[]);
  const addCharacter=()=>{setLoginError('');
    beginLogin([...new Set([...ESI_SCOPES,ASSET_SCOPE])]).catch(e=>setLoginError(e.message));};
  // TWO answers, because "disconnect" and "forget what they own" are different sizes of the same
  // gesture and only one of them is reversible. Unlinking drops the ESI session and leaves the rolls:
  // they are a local library that works offline, and a re-login restores everything. Forgetting is
  // the destructive one, offered as its own answer rather than folded into the default, because
  // years of imported loot lost to a mis-tap cannot be scanned back if the hangar has since moved.
  //
  // The node therefore survives an unlink whenever it still has rolls, and `linked` is what changes.
  const disconnect=(id,forget)=>{
    const characterId=Number(id.slice(CHARACTER_SOURCE.length));
    removeCharacter(characterId);   // the character list refreshes off esi.js's change event
    setConfirmDrop('');setPath([]);
    if(forget)forgetCharacterAbyssals(characterId).then(kept=>onRecordsChange?.(kept))
      .catch(e=>setLoginError(e.message));
  };
  // null means "follow the setting". A committed value is never held here, so dragging the slider or
  // reopening the sheet cannot leave a stale number sitting in the field.
  const [priceText,setPriceText]=useState(null);
  const priceField=priceText??(market.maxPrice==null?'':String(market.maxPrice/1_000_000));
  const commitPrice=()=>{
    const next=priceText==null?undefined:parsePriceMillions(priceText);
    if(next!==undefined)onMarketChange({...market,maxPrice:next});
    setPriceText(null);   // unparseable input snaps back to the live setting rather than sticking
  };
  const row={display:'flex',alignItems:'center',gap:12,width:'100%',minHeight:48,padding:'12px 4px',background:'none',border:'none',borderBottom:`1px solid ${C.border}`,fontSize:13,textAlign:'left',cursor:'pointer'};
  const button={padding:'5px 9px',borderRadius:6,border:`1px solid ${C.border}`,background:'none',color:C.textMid,cursor:'pointer',fontSize:11,fontWeight:700};
  const toggle=on=>({...button,background:on?C.accentLight:'none',borderColor:on?C.accentBorder:C.border,color:on?C.accent:C.textMute});
  const heading=text=><div style={{padding:'18px 4px 4px',fontSize:11,fontWeight:700,color:C.textMute}}>{text}</div>;

  const on=id=>selection.includes(id);
  // "My Abyssals" and a named hangar are the SAME axis at two widths, so they displace each other:
  // ticked together, unticking the character would change nothing, and a tick that does nothing is
  // worse than one that is missing. The market is a different axis and coexists with any of them.
  const toggleSource=id=>{
    if(on(id))return onChange(selection.filter(s=>s!==id));
    const keep=id===MARKET_SOURCE?selection
      :id==='owned'?selection.filter(s=>s===MARKET_SOURCE)
      :selection.filter(s=>s!=='owned');
    onChange([...keep,id]);
  };

  const choice=(id,label,subtitle)=><button key={id} aria-pressed={on(id)} onClick={()=>toggleSource(id)} style={{...row,color:on(id)?C.accent:C.text}}>
    <span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{label}{subtitle&&<span style={{display:'block',marginTop:3,fontSize:11,color:C.textMute}}>{subtitle}</span>}</span>
    {on(id)&&<span aria-hidden="true">✓</span>}
  </button>;
  // Three states worth distinguishing, because the fix differs for each: rolls imported (a usable
  // source), linked but never scanned (go and scan), and unlinked with rolls still saved (the
  // comparison works, but it will not pick up anything bought since).
  const groupSubtitle=node=>!node.linked
    ?t({one:'{n} module · not connected',other:'{n} modules · not connected'},{n:node.count})
    :node.count?t({one:'{n} module',other:'{n} modules'},{n:node.count})
    :t('Connected — nothing imported yet');
  // A character row both opens and selects: the chevron drills into its containers, the label picks
  // the whole character. Two targets in one row, so neither needs a second trip through the sheet.
  const group=(node,onOpen)=><div key={node.id} style={{display:'flex',alignItems:'center',borderBottom:`1px solid ${C.border}`}}>
    <button aria-pressed={on(node.id)} onClick={()=>toggleSource(node.id)} style={{...row,borderBottom:'none',color:on(node.id)?C.accent:C.text}}>
      <span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{node.name}
        <span style={{display:'block',marginTop:3,fontSize:11,color:C.textMute}}>{groupSubtitle(node)}</span></span>
      {on(node.id)&&<span aria-hidden="true">✓</span>}
    </button>
    <button aria-label={t('Browse {name}',{name:node.name})} onClick={onOpen}
      style={{width:44,height:44,flexShrink:0,background:'none',border:'none',color:C.textMute,fontSize:18,cursor:'pointer'}}>›</button>
  </div>;

  const tree=mergeLinkedCharacters(abyssalSourceTree(records),characters);
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const {nodes,breadcrumb}=abyssalBrowseLevel(tree,path);
  // The character this level belongs to, or null when the path no longer resolves — which is what
  // `abyssalBrowseLevel` returns after a disconnect removes a node that had no saved rolls.
  const drilled=breadcrumb[0]??null;
  const containers=tree.flatMap(n=>n.children);
  const found=words.length?containers.filter(g=>words.every(w=>`${g.name} ${g.subtitle}`.toLowerCase().includes(w))):[];
  const input={...button,width:'100%',minWidth:0,boxSizing:'border-box',background:C.surface,fontWeight:500,color:C.text,padding:'8px 9px',fontSize:16};

  return <Sheet title={t('Abyssal sources')} onClose={onClose} height="80vh">
    <div style={{padding:'0 16px 16px'}}>
      <input aria-label={t('Search containers')} placeholder={t('Search containers')} style={input} value={query}
        onChange={e=>{setQuery(e.target.value);setPath([]);}}/>

      {/* Unticking the last source is allowed — it is the same statement as turning the triangle off
          and there is no reason to fight it — but an empty compare list with no explanation reads as
          a broken market rather than as this. Said here, where the ticks that caused it are. */}
      {!selection.length&&<p role="status" style={{fontSize:11,color:C.textMute,margin:'10px 4px 0'}}>
        {t('No sources selected — no abyssal rolls will be shown.')}</p>}

      {words.length>0&&<>
        {heading(t('Search results'))}
        {found.map(g=>choice(g.id,g.name,`${g.subtitle} · ${t({one:'{n} module',other:'{n} modules'},{n:g.count})}`))}
        {!found.length&&<p style={{fontSize:12,color:C.textMute}}>{t('No saved modules match this slot or search.')}</p>}
      </>}

      {!words.length&&path.length>0&&<>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0'}}>
          <button onClick={()=>setPath(p=>p.slice(0,-1))} style={{background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:700,cursor:'pointer',padding:0,flexShrink:0}}>‹ {t('Back')}</button>
          <span style={{fontSize:12,color:C.textMute,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{breadcrumb.map(n=>n.name).join(' / ')}</span>
        </div>
        {nodes.map(g=>choice(g.id,g.name,`${g.subtitle} · ${t({one:'{n} module',other:'{n} modules'},{n:g.count})}`))}
        {!nodes.length&&<p style={{fontSize:12,color:C.textMute,margin:'10px 4px'}}>{t('Nothing imported for this character yet.')}</p>}
        {/* Unlinking lives HERE rather than on the row above, for two reasons: the row already has
            two tap targets a fingertip apart, and this level is the one place the sheet is
            unambiguously about a single character. */}
        {drilled&&(drilled.linked||drilled.count>0)&&(confirmDrop===drilled.id
          ?<div style={{padding:'14px 4px 0'}}>
            <p style={{fontSize:11,color:C.textMute,margin:'0 0 8px'}}>
              {drilled.linked
                ?t('Disconnect {name}? Asset scanning stops. Their saved rolls stay unless you also delete them.',{name:drilled.name})
                :t('Delete every saved roll imported from {name}? This cannot be undone.',{name:drilled.name})}</p>
            {/* Stacked, not a row: on a phone three buttons side by side puts a destructive one a
                fingertip from the one that keeps your library. Vertical also lets the dangerous
                answer state its own cost — how many rolls it is about to delete. */}
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8}}>
              {drilled.linked&&<button style={button} onClick={()=>disconnect(drilled.id,false)}>{t('Disconnect, keep rolls')}</button>}
              {drilled.count>0&&<button style={{...button,borderColor:C.danger,color:C.danger}} onClick={()=>disconnect(drilled.id,true)}>
                {t({one:'Delete {n} saved roll',other:'Delete {n} saved rolls'},{n:drilled.count})}</button>}
              <button style={button} onClick={()=>setConfirmDrop('')}>{t('Cancel')}</button>
            </div>
          </div>
          :<div style={{padding:'14px 4px 0'}}>
            <button style={button} onClick={()=>setConfirmDrop(drilled.id)}>
              {drilled.linked?t('Disconnect character'):t('Remove saved rolls')}</button>
          </div>)}
      </>}

      {!words.length&&path.length===0&&<>
        {choice('owned',t('My Abyssals'),t('All saved containers'))}
        {tree.length>0&&heading(t('Characters'))}
        {tree.map(node=>group(node,()=>setPath([node.id])))}
        {!records.length&&!tree.length&&<p style={{fontSize:12,color:C.textMute}}>{t('No saved modules match this slot or search.')}</p>}
        {/* Connecting a character is what makes this list exist at all, so it belongs beside the
            list rather than three screens away in Settings. Same scopes the library screen asks
            for, since an asset scan is the only reason to link a character from here. */}
        <div style={{padding:'10px 4px 0'}}>
          <button style={button} onClick={addCharacter}>+ {t('Add character')}</button>
        </div>
        {loginError&&<p role="alert" style={{fontSize:11,color:C.danger,margin:'8px 4px 0'}}>{loginError}</p>}

        {heading(t('Market'))}
        {choice(MARKET_SOURCE,t('MutaMarket'),
          market.jitaOnly?t('Public contracts at Jita 4-4'):t('Public contracts in The Forge'))}
        <MarketSwitch label={t('Multi-item contracts')} on={market.allContracts}
          onChange={()=>onMarketChange({...market,allContracts:!market.allContracts})}/>
        <MarketSwitch label={t('Auctions')} on={market.showAuctions}
          onChange={()=>onMarketChange({...market,showAuctions:!market.showAuctions})}/>
        <p style={{fontSize:11,color:C.textMute,margin:'6px 4px 0'}}>{t('Auction bids and multi-item totals are labelled separately from module prices.')}</p>
        {/* The ceiling applies only to abyssal listings. */}
        <div style={{padding:'14px 4px 0'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:11,color:C.textMute,marginRight:'auto'}}>{t('Max price')}</span>
            {/* Typed and dragged reach the same values, so either can be the one you use: the field
                is for "exactly 300M", the track is for "somewhere around a billion". 16px because
                anything smaller makes iOS zoom the whole sheet on focus. */}
            <input aria-label={t('Max price in millions of ISK')} placeholder={t('Any')} inputMode="decimal" value={priceField}
              onChange={e=>setPriceText(e.target.value)} onFocus={e=>e.target.select()}
              onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}} onBlur={commitPrice}
              style={{...input,width:96,flexShrink:0,textAlign:'right',fontWeight:700,fontSize:16,padding:'6px 8px'}}/>
            <span style={{fontSize:11,color:C.textMute,whiteSpace:'nowrap'}}>M ISK</span>
          </div>
          <input type="range" min={0} max={PRICE_STOPS} step={1} value={stopAtPrice(market.maxPrice)}
            aria-label={t('Max price')} aria-valuetext={market.maxPrice==null?t('Any'):`${fmtResource(market.maxPrice,3)} ISK`}
            onChange={e=>{setPriceText(null);onMarketChange({...market,maxPrice:priceAtStop(Number(e.target.value))});}}
            style={{width:'100%',marginTop:10,accentColor:C.accent}}/>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.textMute,marginTop:2}}>
            <span>{fmtResource(PRICE_MIN,3)}</span>
            <span>{t('Any')}</span>
          </div>
          {/* The one consequence that is not visible from this sheet. Without it, closing the sheet
              and finding half the stock variants gone reads as a bug rather than as this setting. */}
          <p style={{fontSize:11,color:C.textMute,margin:'6px 0 0'}}>
            {t('Applies to abyssal listings only. Standard modules are always shown regardless of price.')}
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'10px 4px 0'}}>
          <span style={{fontSize:11,color:C.textMute,marginRight:'auto'}}>{t('Location')}</span>
          <button style={toggle(market.jitaOnly)} aria-pressed={market.jitaOnly} onClick={()=>onMarketChange({...market,jitaOnly:true})}>{t('Jita 4-4')}</button>
          <button style={toggle(!market.jitaOnly)} aria-pressed={!market.jitaOnly} onClick={()=>onMarketChange({...market,jitaOnly:false})}>{t('The Forge')}</button>
        </div>
      </>}
    </div>
  </Sheet>;
}
