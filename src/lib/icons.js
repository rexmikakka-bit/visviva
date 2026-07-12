import TYPE_ICONS from "../data/type-icons.json";

// Icon resolution — offline first. Pyfa bundles item icons by iconID and ship images by
// typeID under pyfa-master/imgs/. Vite globs whatever is present (eager URL imports), so the
// build only ever references files that exist; anything missing falls back to the EVE image
// server (works online, hidden via onError offline). This makes the whole app icon set offline.
const _ICON_FILES=import.meta.glob("../../pyfa-master/imgs/icons/*.png",{eager:true,query:"?url",import:"default"});
const _RENDER_FILES=import.meta.glob("../../pyfa-master/imgs/renders/*.png",{eager:true,query:"?url",import:"default"});
const _iconByID={}; // iconID -> bundled url (prefer @2x)
for(const [p,u] of Object.entries(_ICON_FILES)){const m=p.match(/\/(\d+)(@2x)?\.png$/);if(m&&(m[2]||!_iconByID[m[1]]))_iconByID[m[1]]=u;}
const _renderByType={}; // typeID -> bundled url (prefer @2x)
for(const [p,u] of Object.entries(_RENDER_FILES)){const m=p.match(/\/(\d+)(@2x)?\.png$/);if(m&&(m[2]||!_renderByType[m[1]]))_renderByType[m[1]]=u;}
const eveIcon=(typeID,size=32)=>{
  if(!typeID)return null;
  const iid=TYPE_ICONS[typeID];
  if(iid!=null&&_iconByID[iid])return _iconByID[iid];   // module/charge/drone/implant icon
  if(_renderByType[typeID])return _renderByType[typeID]; // ships have no iconID -> use render
  return `https://images.evetech.net/types/${typeID}/icon?size=${size}`;
};
const eveRender=(typeID,size=64)=>{
  if(!typeID)return null;
  if(_renderByType[typeID])return _renderByType[typeID];
  return `https://images.evetech.net/types/${typeID}/render?size=${size}`;
};
export { eveIcon, eveRender };
