const clamp01=v=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const TYPES=new Set(['storm','snowmelt','recovery','drought','freeze-thaw','fog-dew','seepage','evaporation','salt-flush','thermal-spall']);
export function normalizeGroundwaterEventType(value){const key=String(value??'').trim().toLowerCase();return TYPES.has(key)?key:'recovery';}
export function clampEventIntensity(value){return clamp01(value);}
export function eventIsWetting(value){return ['storm','snowmelt','fog-dew','seepage'].includes(normalizeGroundwaterEventType(value));}
export function eventIsDrying(value){return ['drought','evaporation','salt-flush'].includes(normalizeGroundwaterEventType(value));}
export function eventIsThermal(value){return ['freeze-thaw','thermal-spall'].includes(normalizeGroundwaterEventType(value));}
export function eventFamily(value){const key=normalizeGroundwaterEventType(value);if(eventIsWetting(key))return'wetting';if(eventIsDrying(key))return'drying';if(eventIsThermal(key))return'thermal';return'transition';}
export function eventPriority(value){const key=normalizeGroundwaterEventType(value);return key==='storm'?90:key==='snowmelt'?86:key==='drought'?84:key==='freeze-thaw'?82:key==='recovery'?70:50;}
export const TERRAIN_GROUNDWATER_DETAIL_EVENT_HELPER_POLICY=Object.freeze({id:'terrain-groundwater-surface-detail-event-helpers-2026-09-15-v1',renderOnly:true,deterministic:true});
