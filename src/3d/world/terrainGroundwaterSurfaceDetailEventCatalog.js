import { clampEventIntensity, normalizeGroundwaterEventType } from './terrainGroundwaterSurfaceDetailEventHelpers.js';
const freeze=Object.freeze;
export const TERRAIN_GROUNDWATER_DETAIL_EVENT_CATALOG=freeze([
{id:'storm',family:'wetting',priority:90,defaultIntensity:.7,roughnessBias:-.03,wetnessBias:.06,description:'Short rainfall pulse emphasizing wet rims and persistent surface film.'},
{id:'snowmelt',family:'wetting',priority:86,defaultIntensity:.65,roughnessBias:-.02,wetnessBias:.08,description:'Melt pulse emphasizing capillary dampness and puddle edges.'},
{id:'recovery',family:'transition',priority:70,defaultIntensity:.45,roughnessBias:-.012,wetnessBias:.025,description:'Post-dry recovery retaining saturation memory.'},
{id:'drought',family:'drying',priority:84,defaultIntensity:.72,roughnessBias:.034,wetnessBias:-.06,description:'Drying pulse emphasizing evaporation fronts and mineral residue.'},
{id:'freeze-thaw',family:'thermal',priority:82,defaultIntensity:.68,roughnessBias:.024,wetnessBias:0,description:'Cold wet-edge pulse emphasizing frost-related micro relief.'},
{id:'fog-dew',family:'wetting',priority:52,defaultIntensity:.32,roughnessBias:-.009,wetnessBias:.018,description:'Light atmospheric moisture response.'},
{id:'seepage',family:'groundwater',priority:64,defaultIntensity:.5,roughnessBias:-.014,wetnessBias:.022,description:'Localized seepage emphasis without creating runoff topology.'},
{id:'evaporation',family:'drying',priority:62,defaultIntensity:.5,roughnessBias:.019,wetnessBias:-.028,description:'Surface evaporation front emphasis.'},
{id:'salt-flush',family:'mineral',priority:48,defaultIntensity:.4,roughnessBias:.012,wetnessBias:0,description:'Mineral residue transition following repeated wetting.'},
{id:'thermal-spall',family:'thermal',priority:44,defaultIntensity:.38,roughnessBias:.016,wetnessBias:0,description:'Subtle temperature-driven roughness response.'},
]);
export function detailEventById(id){const key=normalizeGroundwaterEventType(id);return TERRAIN_GROUNDWATER_DETAIL_EVENT_CATALOG.find(e=>e.id===key)||null;}
export function detailEventProfile(id,overrideIntensity=null){const event=detailEventById(id)??detailEventById('recovery');const intensity=overrideIntensity===null?event.defaultIntensity:clampEventIntensity(overrideIntensity);return freeze({...event,intensity});}
export function detailEventSequence(ids=[]){if(!Array.isArray(ids))throw new TypeError('detail event sequence requires an array');return freeze(ids.map(detailEventProfile));}
export function detailEventFamily(family){return freeze(TERRAIN_GROUNDWATER_DETAIL_EVENT_CATALOG.filter(e=>e.family===family));}
export function detailEventAudit(){const errors=[];const ids=new Set();for(const event of TERRAIN_GROUNDWATER_DETAIL_EVENT_CATALOG){if(ids.has(event.id))errors.push(`${event.id}:duplicate`);ids.add(event.id);if(!Number.isFinite(event.defaultIntensity)||event.defaultIntensity<0||event.defaultIntensity>1)errors.push(`${event.id}:intensity`);if(!Number.isFinite(event.priority)||event.priority<0)errors.push(`${event.id}:priority`);}return freeze({ok:errors.length===0,errors:freeze(errors),count:TERRAIN_GROUNDWATER_DETAIL_EVENT_CATALOG.length});}
