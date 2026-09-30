/**
 * Save-slot UX adapter for settlement sessions.
 * Actual persistence remains delegated to the existing SaveLoad owner.
 */
export const SETTLEMENT_SAVE_SLOT_VERSION=1;
const MAX_SLOTS=8;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,80):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export function normalizeSettlementSlot(slot,index=0){const source=slot&&typeof slot==='object'?slot:{};return{slotId:text(source.slotId,`slot-${index+1}`),label:text(source.label,`Kayıt ${index+1}`),createdAt:text(source.createdAt),updatedAt:text(source.updatedAt),playTimeSeconds:Math.max(0,Math.trunc(Number(source.playTimeSeconds)||0)),location:text(source.location,'Yerleşim'),settlementId:text(source.settlementId,'settlement'),activeService:text(source.activeService),panel:text(source.panel,'overview'),occupied:Boolean(source.occupied),version:1};}
export function buildSettlementSaveSlotList(slots=[]){const list=Array.isArray(slots)?slots.slice(0,MAX_SLOTS):[];return Array.from({length:MAX_SLOTS},(_,index)=>normalizeSettlementSlot(list[index],index));}
export function selectSettlementSaveSlot(slots,slotId){const list=buildSettlementSaveSlotList(slots);const id=text(slotId);const found=list.find(slot=>slot.slotId===id);return found?{ok:true,slot:found}:{ok:false,reason:'unknown-slot'};}
export function createSettlementSaveSlotPreview(runtime,slotId='slot-1',metadata={}){if(!runtime||typeof runtime.getViewModel!=='function')return{ok:false,reason:'runtime-required'};const view=runtime.getViewModel();return{ok:true,slot:normalizeSettlementSlot({slotId,label:metadata.label,createdAt:metadata.createdAt,updatedAt:metadata.updatedAt,playTimeSeconds:metadata.playTimeSeconds,location:view.player?.locationId,settlementId:view.player?.settlementId,activeService:view.activeService?.id,panel:view.panel,occupied:true}),runtimeRevision:view.revision};}
export function validateSettlementSaveSlot(slot){const errors=[];if(!text(slot?.slotId))errors.push('slot-id');if(slot?.version!==1)errors.push('version');if(slot?.playTimeSeconds<0)errors.push('play-time');if(!text(slot?.settlementId))errors.push('settlement');return{ok:errors.length===0,errors};}
export function sortSettlementSaveSlots(slots=[]){return buildSettlementSaveSlotList(slots).sort((a,b)=>{if(a.occupied!==b.occupied)return a.occupied?-1:1;return String(b.updatedAt).localeCompare(String(a.updatedAt));});}
export function buildSettlementSaveSlotSummary(slots=[]){const list=buildSettlementSaveSlotList(slots);return{version:1,total:list.length,occupied:list.filter(slot=>slot.occupied).length,latest:list.filter(slot=>slot.occupied).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]??null};}
export function serializeSettlementSaveSlots(slots=[]){const list=buildSettlementSaveSlotList(slots);return JSON.stringify({version:1,slots:list.map(clone)});}
export function parseSettlementSaveSlots(raw){try{const source=JSON.parse(String(raw??''));if(source?.version!==1)return{ok:false,reason:'unsupported-slot-version'};return{ok:true,slots:buildSettlementSaveSlotList(source.slots)};}catch{return{ok:false,reason:'invalid-slot-json'};}}
