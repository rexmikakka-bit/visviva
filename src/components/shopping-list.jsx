import { useEffect, useRef, useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { fmtResource } from '../lib/fmt.js';
import { ESI_SCOPES } from '../esi-config.js';
import { beginLogin, listCharacters, onCharactersChanged, openContractWindow, UI_SCOPE } from '../lib/esi.js';
import { readAbyssals, readListings } from '../lib/abyssal-store.js';
import { shoppingList, BUYABLE, OWNED, EXPIRED } from '../lib/shopping-list.js';
import { contractLinkList, stationSystems } from '../lib/contract-links.js';
import { useOnline } from '../lib/use-online.js';
import { mutaMarketUrl, JITA_4_4_STATION_ID } from '../lib/mutamarket.js';
import { useSheetDrag, sheetTransform, SheetGrabber } from '../lib/use-sheet-drag.jsx';

// Everything in the fit you would still have to BUY, with the contract attached. The fit itself only
// remembers an item id, so this screen is the join between that and the listing cache — see
// lib/shopping-list.js for why the failed joins (owned / unknown / expired) each get a row instead of
// being dropped.
//
// Two ways out of every buyable row, because neither works everywhere: the ESI window call drives a
// RUNNING game client, so it does nothing on a phone with no EVE open, and the MutaMarket page is a
// web page, which is all you have when no character has granted the scope.
const SLOT_LABEL={high:'High',mid:'Mid',low:'Low',rigs:'Rig',services:'Service'};

// `expiresAt` is already parsed to ms by shoppingList, so a null here means the contract carried no
// expiry — which is not the same as expiring now and must not round to "0 days left".
const days=expiresAt=>expiresAt==null?null:Math.floor((expiresAt-Date.now())/86400000);

function openUrl(url){
  if(typeof window!=='undefined'&&window.Capacitor?.isNativePlatform?.())
    return import('@capacitor/browser').then(({Browser})=>Browser.open({url}));
  window.open(url,'_blank','noopener,noreferrer');
  return Promise.resolve();
}

export function ShoppingListSheet({slots,onClose}){
  const online=useOnline();
  const sheet=useSheetDrag(onClose);
  const [listings,setListings]=useState([]),[owned,setOwned]=useState([]);
  const [characters,setCharacters]=useState(listCharacters),[characterId,setCharacterId]=useState('');
  const [error,setError]=useState(''),[opened,setOpened]=useState({}),[copied,setCopied]=useState(false);
  const [systems,setSystems]=useState(new Map()),[resolving,setResolving]=useState(false);
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    Promise.all([readListings(),readAbyssals()])
      .then(([l,o])=>{if(mounted.current){setListings(l);setOwned(o);}})
      .catch(e=>{if(mounted.current)setError(e.message);});
    const off=onCharactersChanged(()=>setCharacters(listCharacters()));
    return()=>{mounted.current=false;off();};
  },[]);

  const character=characters.find(c=>String(c.characterId)===characterId)??characters[0];
  const allowed=character?.scopes?.includes(UI_SCOPE);
  const {rows,total,buyable,owned:ownedCount,unresolved}=shoppingList(slots,listings,{owned});
  // Buyable first: it is the only group that is a to-do list. The rest are there so the screen is
  // honest about what it could not price, not because you are meant to act on them.
  const order={[BUYABLE]:0,[OWNED]:1,[EXPIRED]:2};
  const sorted=[...rows].sort((a,b)=>(order[a.state]??3)-(order[b.state]??3));
  const stationKey=[...new Set(rows.filter(r=>r.state===BUYABLE&&r.stationId!=null).map(r=>r.stationId))].sort().join(',');
  useEffect(()=>{
    let active=true;setResolving(true);
    stationSystems(stationKey?stationKey.split(','):[]).then(result=>{if(active){setSystems(result.systems);setResolving(false);}})
      .catch(e=>{if(active){setError(e.message);setResolving(false);}});
    return()=>{active=false;};
  },[stationKey,online]);
  const contractExport=contractLinkList(sorted,systems);

  const openInEve=async row=>{
    setError('');
    try{
      await openContractWindow(character.characterId,row.contractId);
      // 204 means ESI accepted it, NOT that a window appeared — the character may simply not be
      // logged in. Say what was asked for rather than claiming it worked.
      setOpened(o=>({...o,[row.itemId]:true}));
    }catch(e){setError(e.message);}
  };

  const copyList=(text=contractExport.text,key='all')=>{
    if(!text)return;
    const done=()=>{setCopied(key);setTimeout(()=>{if(mounted.current)setCopied(false);},2000);};
    // Same two-step as ExportFitModal: navigator.clipboard needs a secure context, which the file://
    // origin an unpackaged build can end up on is not.
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(text).then(done).catch(e=>setError(e.message));
    else{
      const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);
          ta.select();const ok=document.execCommand('copy');document.body.removeChild(ta);if(ok)done();else setError(t('Copy failed. Try again.'));
    }
  };

  const button={padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,background:'none',color:C.textMid,cursor:'pointer',fontSize:11,fontWeight:700};
  const primary={...button,borderColor:C.accentBorder,background:C.accentLight,color:C.accent};
  const badge=(text,color)=><span style={{fontSize:10,fontWeight:700,color,border:`1px solid ${color}55`,borderRadius:5,padding:'1px 5px',flexShrink:0}}>{text}</span>;

  return <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={sheet.dismiss}>
    <div ref={sheet.sheetRef} style={{width:'100%',maxHeight:'80vh',boxSizing:'border-box',display:'flex',flexDirection:'column',background:C.surface,borderRadius:'16px 16px 0 0',boxShadow:'0 -8px 32px rgba(0,0,0,.5)',...sheetTransform(sheet)}} onClick={e=>e.stopPropagation()}>
      <SheetGrabber grabHandlers={sheet.grabHandlers}/>
      <div style={{padding:'0 20px'}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text}}>{t('Shopping list')}</div>
        <div style={{fontSize:11,color:C.textMute,marginTop:2}}>
          {buyable
            ?t({one:'{n} module to buy · {isk} ISK',other:'{n} modules to buy · {isk} ISK'},{n:buyable,isk:fmtResource(total,4)})
            :t('Nothing in this fit needs buying.')}
          {ownedCount>0&&` · ${rows.some(row=>row.custom)?t('{n} in your collection',{n:ownedCount}):t('{n} already owned',{n:ownedCount})}`}
          {unresolved>0&&` · ${t('{n} without a live contract',{n:unresolved})}`}
        </div>
      </div>

      <div style={{flex:1,minHeight:0,overflowY:'auto',padding:'12px 20px 0'}}>
        {!online&&<p role="status" style={{fontSize:11,color:C.textMute}}>{t('Offline · showing saved details. Contract availability may have changed.')}</p>}
        {!rows.length&&<p style={{fontSize:12,color:C.textMute}}>
          {t('This fit has no abyssal modules. Pick one from MutaMarket in the Variations tab and it will show up here with its contract.')}
        </p>}
        {sorted.map(row=>{
          const url=mutaMarketUrl(row.slug);
          return <div key={row.itemId} style={{padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:'flex',alignItems:'baseline',gap:8}}>
              <span style={{flex:1,minWidth:0,fontSize:13,color:C.text,overflowWrap:'anywhere'}}>{row.name??t('Unknown module')}</span>
              {row.price!=null&&<span style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0}}>{fmtResource(row.price,4)}</span>}
              {row.state===OWNED&&badge(row.custom?t('Custom'):t('Owned'),C.success)}
              {row.state===EXPIRED&&badge(t('Expired'),C.danger)}
            </div>
            <div style={{fontSize:10,color:C.textMute,marginTop:2,overflowWrap:'anywhere'}}>
              {SLOT_LABEL[row.slot]??row.slot}
              {row.sellerName&&` · ${row.sellerName}`}
              {row.stationId===JITA_4_4_STATION_ID&&` · ${t('Jita 4-4')}`}
              {row.state===OWNED&&` · ${row.custom?t('Saved locally'):t('Already in your hangar')}`}
              {/* The one number that decides whether this list is still worth acting on tomorrow.
                  A row you saved a week ago looks identical without it. */}
              {row.state===BUYABLE&&days(row.expiresAt)!=null&&(days(row.expiresAt)<=0
                ?<span style={{color:C.warning}}> · {t('Expires today')}</span>
                :<span> · {t({one:'{n} day left',other:'{n} days left'},{n:days(row.expiresAt)})}</span>)}
              {/* An unknown row is the one case a user can DO something about, and the something is
                  not obvious: the listing cache only remembers modules picked from the market. */}
              {row.state!==OWNED&&row.state!==EXPIRED&&row.contractId==null&&` · ${t('No saved contract for this module')}`}
            </div>
            {row.state===BUYABLE&&<div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
              <button style={button} disabled={resolving||!contractLinkList([row],systems).count}
                onClick={()=>copyList(contractLinkList([row],systems).text,row.itemId)}>
                {copied===row.itemId?t('Copied!'):t('Copy EVE contract link')}</button>
              {allowed&&<button style={primary} disabled={!online} onClick={()=>openInEve(row)}>
                {opened[row.itemId]?t('Sent to EVE'):t('Open in EVE')}</button>}
              {url&&<button style={button} disabled={!online} onClick={()=>openUrl(url).catch(e=>setError(e.message))}>{t('View on MutaMarket')}</button>}
            </div>}
            {row.state===EXPIRED&&url&&<div style={{marginTop:8}}>
              <button style={button} disabled={!online} onClick={()=>openUrl(url).catch(e=>setError(e.message))}>{t('View on MutaMarket')}</button></div>}
          </div>;
        })}
      </div>

      <div style={{padding:'12px 20px 20px',borderTop:`1px solid ${C.border}`}}>
        {error&&<p role="alert" style={{fontSize:11,color:C.danger,margin:'0 0 8px'}}>{error}</p>}
        {/* The contract window is opened in the client a CHARACTER is logged into, so it needs a
            character even though nothing here is read from ESI. Asking for the scope is deferred to
            this screen for the same reason asset access is: most people never buy through the app. */}
        {!!buyable&&!allowed&&<button style={{...button,width:'100%',marginBottom:8}}
          onClick={()=>beginLogin([...new Set([...ESI_SCOPES,UI_SCOPE,...(character?.scopes??[])])])}>
          {characters.length?t('Connect with contract access'):t('Link an EVE character')}</button>}
        {allowed&&characters.length>1&&<select aria-label={t('Character')} value={String(character?.characterId??'')}
          onChange={e=>setCharacterId(e.target.value)}
          style={{...button,width:'100%',boxSizing:'border-box',marginBottom:8,fontWeight:500,color:C.text,background:C.surfaceAlt}}>
          {characters.map(c=><option key={c.characterId} value={String(c.characterId)}>{c.characterName}</option>)}
        </select>}
        {!!buyable&&<>
          <button style={{...button,width:'100%',marginBottom:8}} disabled={resolving||!contractExport.count} onClick={()=>copyList()}>
            {copied==='all'?t('Copied to clipboard!'):resolving?t('Resolving contract locations…'):t('Copy EVE contract links')}</button>
          {!resolving&&contractExport.unresolved>0&&<p style={{fontSize:11,color:C.warning}}>{t('{n} contracts omitted: solar system could not be resolved.',{n:contractExport.unresolved})}</p>}
        </>}
        <button onClick={sheet.dismiss} style={{width:'100%',padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          {t('Close')}
        </button>
      </div>
    </div>
  </div>;
}
