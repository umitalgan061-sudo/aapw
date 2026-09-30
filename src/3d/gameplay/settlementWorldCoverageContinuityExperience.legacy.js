/**
 * Unified read-only player-experience packet for the settlement boundary.
 * This module composes existing World Coverage continuity, atmosphere,
 * signage and road evidence into one deterministic presentation contract.
 */
import { planSettlementWorldCoverageTransition } from './settlementWorldCoverageContinuity.js';
import { resolveSettlementWorldCoverageAtmosphere } from './settlementWorldCoverageContinuityAtmosphere.js';
import { buildSettlementWorldCoverageSignage, chooseSettlementWorldCoveragePrimarySign } from './settlementWorldCoverageContinuitySignage.js';
import { scoreSettlementWorldCoverageRoadVisibility, buildSettlementWorldCoverageRoadVisibilityBands } from './settlementWorldCoverageContinuityRoads.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_MODES = Object.freeze([
  'orient', 'approach', 'arrive', 'settle', 'service', 'depart', 'resume',
]);

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 140) : fallback;
};
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
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

function experienceMode(stage, inSettlement) {
  if (inSettlement) return stage === 'service' ? 'service' : 'settle';
  return stage === 'far' ? 'orient' : stage === 'approach' ? 'approach' : stage === 'threshold' ? 'arrive' : stage === 'departure' ? 'depart' : stage === 'resume' ? 'resume' : 'orient';
}
function cuePriority(type) {
  return { gateway:1, service:.94, road:.82, route:.78, checkpoint:.74, atmosphere:.52, warning:.48 }[type] ?? .4;
}
function createCue(type, id, label, copy, score, metadata = {}) {
  const normalizedScore = clamp01(score);
  return {
    id:`${type}:${id}`,
    type,
    label:text(label,id),
    copy:text(copy),
    priority:Math.round(normalizedScore*cuePriority(type)*1000)/1000,
    score:Math.round(normalizedScore*1000)/1000,
    metadata,
  };
}
function buildPrimaryCues({ plan, atmosphere, signage, road, checkpoint }) {
  const cues=[];
  const primarySign=chooseSettlementWorldCoveragePrimarySign(signage);
  if (primarySign) cues.push(createCue(primarySign.type, primarySign.targetId, primarySign.title, primarySign.copy, primarySign.priority, { signId:primarySign.id }));
  if (road.visible) cues.push(createCue('road', 'visibility', 'Road', 'Route remains readable', road.score, { roadClass:road.class, distanceMeters:road.evidence.distanceMeters }));
  if (checkpoint) cues.push(createCue('checkpoint', checkpoint.activeService || 'checkpoint', 'Checkpoint', 'Resume from the last safe settlement state', .7, { sequence:checkpoint.sequence }));
  cues.push(createCue('atmosphere', atmosphere.time.phase, atmosphere.time.phase, atmosphere.weather.type, atmosphere.presentation.readability, { precipitation:atmosphere.weather.precipitation }));
  cues.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  if (plan.gatewayState === 'blocked') cues.push(createCue('warning','gateway','Access','Settlement entry is not currently available',.75,{state:plan.gatewayState}));
  return cues;
}
function computeReadiness({ plan, atmosphere, signage, road }) {
  const entry = plan.transition.canEnter ? 1 : plan.gatewayState === 'approach-only' ? .68 : .35;
  const sign = signage.readableCount > 0 ? 1 : .48;
  const route = road.visible ? road.score : road.score * .65;
  const ambience = atmosphere.presentation.readability;
  return Math.round(clamp01(entry * .45 + sign * .2 + route * .2 + ambience * .15) * 1000) / 1000;
}

export function createSettlementWorldCoverageContinuityExperience({
  settlement = {},
  player = {},
  surface = {},
  regionId = null,
  seed = 0,
  hour = 12,
  weather = {},
  roadClass = 'gateway',
  roadDistanceMeters = null,
  checkpoint = null,
  mobile = false,
} = {}) {
  const plan = planSettlementWorldCoverageTransition({ settlement, player, surface, regionId, seed, mobile });
  const stage = plan.transition.stage;
  const atmosphere = resolveSettlementWorldCoverageAtmosphere({
    settlementId:plan.settlementId,
    worldX:plan.context.settlement.anchor.x,
    worldZ:plan.context.settlement.anchor.z,
    seed,
    hour,
    weather,
    context:surface,
    stage,
    mobile,
  });
  const signage = buildSettlementWorldCoverageSignage({
    settlementId:plan.settlementId,
    stage,
    gatewayState:plan.gatewayState,
    services:plan.services.map((service)=>service.id),
    routeId:plan.transition.route.id,
    distanceMeters:plan.context.distance,
    atmosphere,
    checkpoint,
    mobile,
    serviceFocus:plan.recommendedService?.serviceId,
  });
  const road = scoreSettlementWorldCoverageRoadVisibility({
    settlementId:plan.settlementId,
    worldX:plan.context.settlement.anchor.x,
    worldZ:plan.context.settlement.anchor.z,
    seed,
    stage,
    roadClass,
    roadDistanceMeters:roadDistanceMeters ?? surface.roadDistanceMeters,
    slopeDegrees:surface.slopeDegrees,
    surfaceLayer:surface.layer,
    isWater:surface.isWater,
    atmosphere,
    mobile,
  });
  const mode = experienceMode(stage, Boolean(plan.context.inSettlement));
  const cues = buildPrimaryCues({ plan, atmosphere, signage, road, checkpoint });
  const readiness = computeReadiness({ plan, atmosphere, signage, road });
  const result = {
    version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_VERSION,
    settlementId:plan.settlementId,
    mode,
    stage,
    gatewayState:plan.gatewayState,
    context:{ regionId:plan.context.geography.regionId, biome:plan.context.geography.biome, layer:plan.context.geography.layer, worldChunkKey:plan.context.worldChunkKey, ownerChunkKey:plan.context.ownerChunkKey },
    player:{ inSettlement:Boolean(plan.context.inSettlement), distanceMeters:Math.round(plan.context.distance*100)/100 },
    atmosphere,
    signage,
    road,
    route:plan.transition.route,
    recommendedService:plan.recommendedService,
    quickCues:cues.slice(0,8),
    readiness,
    roadBands:buildSettlementWorldCoverageRoadVisibilityBands({ stage, distanceMeters:plan.context.distance }),
    checkpoint:{ available:Boolean(checkpoint), sequence:number(checkpoint?.sequence,0), activeService:text(checkpoint?.activeService) },
    ownership:{ readOnly:true, noTerrainMutation:true, noRoadMutation:true, noWeatherMutation:true, noModelAttachment:true, noParallelSaveState:true },
  };
  return freeze({ ...result, fingerprint:digest(result) });
}

export function validateSettlementWorldCoverageContinuityExperience(input = {}) {
  const result = createSettlementWorldCoverageContinuityExperience(input);
  const errors=[];
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_MODES.includes(result.mode)) errors.push('mode');
  if (!result.ownership.readOnly || !result.ownership.noTerrainMutation || !result.ownership.noModelAttachment) errors.push('ownership');
  if (result.readiness < 0 || result.readiness > 1 || !Number.isFinite(result.readiness)) errors.push('readiness-range');
  if (result.quickCues.length > 8) errors.push('cue-cap');
  if (result.signage.readableCount > result.signage.signCount) errors.push('signage-count');
  if (result.road.score < 0 || result.road.score > 1) errors.push('road-score');
  return freeze({ ok:errors.length===0, errors, fingerprint:result.fingerprint, mode:result.mode, readiness:result.readiness });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_API = Object.freeze({
  version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_VERSION,
  modes:[...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_MODES],
  cueCap:8,
});
