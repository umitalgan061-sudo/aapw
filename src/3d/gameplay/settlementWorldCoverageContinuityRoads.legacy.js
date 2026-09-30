/**
 * Read-only road visibility scorer for the World Coverage boundary.
 * Road geometry remains authoritative elsewhere; this module only interprets
 * caller-provided distance/surface evidence into a deterministic score.
 */
import { continuitySeedFor } from '../world/geographicAssetRuntimeOrchestrator.js';
import { SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY } from './settlementWorldCoverageContinuity.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_CLASSES = Object.freeze([
  'gateway', 'arterial', 'local', 'trail', 'crossing', 'unknown',
]);

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = (value) => {
  let hash = 2166136261; const source = stable(value);
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
function distanceFactor(distanceMeters) {
  const distance = Math.max(0, number(distanceMeters, 150));
  if (distance <= 16) return 1;
  if (distance <= 36) return .92;
  if (distance <= 80) return .76;
  if (distance <= 150) return .54;
  return .2;
}
function slopePenalty(slopeDegrees) {
  const slope = Math.max(0, number(slopeDegrees, 0));
  return slope <= 8 ? 1 : slope <= 20 ? .94 : slope <= 35 ? .82 : slope <= 55 ? .62 : .35;
}
function weatherPenalty(weather = {}) {
  const visibility = clamp01(weather.visibility, .9);
  const wetness = clamp01(weather.wetness, 0);
  const snow = text(weather.type, 'clear') === 'snow' || text(weather.type, 'sleet');
  const storm = text(weather.type, 'clear') === 'storm';
  return clamp01(visibility * (1 - wetness * .12) * (snow ? .84 : 1) * (storm ? .6 : 1));
}
function classBias(roadClass) {
  return { gateway:1, arterial:.95, local:.78, trail:.56, crossing:.64, unknown:.38 }[roadClass] ?? .38;
}

export function classifySettlementWorldCoverageRoad({ roadClass = 'unknown', roadDistanceMeters = null, slopeDegrees = 0, surfaceLayer = '', isWater = false } = {}) {
  const normalizedClass = SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_CLASSES.includes(roadClass) ? roadClass : 'unknown';
  const distance = roadDistanceMeters == null ? null : Math.max(0, number(roadDistanceMeters, 999));
  const waterPenalty = isWater ? .35 : 1;
  const surface = text(surfaceLayer, 'unknown').toLowerCase();
  const terrainPenalty = surface.includes('swamp') || surface.includes('marsh') ? .68 : surface.includes('rock') ? .86 : 1;
  return freeze({ roadClass:normalizedClass, roadDistanceMeters:distance, slopeDegrees:Math.max(0,number(slopeDegrees)), baseBias:classBias(normalizedClass), distanceFactor:distance == null ? .35 : distanceFactor(distance), slopeFactor:slopePenalty(slopeDegrees), waterFactor:waterPenalty, surfaceFactor:terrainPenalty });
}

export function scoreSettlementWorldCoverageRoadVisibility({ settlementId='settlement', worldX=0, worldZ=0, seed=0, stage='far', roadClass='unknown', roadDistanceMeters=null, slopeDegrees=0, surfaceLayer='', isWater=false, atmosphere={}, mobile=false } = {}) {
  const road = classifySettlementWorldCoverageRoad({ roadClass, roadDistanceMeters, slopeDegrees, surfaceLayer, isWater });
  const atmosphereFactor = weatherPenalty(atmosphere.weather);
  const phase = text(atmosphere.time?.phase, 'midday');
  const timeFactor = { 'pre-dawn':.45, dawn:.7, morning:1, midday:1, afternoon:.96, dusk:.72, evening:.55, night:.34 }[phase] ?? .7;
  const stageFactor = { far:.42, approach:.68, threshold:.92, inside:1, service:.86, departure:.7, resume:.82 }[stage] ?? .5;
  const seedValue = continuitySeedFor({ worldX, worldZ, seed, familyId:`${settlementId}:road` });
  const deterministicNudge = .94 + ((seedValue % 17) / 100);
  const score = clamp01(road.baseBias * road.distanceFactor * road.slopeFactor * road.waterFactor * road.surfaceFactor * atmosphereFactor * timeFactor * stageFactor * deterministicNudge * (mobile ? .86 : 1));
  const result = {
    version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_VERSION,
    settlementId:text(settlementId,'settlement'),
    class:road.roadClass,
    evidence:{ distanceMeters:road.roadDistanceMeters, slopeDegrees:road.slopeDegrees, surfaceLayer:text(surfaceLayer,'unknown'), isWater:Boolean(isWater) },
    factors:{ class:road.baseBias, distance:road.distanceFactor, slope:road.slopeFactor, water:road.waterFactor, surface:road.surfaceFactor, atmosphere:atmosphereFactor, time:timeFactor, stage:stageFactor, deterministic:deterministicNudge, mobile:mobile ? .86 : 1 },
    score:Math.round(score*1000)/1000,
    visible:score >= (stage === 'far' ? .3 : .2),
    continuity:{ policy:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id, readOnly:true, noRoadMutation:true, continuitySeed:seedValue },
  };
  return freeze({ ...result, fingerprint:digest(result) });
}

export function validateSettlementWorldCoverageRoadVisibility(input = {}) {
  const result = scoreSettlementWorldCoverageRoadVisibility(input);
  const errors=[];
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_CLASSES.includes(result.class)) errors.push('road-class');
  if (result.score < 0 || result.score > 1 || !Number.isFinite(result.score)) errors.push('score-range');
  if (!result.continuity.readOnly || !result.continuity.noRoadMutation) errors.push('ownership');
  return freeze({ ok:errors.length===0, errors, fingerprint:result.fingerprint });
}

export function buildSettlementWorldCoverageRoadVisibilityBands({ stage='far', distanceMeters=150 } = {}) {
  const distance=Math.max(0,number(distanceMeters,150));
  const bands=[
    {id:'gate',min:0,max:36,priority:1},
    {id:'near',min:36,max:80,priority:.78},
    {id:'approach',min:80,max:150,priority:.55},
    {id:'horizon',min:150,max:320,priority:.28},
  ];
  return freeze(bands.map((band)=>({ ...band, active:distance>=band.min&&distance<band.max, stage, score:Math.round(clamp01(band.priority*(stage==='far'?.9:1))*1000)/1000 })));
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_API = Object.freeze({
  version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_VERSION,
  classes:[...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_CLASSES],
});
