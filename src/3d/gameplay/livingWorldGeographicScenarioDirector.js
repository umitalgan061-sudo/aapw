/**
 * Şafak Kartalı — deterministic geographic scenario policy.
 *
 * The existing world-event owner still creates/dispatches events. This module only classifies a
 * world position and returns a bounded, deterministic scenario proposal for that owner to consume.
 * No entity spawning, terrain editing, faction storage or material ownership is introduced here.
 */
import { sampleReferenceInfluence } from '../world/worldReferenceMap.js';
import { resolveLivingWorldGeography } from './livingWorldGeographyAdapter.js';

export const LIVING_WORLD_SCENARIO_POLICY = Object.freeze({
  id: 'living-world-geographic-scenario-2026-09-07-v1',
  deterministic: true,
  eventOwnership: 'existing-WorldEventSystem',
  spawnOwnership: 'existing-spawn-runtime',
  geographyAuthority: 'livingWorldGeographyAdapter.js',
  maximumScenarioOptions: 6,
  minimumSettlementDistanceMeters: 8,
  minimumRoadDistanceMeters: 3,
});

const REGION_SCENARIOS = Object.freeze({
  snow: Object.freeze(['winter-patrol', 'wolf-sighting', 'snow-traveller']),
  north: Object.freeze(['boreal-patrol', 'deer-crossing', 'roadside-camp']),
  marsh: Object.freeze(['marsh-patrol', 'reed-flock', 'bog-warning']),
  mountain: Object.freeze(['ridge-patrol', 'goat-crossing', 'mountain-shelter']),
  westerlands: Object.freeze(['woodland-hunt', 'road-patrol', 'field-watch']),
  reach: Object.freeze(['farm-work', 'market-travel', 'meadow-graze']),
  desert: Object.freeze(['dune-travel', 'oasis-watch', 'sandstorm-warning']),
  steppe: Object.freeze(['herd-movement', 'rider-patrol', 'open-country-camp']),
  arid: Object.freeze(['red-waste-patrol', 'dry-valley-crossing', 'heat-shelter']),
  coast: Object.freeze(['shore-watch', 'harbour-travel', 'sea-bird-flock']),
  jungle: Object.freeze(['forest-patrol', 'canopy-flock', 'river-edge-watch']),
  valyria: Object.freeze(['ash-patrol', 'dragon-sign', 'volcanic-shelter']),
  temperate: Object.freeze(['road-patrol', 'field-watch', 'woodland-travel']),
});

const ROLE_AFFINITY = Object.freeze({
  guard: Object.freeze({
    winter: ['winter-patrol'],
    road: ['road-patrol', 'boreal-patrol', 'rider-patrol'],
    settlement: ['market-travel', 'field-watch', 'farm-work'],
  }),
  farmer: Object.freeze({
    settlement: ['farm-work', 'field-watch', 'meadow-graze'],
    road: ['market-travel'],
  }),
  wildlife: Object.freeze({
    cold: ['wolf-sighting', 'deer-crossing', 'goat-crossing'],
    wet: ['reed-flock', 'sea-bird-flock', 'canopy-flock'],
    dry: ['herd-movement', 'dune-travel'],
    volcanic: ['dragon-sign'],
  }),
  companion: Object.freeze({
    road: ['roadside-camp', 'market-travel', 'woodland-travel'],
    settlement: ['market-travel'],
  }),
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function hash32(value) {
  let hash = 2166136261;
  for (const char of String(value ?? 'seed')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function hash01(value) {
  return hash32(value) / 0x100000000;
}

function nearestDistance(position, points) {
  let nearest = Infinity;
  for (const point of points || []) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) continue;
    nearest = Math.min(nearest, Math.hypot(position.x - point.x, position.z - point.z));
  }
  return nearest;
}

function nearestPolylineDistance(position, edges) {
  let nearest = Infinity;
  for (const edge of edges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz || 1;
      const t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / length2, 0, 1);
      nearest = Math.min(nearest, Math.hypot(position.x - (a.x + dx * t), position.z - (a.z + dz * t)));
    }
  }
  return nearest;
}

function scenarioBucket(region, { role, cold, wet, dry, volcanic, nearRoad, nearSettlement } = {}) {
  const candidates = new Set(REGION_SCENARIOS[region] || REGION_SCENARIOS.temperate);
  const affinity = ROLE_AFFINITY[normalize(role)] || {};
  const add = (values) => (values || []).forEach((value) => candidates.add(value));
  if (nearRoad) add(affinity.road);
  if (nearSettlement) add(affinity.settlement);
  if (cold >= 0.7) add(affinity.cold || affinity.winter);
  if (wet >= 0.7) add(affinity.wet);
  if (dry >= 0.7) add(affinity.dry);
  if (volcanic >= 0.7) add(affinity.volcanic);
  return [...candidates].sort();
}

function selectDeterministicScenarios(candidates, seed, maxCount) {
  const scored = candidates.map((scenario) => ({ scenario, score: hash01(`${seed}:${scenario}`) }));
  scored.sort((a, b) => b.score - a.score || a.scenario.localeCompare(b.scenario));
  return scored.slice(0, maxCount).map((entry) => entry.scenario);
}

function influenceSummary(worldX, worldZ) {
  const influence = sampleReferenceInfluence(worldX, worldZ);
  return Object.freeze({
    biome: influence?.biome || null,
    relief: influence?.relief || null,
    water: influence?.water || null,
    settlement: influence?.settlement || null,
  });
}

export function classifyLivingWorldGeographicContext({
  worldX = 0,
  worldZ = 0,
  role = 'guard',
  speciesId = null,
  groundHeight = null,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementDistance = Infinity,
  roadDistance = Infinity,
  moisture = 0,
  seed = 0x51afac,
} = {}) {
  const geography = resolveLivingWorldGeography({
    worldX,
    worldZ,
    role,
    speciesId,
    groundHeight,
    slopeDegrees,
    waterDepth,
    settlementDistance,
    roadDistance,
    seed,
  });
  const region = normalize(geography.region) || 'temperate';
  const cold = clamp(region === 'snow' ? 1 : region === 'north' ? 0.82 : region === 'mountain' ? 0.65 : 0.2, 0, 1);
  const wet = clamp(region === 'marsh' || region === 'jungle' ? 1 : region === 'coast' ? 0.72 : finite(moisture), 0, 1);
  const dry = clamp(['desert', 'arid'].includes(region) ? 1 : region === 'steppe' ? 0.72 : 0.24, 0, 1);
  const volcanic = region === 'valyria' ? 1 : region === 'arid' ? 0.18 : 0;
  return Object.freeze({
    ok: geography.ok,
    region,
    reason: geography.reason,
    profileId: geography.profileId,
    normalizedReference: geography.normalizedReference,
    role: normalize(role) || 'guard',
    speciesId: normalize(speciesId) || null,
    slopeDegrees: finite(slopeDegrees),
    waterDepth: Math.max(0, finite(waterDepth)),
    settlementDistance,
    roadDistance,
    cold,
    wet,
    dry,
    volcanic,
    influence: influenceSummary(worldX, worldZ),
    seed: hash32(`${seed}:${worldX}:${worldZ}:${role}:${speciesId || ''}`),
  });
}

export function proposeLivingWorldScenarios({
  context = null,
  worldX = 0,
  worldZ = 0,
  role = 'guard',
  speciesId = null,
  groundHeight = null,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementDistance = Infinity,
  roadDistance = Infinity,
  moisture = 0,
  seed = 0x51afac,
  maxScenarios = LIVING_WORLD_SCENARIO_POLICY.maximumScenarioOptions,
} = {}) {
  const resolved = context || classifyLivingWorldGeographicContext({
    worldX, worldZ, role, speciesId, groundHeight, slopeDegrees, waterDepth, settlementDistance, roadDistance, moisture, seed,
  });
  if (!resolved.ok) {
    return Object.freeze({ ok: false, reason: resolved.reason, region: resolved.region, scenarios: [] });
  }
  const nearRoad = Number.isFinite(resolved.roadDistance) && resolved.roadDistance <= LIVING_WORLD_SCENARIO_POLICY.minimumRoadDistanceMeters + 12;
  const nearSettlement = Number.isFinite(resolved.settlementDistance) && resolved.settlementDistance <= LIVING_WORLD_SCENARIO_POLICY.minimumSettlementDistanceMeters + 75;
  const candidates = scenarioBucket(resolved.region, { role, cold: resolved.cold, wet: resolved.wet, dry: resolved.dry, volcanic: resolved.volcanic, nearRoad, nearSettlement });
  const selected = selectDeterministicScenarios(candidates, resolved.seed, Math.max(1, Math.min(LIVING_WORLD_SCENARIO_POLICY.maximumScenarioOptions, Math.floor(maxScenarios))));
  return Object.freeze({
    ok: true,
    region: resolved.region,
    role: resolved.role,
    speciesId: resolved.speciesId,
    scenarios: Object.freeze(selected.map((type, index) => Object.freeze({
      id: `geo-scenario-${resolved.seed}-${index}`,
      type,
      region: resolved.region,
      role: resolved.role,
      speciesId: resolved.speciesId,
      deterministicScore: Number(hash01(`${resolved.seed}:${type}`).toFixed(6)),
      roadLinked: nearRoad,
      settlementLinked: nearSettlement,
    }))),
    context: resolved,
  });
}

export function validateLivingWorldScenarioAnchor({
  position,
  role = 'guard',
  speciesId = null,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementSeats = [],
  roadEdges = [],
  groundHeight = null,
  seed = 0x51afac,
} = {}) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return { ok: false, reason: 'invalid-position' };
  const settlementDistance = nearestDistance(position, settlementSeats);
  const roadDistance = nearestPolylineDistance(position, roadEdges);
  const context = classifyLivingWorldGeographicContext({
    worldX: position.x,
    worldZ: position.z,
    role,
    speciesId,
    groundHeight,
    slopeDegrees,
    waterDepth,
    settlementDistance,
    roadDistance,
    seed,
  });
  return Object.freeze({
    ok: context.ok,
    reason: context.ok ? 'anchor-valid' : context.reason,
    context,
    distances: { settlementDistance, roadDistance },
  });
}

export function deterministicScenarioDigest(proposal) {
  const types = (proposal?.scenarios || []).map((scenario) => `${scenario.type}:${scenario.deterministicScore}`).join('|');
  return `${proposal?.region || 'unknown'}:${hash32(`${proposal?.context?.seed || 0}:${types}`)}`;
}

export function canScenarioUseActor({ scenario, actorContext } = {}) {
  if (!scenario || !actorContext) return false;
  if (scenario.region !== actorContext.region) return false;
  if (scenario.speciesId && actorContext.speciesId && scenario.speciesId !== actorContext.speciesId) return false;
  if (scenario.settlementLinked && !(Number.isFinite(actorContext.settlementDistance) && actorContext.settlementDistance < 200)) return false;
  if (scenario.roadLinked && !(Number.isFinite(actorContext.roadDistance) && actorContext.roadDistance < 100)) return false;
  return true;
}

export function scenarioRuntimeBudget({
  activeActors = 0,
  visibleActors = 0,
  mobile = false,
  maxTickMs = 1.5,
} = {}) {
  const population = Math.max(0, Math.floor(finite(activeActors)));
  const visible = Math.max(0, Math.floor(finite(visibleActors)));
  const divisor = mobile ? 24 : 48;
  const recommended = Math.max(1, Math.min(6, Math.floor((visible + 1) / divisor + 1)));
  return Object.freeze({
    activeActors: population,
    visibleActors: visible,
    mobile: Boolean(mobile),
    maxTickMs: Math.max(0.25, finite(maxTickMs, 1.5)),
    recommendedScenarioEvaluations: Math.min(recommended, 6),
    staggerSeconds: mobile ? 0.5 : 0.25,
  });
}
