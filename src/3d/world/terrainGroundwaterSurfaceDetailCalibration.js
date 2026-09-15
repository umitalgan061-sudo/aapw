/**
 * Authored calibration profiles for the groundwater surface-detail stage.
 * Profiles are presentation tuning data, not alternate world simulation data.
 */
const freeze=Object.freeze;
const clamp01=v=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const scale=(value,fallback=.5)=>clamp01(value??fallback);
export const TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_POLICY=freeze({id:'terrain-groundwater-surface-detail-calibration-2026-09-15-v1',renderOnly:true,deterministic:true,canonicalHeightUnchanged:true,canonicalHydrologyUnchanged:true,canonicalCoastlineUnchanged:true,canonicalColliderUnchanged:true,canonicalVegetationPlacementUnchanged:true,newGeographyIntroduced:false,maxMultiplier:1.35,minMultiplier:.65});
export const TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES=freeze([
{id:'wetland-peat',biome:'wetland',substrate:'peat',wetRim:1.18,capillary:1.26,seepage:1.02,puddle:1.3,evaporation:.74,crust:.7,fine:1.08,recovery:1.2,freeze:.9,marsh:1.32,drying:.72,relief:.92},
{id:'wetland-silt',biome:'wetland',substrate:'silt',wetRim:1.15,capillary:1.12,seepage:1.08,puddle:1.22,evaporation:.78,crust:.76,fine:1.16,recovery:1.12,freeze:.88,marsh:1.25,drying:.76,relief:.96},
{id:'wetland-loam',biome:'wetland',substrate:'loam',wetRim:1.1,capillary:1.08,seepage:1.06,puddle:1.15,evaporation:.82,crust:.79,fine:1.08,recovery:1.06,freeze:.9,marsh:1.18,drying:.8,relief:.98},
{id:'temperate-alluvium',biome:'temperate',substrate:'alluvium',wetRim:1.06,capillary:1.04,seepage:1.08,puddle:1.08,evaporation:.88,crust:.84,fine:1.15,recovery:1.02,freeze:.94,marsh:1.04,drying:.88,relief:1.02},
{id:'temperate-loam',biome:'temperate',substrate:'loam',wetRim:1.02,capillary:1.01,seepage:1.03,puddle:1.02,evaporation:.92,crust:.88,fine:1.02,recovery:1,freeze:1,marsh:.98,drying:.94,relief:1},
{id:'temperate-silt',biome:'temperate',substrate:'silt',wetRim:1.05,capillary:1.07,seepage:1.05,puddle:1.06,evaporation:.89,crust:.86,fine:1.1,recovery:1.04,freeze:.98,marsh:1,drying:.9,relief:.98},
{id:'temperate-clay',biome:'temperate',substrate:'clay',wetRim:1.1,capillary:1.18,seepage:.98,puddle:1.2,evaporation:.83,crust:.92,fine:1.12,recovery:1.1,freeze:1.02,marsh:1.03,drying:.82,relief:1.03},
{id:'temperate-gravel',biome:'temperate',substrate:'gravel',wetRim:.91,capillary:.82,seepage:1.02,puddle:.84,evaporation:1.05,crust:.97,fine:.88,recovery:.84,freeze:1.02,marsh:.82,drying:1.08,relief:1.12},
{id:'dryland-sand',biome:'dryland',substrate:'sand',wetRim:.78,capillary:.76,seepage:.82,puddle:.7,evaporation:1.24,crust:1.22,fine:1.02,recovery:.74,freeze:.72,marsh:.62,drying:1.28,relief:1.06},
{id:'dryland-gravel',biome:'dryland',substrate:'gravel',wetRim:.82,capillary:.7,seepage:.86,puddle:.66,evaporation:1.2,crust:1.16,fine:.84,recovery:.7,freeze:.76,marsh:.58,drying:1.22,relief:1.15},
{id:'montane-schist',biome:'montane',substrate:'schist',wetRim:.94,capillary:.92,seepage:1.14,puddle:.75,evaporation:1.02,crust:.9,fine:.83,recovery:.89,freeze:1.18,marsh:.7,drying:1.01,relief:1.2},
{id:'montane-granite',biome:'montane',substrate:'granite',wetRim:.9,capillary:.84,seepage:1.1,puddle:.68,evaporation:1.06,crust:.94,fine:.74,recovery:.82,freeze:1.22,marsh:.62,drying:1.06,relief:1.26},
{id:'alpine-basalt',biome:'alpine',substrate:'basalt',wetRim:.8,capillary:.6,seepage:.98,puddle:.52,evaporation:1.08,crust:.88,fine:.62,recovery:.66,freeze:1.3,marsh:.5,drying:1.12,relief:1.32},
{id:'alpine-granite',biome:'alpine',substrate:'granite',wetRim:.76,capillary:.56,seepage:.94,puddle:.48,evaporation:1.12,crust:.9,fine:.58,recovery:.6,freeze:1.34,marsh:.46,drying:1.16,relief:1.35},
{id:'coastal-silt',biome:'coastal',substrate:'silt',wetRim:1.18,capillary:1.14,seepage:1.12,puddle:1.18,evaporation:1.02,crust:1.2,fine:1.2,recovery:1.08,freeze:.86,marsh:1.22,drying:.94,relief:.94},
{id:'coastal-sand',biome:'coastal',substrate:'sand',wetRim:1.02,capillary:.84,seepage:1.04,puddle:.94,evaporation:1.18,crust:1.25,fine:1.16,recovery:.86,freeze:.82,marsh:1.08,drying:1.18,relief:1.06},
{id:'coastal-gravel',biome:'coastal',substrate:'gravel',wetRim:.96,capillary:.76,seepage:1.02,puddle:.82,evaporation:1.16,crust:1.16,fine:1.02,recovery:.8,freeze:.9,marsh:.92,drying:1.14,relief:1.15},
{id:'forest-loam',biome:'forest',substrate:'loam',wetRim:1.06,capillary:1.12,seepage:1.04,puddle:1.04,evaporation:.86,crust:.8,fine:1.08,recovery:1.1,freeze:1.02,marsh:.96,drying:.84,relief:1.08},
{id:'forest-clay',biome:'forest',substrate:'clay',wetRim:1.12,capillary:1.2,seepage:1.01,puddle:1.17,evaporation:.82,crust:.9,fine:1.1,recovery:1.14,freeze:1.04,marsh:1,drying:.8,relief:1.1},
{id:'forest-gravel',biome:'forest',substrate:'gravel',wetRim:.94,capillary:.86,seepage:1.04,puddle:.84,evaporation:1,crust:.92,fine:.9,recovery:.86,freeze:1.04,marsh:.82,drying:1.02,relief:1.18},
{id:'steppe-loam',biome:'steppe',substrate:'loam',wetRim:.94,capillary:.9,seepage:.96,puddle:.8,evaporation:1.1,crust:1.04,fine:.98,recovery:.82,freeze:1.02,marsh:.68,drying:1.12,relief:1.06},
{id:'steppe-silt',biome:'steppe',substrate:'silt',wetRim:.97,capillary:.94,seepage:.98,puddle:.86,evaporation:1.08,crust:1.06,fine:1.08,recovery:.86,freeze:1.04,marsh:.72,drying:1.1,relief:1.04},
{id:'desert-sand',biome:'desert',substrate:'sand',wetRim:.68,capillary:.54,seepage:.7,puddle:.42,evaporation:1.32,crust:1.3,fine:1.12,recovery:.55,freeze:.66,marsh:.34,drying:1.34,relief:1.04},
{id:'desert-gravel',biome:'desert',substrate:'gravel',wetRim:.64,capillary:.48,seepage:.72,puddle:.36,evaporation:1.3,crust:1.26,fine:.84,recovery:.5,freeze:.7,marsh:.3,drying:1.32,relief:1.14},
{id:'tundra-silt',biome:'tundra',substrate:'silt',wetRim:1.04,capillary:1,seepage:1.04,puddle:1.02,evaporation:.76,crust:.72,fine:1.02,recovery:1.02,freeze:1.34,marsh:1.1,drying:.72,relief:1.02},
{id:'tundra-rock',biome:'tundra',substrate:'basalt',wetRim:.9,capillary:.7,seepage:1,puddle:.64,evaporation:.8,crust:.76,fine:.64,recovery:.78,freeze:1.35,marsh:.8,drying:.78,relief:1.28},
{id:'river-alluvium',biome:'riparian',substrate:'alluvium',wetRim:1.2,capillary:1.18,seepage:1.1,puddle:1.24,evaporation:.82,crust:.84,fine:1.25,recovery:1.16,freeze:1,marsh:1.16,drying:.8,relief:.96},
{id:'river-silt',biome:'riparian',substrate:'silt',wetRim:1.18,capillary:1.16,seepage:1.12,puddle:1.2,evaporation:.84,crust:.86,fine:1.27,recovery:1.14,freeze:1,marsh:1.18,drying:.82,relief:.94},
{id:'river-gravel',biome:'riparian',substrate:'gravel',wetRim:1.02,capillary:.84,seepage:1.08,puddle:.9,evaporation:.94,crust:.82,fine:1.08,recovery:.9,freeze:1.02,marsh:.9,drying:.96,relief:1.2},
{id:'swamp-peat',biome:'swamp',substrate:'peat',wetRim:1.28,capillary:1.3,seepage:1.08,puddle:1.34,evaporation:.7,crust:.66,fine:1.06,recovery:1.25,freeze:.92,marsh:1.35,drying:.66,relief:.9},
{id:'swamp-clay',biome:'swamp',substrate:'clay',wetRim:1.22,capillary:1.28,seepage:1.04,puddle:1.3,evaporation:.72,crust:.74,fine:1.14,recovery:1.22,freeze:.94,marsh:1.3,drying:.7,relief:.92},
{id:'foothill-loam',biome:'foothill',substrate:'loam',wetRim:1,capillary:.98,seepage:1.1,puddle:.88,evaporation:.94,crust:.88,fine:.94,recovery:.96,freeze:1.08,marsh:.8,drying:.94,relief:1.08},
{id:'foothill-schist',biome:'foothill',substrate:'schist',wetRim:.94,capillary:.82,seepage:1.16,puddle:.74,evaporation:1,crust:.9,fine:.78,recovery:.84,freeze:1.16,marsh:.68,drying:1,relief:1.22},
{id:'plateau-silt',biome:'plateau',substrate:'silt',wetRim:.92,capillary:.88,seepage:.9,puddle:.62,evaporation:1.06,crust:1.02,fine:1.02,recovery:.8,freeze:1.04,marsh:.56,drying:1.08,relief:1.06},
{id:'plateau-basalt',biome:'plateau',substrate:'basalt',wetRim:.84,capillary:.66,seepage:.88,puddle:.5,evaporation:1.12,crust:1.06,fine:.7,recovery:.68,freeze:1.12,marsh:.46,drying:1.16,relief:1.26},
{id:'volcanic-basalt',biome:'volcanic',substrate:'basalt',wetRim:.86,capillary:.68,seepage:.98,puddle:.56,evaporation:1.06,crust:.96,fine:.72,recovery:.72,freeze:1.18,marsh:.52,drying:1.1,relief:1.32},
{id:'volcanic-ash',biome:'volcanic',substrate:'silt',wetRim:.98,capillary:1.04,seepage:1.08,puddle:.82,evaporation:.94,crust:1.02,fine:1.28,recovery:.96,freeze:1.08,marsh:.74,drying:.94,relief:1.1},
]);
export function calibrationFor({biome='temperate',substrate='loam'}={}){const direct=TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES.find(p=>p.biome===biome&&p.substrate===substrate);const fallback=TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES.find(p=>p.biome===biome)||TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES[4];return freeze({...fallback,id:direct?.id??`${biome}-${substrate}-fallback`,biome,substrate,matched:Boolean(direct)});}
export function applyCalibration(channels,profile){const p=profile??calibrationFor();const factors={wetRim:p.wetRim,capillaryDamp:p.capillary,seepageDarkening:p.seepage,puddleCore:p.puddle,puddleEdge:p.puddle,evaporationFront:p.evaporation,mineralCrust:p.crust,fineSedimentFilm:p.fine,recoveryHalo:p.recovery,freezeWetEdge:p.freeze,marshTransition:p.marsh,dryingContrast:p.drying,microRelief:p.relief,surfaceConfidence:1};return freeze(Object.fromEntries(Object.entries(channels??{}).map(([key,value])=>[key,clamp01(Number(value)*scale(factors[key],1))]))));}
export function calibrationSignature(profile){const p=profile??calibrationFor();return freeze(Object.fromEntries(['wetRim','capillary','seepage','puddle','evaporation','crust','fine','recovery','freeze','marsh','drying','relief'].map(k=>[k,Number(scale(p[k],1).toFixed(4))])));}
export function calibrationAudit(){const errors=[];for(const p of TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES){for(const key of ['wetRim','capillary','seepage','puddle','evaporation','crust','fine','recovery','freeze','marsh','drying','relief']){const n=Number(p[key]);if(!Number.isFinite(n))errors.push(`${p.id}:${key}:finite`);if(n<TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_POLICY.minMultiplier||n>TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_POLICY.maxMultiplier)errors.push(`${p.id}:${key}:range`);}}return freeze({ok:errors.length===0,errors:freeze(errors),count:TERRAIN_GROUNDWATER_DETAIL_CALIBRATION_PROFILES.length});}
