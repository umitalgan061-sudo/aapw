/**
 * Deterministic read-only traversal lanes for settlement/world continuity.
 *
 * This module turns the existing experience packet into a bounded set of
 * traversal lanes and pacing hints. It owns neither navigation meshes nor
 * actors; callers remain responsible for executing movement in the world.
 */
import { createSettlementWorldCoverageContinuityExperience } from './settlementWorldCoverageContinuityExperience.js';

export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS = Object.freeze({
  maxLanes: 10,
  maxWaypointsPerLane: 8,
  maxSignals: 12,
  mobileScale: 0.62,
  minLaneScore: 0.28,
});

export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LANES = Object.freeze([
  'gateway', 'market', 'tavern', 'craft', 'farm', 'military', 'stable', 'home', 'river', 'ridge',
]);
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_PHASES = Object.freeze([
  'orient', 'commit', 'traverse', 'arrive', 'linger', 'return',
]);
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_SIGNALS = Object.freeze([
  'entry', 'route', 'service', 'road', 'terrain', 'weather', 'checkpoint', 'warning', 'arrival', 'return',
]);

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
const text = (value, fallback = '') => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, 120) : fallback;
};
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const LANE_RULES = Object.freeze({
  gateway: { service: 'gate', role: 'entry', base: 0.92, distance: 1, preferred: ['threshold', 'approach'] },
  market: { service: 'market', role: 'commerce', base: 0.82, distance: 0.86, preferred: ['service', 'inside'] },
  tavern: { service: 'tavern', role: 'rest', base: 0.76, distance: 0.72, preferred: ['service', 'inside'] },
  craft: { service: 'blacksmith', role: 'craft', base: 0.7, distance: 0.78, preferred: ['service', 'inside'] },
  farm: { service: 'farm', role: 'survival', base: 0.56, distance: 1.18, preferred: ['approach', 'inside'] },
  military: { service: 'barracks', role: 'training', base: 0.64, distance: 0.95, preferred: ['inside', 'service'] },
  stable: { service: 'stable', role: 'travel', base: 0.72, distance: 0.9, preferred: ['inside', 'departure'] },
  home: { service: 'house', role: 'persistence', base: 0.6, distance: 0.82, preferred: ['inside', 'resume'] },
  river: { service: 'gate', role: 'water-route', base: 0.42, distance: 1.3, preferred: ['approach', 'departure'] },
  ridge: { service: 'gate', role: 'high-ground', base: 0.38, distance: 1.42, preferred: ['far', 'approach'] },
});

const PHASE_WEIGHTS = Object.freeze({ orient: 0.56, commit: 0.82, traverse: 1, arrive: 0.94, linger: 0.72, return: 0.76 });
const ROLE_WEIGHTS = Object.freeze({
  entry: 1, commerce: 0.92, rest: 0.82, craft: 0.86, survival: 0.58,
  training: 0.7, travel: 0.78, persistence: 0.72, 'water-route': 0.46, 'high-ground': 0.44,
});
const SIGNAL_WEIGHTS = Object.freeze({ entry: 1, route: 0.9, service: 0.86, road: 0.76, terrain: 0.58, weather: 0.48, checkpoint: 0.72, warning: 0.8, arrival: 0.9, return: 0.74 });

function phaseForExperience(experience) {
  if (experience.mode === 'orient') return 'orient';
  if (experience.mode === 'approach') return 'commit';
  if (experience.mode === 'arrive') return 'arrive';
  if (experience.mode === 'service' || experience.mode === 'settle') return 'linger';
  if (experience.mode === 'depart') return 'return';
  if (experience.mode === 'resume') return 'traverse';
  return 'traverse';
}
function laneEligibility(lane, experience) {
  const rule = LANE_RULES[lane];
  if (!rule) return 0;
  const stageBonus = rule.preferred.includes(experience.stage) ? 0.18 : 0;
  const roadScore = clamp01(experience.road?.score, 0);
  const weatherPenalty = 1 - clamp01(experience.atmosphere?.weather?.visibility, 1) * 0.2;
  const gateFactor = experience.gatewayState === 'blocked' && lane === 'gateway' ? 0.25 : 1;
  return clamp01(rule.base + stageBonus + roadScore * 0.22) * weatherPenalty * gateFactor;
}
function phaseScore(phase, experience) {
  const base = PHASE_WEIGHTS[phase] ?? 0.5;
  const readability = clamp01(experience.readiness, 0.5);
  return Math.round(clamp01(base * 0.65 + readability * 0.35) * 1000) / 1000;
}
function waypointCount(lane, mobile) {
  const rule = LANE_RULES[lane] ?? LANE_RULES.gateway;
  const base = 3 + Math.round(rule.distance * 2);
  return Math.max(2, Math.min(SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.maxWaypointsPerLane, mobile ? Math.floor(base * 0.62) : base));
}
function waypointRadius(index, total, experience) {
  const distance = number(experience.player?.distanceMeters, 0);
  const radial = Math.max(18, Math.min(220, distance + 24));
  const t = total <= 1 ? 0 : index / (total - 1);
  return Math.round((radial * (0.28 + t * 0.72)) * 100) / 100;
}
function buildWaypoint(lane, index, total, experience) {
  const angle = ((index + 1) * 0.73 + lane.length * 0.11 + experience.context.worldChunkKey.length * 0.07) % (Math.PI * 2);
  const radius = waypointRadius(index, total, experience);
  const anchor = experience.atmosphere ? { x: number(experience.route?.worldX, 0), z: number(experience.route?.worldZ, 0) } : { x: 0, z: 0 };
  return {
    id: `${experience.settlementId}:${lane}:wp-${index + 1}`,
    index,
    xOffset: Math.round(Math.cos(angle) * radius * 100) / 100,
    zOffset: Math.round(Math.sin(angle) * radius * 100) / 100,
    radius,
    semantic: index === 0 ? 'commit' : index === total - 1 ? 'arrival' : 'traverse',
    chunkKey: experience.context.worldChunkKey,
    ownerChunkKey: experience.context.ownerChunkKey,
    anchor,
  };
}
function buildWaypoints(lane, experience, mobile) {
  const total = waypointCount(lane, mobile);
  return freeze(Array.from({ length: total }, (_, index) => buildWaypoint(lane, index, total, experience)));
}
function buildSignals(lane, phase, experience) {
  const signals = [];
  const push = (type, score, copy) => signals.push({
    id: `${experience.settlementId}:${lane}:${type}`,
    type,
    score: Math.round(clamp01(score) * 1000) / 1000,
    copy: text(copy),
    phase,
  });
  if (lane === 'gateway') push('entry', experience.gatewayState === 'available' ? 1 : 0.42, 'Settlement gateway status');
  push('route', experience.road.visible ? experience.road.score : 0.34, 'Route readability');
  if (LANE_RULES[lane]?.service && experience.recommendedService?.serviceId === LANE_RULES[lane].service) push('service', 0.96, 'Recommended settlement service');
  if (experience.atmosphere.weather.visibility < 0.6) push('warning', 0.82, 'Reduced visibility');
  if (experience.signage.readableCount > 0) push('arrival', 0.72, 'Wayfinding remains readable');
  if (experience.checkpoint.available && phase === 'return') push('checkpoint', 0.78, 'Checkpoint available for resume');
  if (phase === 'return') push('return', 0.74, 'Return route is the current focus');
  return signals.slice(0, SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.maxSignals);
}
function buildLane(lane, experience, mobile) {
  const rule = LANE_RULES[lane];
  const phase = phaseForExperience(experience);
  const eligibility = laneEligibility(lane, experience);
  const score = Math.round(clamp01(eligibility * phaseScore(phase, experience) * (ROLE_WEIGHTS[rule.role] ?? 0.5)) * 1000) / 1000;
  const signalRows = buildSignals(lane, phase, experience).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    id: `${experience.settlementId}:lane:${lane}`,
    lane,
    role: rule.role,
    serviceId: rule.service,
    phase,
    score,
    eligible: score >= SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.minLaneScore,
    distanceFactor: rule.distance,
    waypoints: buildWaypoints(lane, experience, mobile),
    signals: signalRows,
    ownership: { readOnly: true, noNavMeshMutation: true, noActorSpawn: true, noRoadMutation: true },
  };
}
function buildSummary(lanes, experience, mobile) {
  const eligible = lanes.filter((lane) => lane.eligible);
  const top = eligible[0] ?? lanes[0] ?? null;
  const signalCount = lanes.reduce((sum, lane) => sum + lane.signals.length, 0);
  return {
    candidateCount: lanes.length,
    eligibleCount: eligible.length,
    topLane: top?.lane ?? null,
    topScore: top?.score ?? 0,
    signalCount,
    mobile,
    phase: phaseForExperience(experience),
  };
}

export function createSettlementWorldCoverageTraversalPlan(options = {}) {
  const mobile = Boolean(options.mobile);
  const experience = createSettlementWorldCoverageContinuityExperience(options);
  const lanes = [...SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LANES]
    .map((lane) => buildLane(lane, experience, mobile))
    .sort((a, b) => b.score - a.score || a.lane.localeCompare(b.lane))
    .slice(0, SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.maxLanes);
  const summary = buildSummary(lanes, experience, mobile);
  const payload = {
    version: SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_VERSION,
    settlementId: experience.settlementId,
    mode: experience.mode,
    stage: experience.stage,
    gatewayState: experience.gatewayState,
    phase: summary.phase,
    mobile,
    lanes,
    summary,
    ownership: { readOnly: true, noNavMeshMutation: true, noActorSpawn: true, noCombatMutation: true },
  };
  return freeze({ ...payload, fingerprint: digest(payload) });
}

export function selectSettlementWorldCoverageTraversalLane(plan, requestedLane = null) {
  const source = plan && typeof plan === 'object' ? plan : { lanes: [] };
  if (requestedLane && source.lanes?.some((lane) => lane.lane === requestedLane)) {
    return source.lanes.find((lane) => lane.lane === requestedLane);
  }
  return source.lanes?.find((lane) => lane.eligible) ?? source.lanes?.[0] ?? null;
}

export function validateSettlementWorldCoverageTraversalPlan(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const errors = [];
  if (!source.settlementId) errors.push('settlement-id');
  if (!SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_PHASES.includes(source.phase)) errors.push('phase');
  if (!Array.isArray(source.lanes)) errors.push('lanes');
  if (source.lanes?.length > SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.maxLanes) errors.push('lane-cap');
  if (source.lanes?.some((lane) => !SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LANES.includes(lane.lane))) errors.push('lane-vocabulary');
  if (source.lanes?.some((lane) => lane.score < 0 || lane.score > 1)) errors.push('score-range');
  if (source.lanes?.some((lane) => lane.waypoints.length > SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LIMITS.maxWaypointsPerLane)) errors.push('waypoint-cap');
  if (source.lanes?.some((lane) => lane.signals.some((signal) => !SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_SIGNALS.includes(signal.type)))) errors.push('signal-vocabulary');
  if (!source.ownership?.readOnly || !source.ownership?.noNavMeshMutation || !source.ownership?.noActorSpawn) errors.push('ownership');
  const ids = source.lanes?.map((lane) => lane.id) ?? [];
  if (new Set(ids).size !== ids.length) errors.push('duplicate-lane-id');
  return freeze({ ok: errors.length === 0, errors, settlementId: source.settlementId ?? null, laneCount: source.lanes?.length ?? 0, fingerprint: source.fingerprint ?? digest(source) });
}

export function summarizeSettlementWorldCoverageTraversalPlan(options = {}) {
  const plan = createSettlementWorldCoverageTraversalPlan(options);
  const selected = selectSettlementWorldCoverageTraversalLane(plan, options.lane);
  return freeze({
    settlementId: plan.settlementId,
    stage: plan.stage,
    phase: plan.phase,
    mobile: plan.mobile,
    topLane: selected?.lane ?? null,
    topRole: selected?.role ?? null,
    eligibleCount: plan.summary.eligibleCount,
    waypointCount: selected?.waypoints.length ?? 0,
    signalCount: plan.summary.signalCount,
    fingerprint: plan.fingerprint,
  });
}

export function replaySettlementWorldCoverageTraversal(options = {}) {
  const first = createSettlementWorldCoverageTraversalPlan(options);
  const second = createSettlementWorldCoverageTraversalPlan(JSON.parse(JSON.stringify(options)));
  return freeze({ ok: first.fingerprint === second.fingerprint, firstFingerprint: first.fingerprint, secondFingerprint: second.fingerprint });
}

export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_VERSION,
  laneCount: SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_LANES.length,
  phaseCount: SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_PHASES.length,
  signalCount: SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_SIGNALS.length,
  create: 'createSettlementWorldCoverageTraversalPlan',
  select: 'selectSettlementWorldCoverageTraversalLane',
  validate: 'validateSettlementWorldCoverageTraversalPlan',
  summary: 'summarizeSettlementWorldCoverageTraversalPlan',
  replay: 'replaySettlementWorldCoverageTraversal',
});
