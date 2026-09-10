/**
 * Canonical world ground/context query adapter v51.
 *
 * Other autonomous teams consume this module to ask the environment owner for
 * grounded terrain context. Every value originates in caller-owned canonical
 * samples; this adapter does not raycast, invent topology, move colliders, or
 * attach assets. It deliberately mirrors the world-coverage placement gates so
 * player/NPC/gameplay systems can make the same terrain-aware decisions.
 */

const VERSION = 'v51-ground-query';
const MAX_BATCH = 512;
const WATER_EPSILON = 2;
const CLIFF_SLOPE = 0.78;
const PERMANENT_SNOW = 0.94;
const ROAD_CLEARANCE = 8;
const SETTLEMENT_CLEARANCE = 8;
const REQUIRED_FIELDS = Object.freeze([
  'elevation',
  'slope',
  'moisture',
  'snow',
  'waterDistance',
  'roadDistance',
  'settlementDistance',
  'biome',
]);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const nonNegative = (value, fallback = Infinity) => Math.max(0, finite(value, fallback));
const round = (value, places = 6) => {
  const factor = 10 ** places;
  return Math.round(finite(value) * factor) / factor;
};
const normalizeId = (value, fallback = 'unknown') => String(value ?? fallback).trim().toLowerCase() || fallback;
const vec3 = (value = {}) => ({x:round(finite(value.x)),y:round(finite(value.y)),z:round(finite(value.z))});
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result,key)=>{result[key]=stable(value[key]);return result;},{});
};
const hash32 = (value) => {
  let hash = 2166136261;
  const text = JSON.stringify(stable(value));
  for (let index=0; index<text.length; index+=1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash,16777619);
  }
  return hash >>> 0;
};
const digest = (value) => hash32(value).toString(16).padStart(8,'0');

const normalizeSample = (sample = {}) => ({
  id:normalizeId(sample.id),
  position:vec3(sample.position),
  elevation:round(finite(sample.elevation,sample.position?.y),3),
  slope:round(clamp(sample.slope,0,1),6),
  moisture:round(clamp(sample.moisture,0,1),6),
  snow:round(clamp(sample.snow,0,1),6),
  waterDistance:round(nonNegative(sample.waterDistance),3),
  roadDistance:round(nonNegative(sample.roadDistance),3),
  settlementDistance:round(nonNegative(sample.settlementDistance),3),
  biome:normalizeId(sample.biome),
  riverDistance:round(nonNegative(sample.riverDistance),3),
  lakeDistance:round(nonNegative(sample.lakeDistance),3),
  seaDistance:round(nonNegative(sample.seaDistance),3),
  waterDepth:round(nonNegative(sample.waterDepth,0),3),
  colliderY:round(finite(sample.colliderY,sample.elevation),3),
  canonicalHeight:round(finite(sample.canonicalHeight,sample.elevation),3),
});

const validateFields = (sample) => ({
  missing:REQUIRED_FIELDS.filter(field => sample[field] === undefined || sample[field] === null),
  finite:REQUIRED_FIELDS.every(field => field === 'biome' || Number.isFinite(sample[field])),
  canonicalBiome:Boolean(sample.biome && sample.biome !== 'unknown'),
});

const groundParity = (sample) => {
  const dy=Math.abs(sample.elevation-sample.colliderY);
  const dh=Math.abs(sample.elevation-sample.canonicalHeight);
  return {
    elevation:round(sample.elevation,3),
    colliderY:round(sample.colliderY,3),
    canonicalHeight:round(sample.canonicalHeight,3),
    colliderDelta:round(dy,4),
    canonicalDelta:round(dh,4),
    parity:dy<=0.01&&dh<=0.01,
  };
};

const hydrologyContext = (sample) => {
  const waterDistance=Math.max(0,sample.waterDistance);
  const category = sample.seaDistance <= waterDistance + 0.001 ? 'sea'
    : sample.lakeDistance <= waterDistance + 0.001 ? 'lake'
      : sample.riverDistance <= waterDistance + 0.001 ? 'river' : 'none';
  const shoreline=clamp(1-waterDistance/250,0,1);
  return {
    category,
    waterDistance:round(waterDistance,3),
    waterDepth:round(sample.waterDepth,3),
    shorelineProximity:round(shoreline),
    submerged:waterDistance<WATER_EPSILON,
    wetEdge:shoreline>.05||sample.moisture>.72,
  };
};

const placementContext = (sample) => {
  const blocked = [];
  if(sample.waterDistance<WATER_EPSILON) blocked.push('water');
  if(sample.slope>CLIFF_SLOPE) blocked.push('cliff');
  if(sample.snow>PERMANENT_SNOW) blocked.push('permanent-snow');
  if(sample.roadDistance<ROAD_CLEARANCE) blocked.push('road');
  if(sample.settlementDistance<SETTLEMENT_CLEARANCE) blocked.push('settlement');
  return {
    eligible:blocked.length===0,
    blockedReasons:blocked,
    clearance:{water:round(sample.waterDistance,3),road:round(sample.roadDistance,3),settlement:round(sample.settlementDistance,3)},
    slope:round(sample.slope),
    snow:round(sample.snow),
    biome:sample.biome,
  };
};

const biomeContext = (sample) => ({
  biome:sample.biome,
  moisture:round(sample.moisture),
  snow:round(sample.snow),
  slope:round(sample.slope),
  elevation:round(sample.elevation,3),
  ecotoneHints:{
    forest:sample.moisture>.45&&sample.slope<.45&&sample.snow<.55,
    alpine:sample.elevation>900||sample.snow>.55||sample.slope>.65,
    wetland:sample.moisture>.78&&sample.waterDistance<300,
    rocky:sample.slope>.55||sample.snow>.72,
  },
});

export function queryCanonicalGroundContextV51(input = {}) {
  const sample=normalizeSample(input.sample||input);
  const fields=validateFields(sample);
  const parity=groundParity(sample);
  const hydrology=hydrologyContext(sample);
  const placement=placementContext(sample);
  const biome=biomeContext(sample);
  const result={
    version:VERSION,
    id:sample.id,
    valid:fields.missing.length===0&&fields.finite&&fields.canonicalBiome,
    fields,
    position:sample.position,
    ground:{elevation:sample.elevation,colliderY:sample.colliderY,canonicalHeight:sample.canonicalHeight,parity},
    slope:{normalized:sample.slope,percent:round(sample.slope*100,2),class:sample.slope>.78?'cliff':sample.slope>.45?'steep':sample.slope>.18?'gentle':'flat'},
    hydrology,
    biome,
    placement,
    navigation:{walkable:sample.slope<=.78&&!hydrology.submerged,navPenalty:round(sample.slope*.65+(hydrology.category==='river'?.12:0)+(sample.moisture>.8?.08:0))},
    ownerBoundary:{terrain:true,hydrology:true,collider:true,renderer:false,assets:false,sceneMutation:false},
  };
  result.digest=digest(result);
  return deepFreeze(result);
}

export function queryCanonicalGroundBatchV51(samples = []) {
  const rows=Array.isArray(samples)?samples.slice(0,MAX_BATCH):[];
  const results=rows.map(sample=>queryCanonicalGroundContextV51({sample}));
  return deepFreeze({version:VERSION,count:results.length,truncated:Array.isArray(samples)&&samples.length>MAX_BATCH,results,valid:results.every(result=>result.valid),digest:digest(results)});
}

export function queryCanonicalGroundForAgentV51(agent='unknown',sample={}) {
  const context=queryCanonicalGroundContextV51({sample});
  return deepFreeze({version:VERSION,agent:normalizeId(agent),context,contract:{queryOnly:true,mutationAllowed:false,assetPlacementAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline'}});
}

export function compareCanonicalGroundContextV51(a={},b={}) {
  const left=queryCanonicalGroundContextV51({sample:a});
  const right=queryCanonicalGroundContextV51({sample:b});
  return deepFreeze({version:VERSION,a:left,b:right,delta:{elevation:round(right.ground.elevation-left.ground.elevation,4),slope:round(right.slope.normalized-left.slope.normalized,4),moisture:round(right.biome.moisture-left.biome.moisture,4),snow:round(right.biome.snow-left.biome.snow,4),waterDistance:round(right.hydrology.waterDistance-left.hydrology.waterDistance,4)},sameBiome:left.biome.biome===right.biome.biome});
}

export const WORLD_COVERAGE_GROUND_QUERY_V51=Object.freeze({
  version:VERSION,
  maxBatch:MAX_BATCH,
  requiredFields:REQUIRED_FIELDS,
  placementThresholds:Object.freeze({water:EpsILON_PLACEHOLDER}),
  waterEpsilon:WATER_EPSILON,
  cliffSlope:CLIFF_SLOPE,
  permanentSnow:PERMANENT_SNOW,
  roadClearance:ROAD_CLEARANCE,
  settlementClearance:SETTLEMENT_CLEARANCE,
  mutationAllowed:false,
  assetPlacementAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
});
