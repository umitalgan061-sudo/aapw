/**
 * Settlement World Coverage Continuity Bridge.
 *
 * This module closes the gap between the authored settlement runtime and the
 * deterministic geographic asset runtime already present on main. It owns no
 * terrain, road, hydrology, NPC, combat, material or persistence state.
 *
 * The bridge provides four useful things for the playable world:
 *   1. deterministic approach/arrival/departure transition records;
 *   2. a safe settlement gateway inside the geographic chunk lifecycle;
 *   3. cross-scale LOD/budget hints that preserve settlement readability;
 *   4. a compact proof packet that can be persisted or inspected by tests.
 */
import {
  buildAnchorRuntimeContext,
  chunkKeyFor,
  continuityWindowForChunk,
  pointInWindow,
  continuitySeedFor,
  deterministicJitter,
} from '../world/geographicAssetRuntimeOrchestrator.js';
import {
  getSettlementService,
  getSettlementRoute,
  getSettlementUxMessage,
  validateSettlementContent,
  createSettlementContentManifest,
} from './settlementCampaignContent.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY = Object.freeze({
  id: 'settlement-world-coverage-continuity-2026-09-14-v1',
  deterministic: true,
  settlementAuthority: 'settlement-campaign-runtime',
  worldAuthority: 'geographic-asset-runtime-orchestrator',
  noTerrainMutation: true,
  noRoadMutation: true,
  noHydrologyMutation: true,
  noModelAttachment: true,
  noParallelQuestState: true,
  noParallelSaveState: true,
  maxApproachNodes: 24,
  maxTransitionHistory: 24,
  maxGatewayCandidates: 16,
  approachRadiusMeters: 150,
  arrivalRadiusMeters: 36,
  departureRadiusMeters: 52,
  mobileLodScale: 0.62,
});

const SERVICE_IDS = Object.freeze([
  'gate', 'market', 'tavern', 'blacksmith', 'farm', 'barracks', 'stable', 'house',
]);
const TRANSITION_STAGES = Object.freeze([
  'far', 'approach', 'threshold', 'inside', 'service', 'departure', 'resume',
]);
const GATEWAY_STATES = Object.freeze([
  'available', 'approach-only', 'blocked', 'inside', 'departure-only',
]);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const int = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(number(value, fallback))));
const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 180) : fallback;
};
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const list = (value) => Array.isArray(value) ? value : [];
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function freeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
}

function normalizePoint(raw = {}) {
  return {
    x: number(raw.x ?? raw.worldX),
    y: number(raw.y ?? raw.worldY),
    z: number(raw.z ?? raw.worldZ),
  };
}
function normalizeSettlement(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(source.id ?? source.settlementId, 'settlement'),
    regionId: text(source.regionId, 'unknown-region'),
    anchor: normalizePoint(source.anchor),
    entrance: normalizePoint(source.entrance ?? source.gateway),
    services: [...new Set(list(source.services).map((id) => text(id)).filter((id) => SERVICE_IDS.includes(id)))],
    approachRadius: Math.max(10, number(source.approachRadius, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.approachRadiusMeters)),
    arrivalRadius: Math.max(5, number(source.arrivalRadius, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.arrivalRadiusMeters)),
    departureRadius: Math.max(5, number(source.departureRadius, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.departureRadiusMeters)),
    worldChunkKey: text(source.worldChunkKey),
  };
}
function normalizeSurface(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    biome: text(source.biome, 'unknown'),
    layer: text(source.layer, source.biome ?? 'unknown'),
    moisture: clamp01(source.moisture, 0.5),
    elevationMeters: number(source.elevationMeters),
    slopeDegrees: Math.max(0, number(source.slopeDegrees)),
    settlementDistanceMeters: source.settlementDistanceMeters == null ? null : Math.max(0, number(source.settlementDistanceMeters)),
    roadDistanceMeters: source.roadDistanceMeters == null ? null : Math.max(0, number(source.roadDistanceMeters)),
    shorelineDistanceMeters: source.shorelineDistanceMeters == null ? null : Math.max(0, number(source.shorelineDistanceMeters)),
    isWater: bool(source.isWater),
    waterBody: text(source.waterBody),
  };
}

function distanceXZ(a, b) {
  const left = normalizePoint(a); const right = normalizePoint(b);
  return Math.hypot(left.x - right.x, left.z - right.z);
}
function radialStage(distance, settlement) {
  if (distance <= settlement.arrivalRadius) return 'threshold';
  if (distance <= settlement.approachRadius) return 'approach';
  return 'far';
}
function stageIndex(stage) {
  return TRANSITION_STAGES.indexOf(stage);
}
function nearestService(distance, services) {
  if (!services.length) return 'gate';
  const index = Math.max(0, Math.min(services.length - 1, Math.floor(distance % services.length)));
  return services[index];
}
function serviceMeta(serviceId) {
  const service = getSettlementService(serviceId);
  return service ? {
    id: service.id,
    label: text(service.label, service.id),
    kind: text(service.kind, 'settlement'),
  } : { id: serviceId, label: serviceId, kind: 'unknown' };
}
function routeMeta(routeId) {
  const route = getSettlementRoute(routeId);
  return route ? {
    id: text(route.id, routeId),
    label: text(route.label, routeId),
    destination: text(route.destination),
    risk: text(route.risk),
  } : { id: routeId, label: routeId, destination: '', risk: 'unknown' };
}

function computeGatewayState({ stage, inSettlement, settlementOpen, defeated }) {
  if (defeated) return stage === 'threshold' || inSettlement ? 'departure-only' : 'blocked';
  if (!settlementOpen) return inSettlement ? 'inside' : 'approach-only';
  if (inSettlement) return 'inside';
  if (stage === 'threshold') return 'available';
  if (stage === 'approach') return 'approach-only';
  return 'blocked';
}
function computeLod({ stage, mobile, visibility = 1 }) {
  const base = stage === 'far' ? 0.35 : stage === 'approach' ? 0.65 : stage === 'threshold' ? 0.85 : 1;
  return clamp01(base * (mobile ? SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.mobileLodScale : 1) * clamp01(visibility, 1), 0);
}
function transitionBudget(stage, mobile) {
  const desktop = stage === 'far' ? 8 : stage === 'approach' ? 16 : stage === 'threshold' ? 24 : 28;
  return Math.max(2, Math.floor(desktop * (mobile ? SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.mobileLodScale : 1)));
}

export function buildSettlementWorldCoverageContinuityContext({
  settlement = {},
  player = {},
  surface = {},
  regionId = null,
  seed = 0,
  mobile = false,
} = {}) {
  const normalizedSettlement = normalizeSettlement(settlement);
  const playerPoint = normalizePoint(player.position ?? player);
  const normalizedSurface = normalizeSurface(surface);
  const distance = distanceXZ(playerPoint, normalizedSettlement.anchor);
  const stage = radialStage(distance, normalizedSettlement);
  const worldChunkKey = normalizedSettlement.worldChunkKey || chunkKeyFor(normalizedSettlement.anchor.x, normalizedSettlement.anchor.z);
  const continuitySeed = continuitySeedFor({ worldX: normalizedSettlement.anchor.x, worldZ: normalizedSettlement.anchor.z, seed, familyId: normalizedSettlement.id });
  const geoContext = buildAnchorRuntimeContext({
    anchor: normalizedSettlement.anchor,
    surface: normalizedSurface,
    regionId: regionId || normalizedSettlement.regionId,
    mode: 'settlementEdge',
    seed,
    mobile,
  });
  return freeze({
    version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_VERSION,
    settlement: normalizedSettlement,
    player: playerPoint,
    distance,
    stage,
    stageIndex: stageIndex(stage),
    inSettlement: bool(player.inSettlement),
    settlementOpen: player.settlementOpen !== false,
    defeated: bool(player.defeated) || number(player.health, 100) <= 0,
    worldChunkKey,
    continuitySeed,
    ownerChunkKey: geoContext.ownerChunkKey,
    boundaryBand: geoContext.boundaryBand,
    geography: {
      regionId: geoContext.region?.id || regionId || normalizedSettlement.regionId,
      regionScore: geoContext.regionScore.score,
      biome: normalizedSurface.biome,
      layer: normalizedSurface.layer,
      slopeDegrees: normalizedSurface.slopeDegrees,
    },
    mobile: Boolean(mobile),
    lod: computeLod({ stage, mobile }),
    budget: transitionBudget(stage, mobile),
  });
}

function buildGatewayCandidates(context, count = 16) {
  const total = Math.max(1, Math.min(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.maxGatewayCandidates, int(count, 1, 16, 16)));
  const center = context.settlement.entrance;
  const candidates = [];
  for (let ordinal = 0; ordinal < total; ordinal += 1) {
    const jitter = deterministicJitter(context.continuitySeed, ordinal + 101);
    const radius = 6 + ordinal * 2.25;
    const point = {
      x: Math.round((center.x + jitter.x * radius) * 100) / 100,
      y: center.y,
      z: Math.round((center.z + jitter.z * radius) * 100) / 100,
    };
    const distanceToEntrance = distanceXZ(point, center);
    const insideWindow = pointInWindow({ x: point.x, z: point.z }, continuityWindowForChunk(context.worldChunkKey));
    candidates.push({
      id: `${context.settlement.id}-gateway-${ordinal + 1}`,
      ordinal,
      point,
      distanceToEntrance: Math.round(distanceToEntrance * 1000) / 1000,
      ownerChunkKey: context.ownerChunkKey,
      insideContinuityWindow: insideWindow,
      score: Math.round((1 / (1 + distanceToEntrance) + (insideWindow ? 0.15 : 0)) * 100000) / 100000,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return freeze(candidates);
}

export function planSettlementWorldCoverageTransition(options = {}) {
  const context = buildSettlementWorldCoverageContinuityContext(options);
  const gatewayState = computeGatewayState(context);
  const services = context.settlement.services.length ? context.settlement.services : [...SERVICE_IDS];
  const gatewayCandidates = buildGatewayCandidates(context, options.gatewayCandidateCount);
  const primaryService = context.inSettlement ? nearestService(context.distance, services) : 'gate';
  const routeId = text(options.routeId, 'north_gate');
  const route = routeMeta(routeId);
  const transition = {
    stage: context.inSettlement ? 'inside' : context.stage,
    from: text(options.fromStage, context.stage),
    to: context.inSettlement ? 'inside' : context.stage,
    gatewayState,
    canEnter: gatewayState === 'available',
    canExit: gatewayState === 'inside' || gatewayState === 'departure-only',
    canApproach: gatewayState !== 'blocked',
    primaryService: serviceMeta(primaryService),
    route,
  };
  return freeze({
    version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_VERSION,
    policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
    settlementId: context.settlement.id,
    context,
    transition,
    gatewayCandidates,
    lod: { factor: context.lod, stage: context.stage, budget: context.budget },
    services: services.map(serviceMeta),
    digest: digest({ context, transition, gatewayCandidates, services }),
  });
}

export function buildSettlementWorldCoverageApproachNodes({
  settlement = {},
  surface = {},
  regionId = null,
  seed = 0,
  mobile = false,
  count = 24,
} = {}) {
  const context = buildSettlementWorldCoverageContinuityContext({ settlement, surface, regionId, player: { position: settlement.anchor }, seed, mobile });
  const total = Math.max(1, Math.min(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.maxApproachNodes, int(count, 1, 24, 24)));
  const nodes = [];
  for (let ordinal = 0; ordinal < total; ordinal += 1) {
    const jitter = deterministicJitter(context.continuitySeed ^ 0x51ed270b, ordinal);
    const angle = jitter.yaw + ordinal * 0.45;
    const radius = context.settlement.approachRadius * (0.18 + (ordinal / Math.max(1, total - 1)) * 0.82);
    const point = {
      x: Math.round((context.settlement.anchor.x + Math.cos(angle) * radius) * 100) / 100,
      y: context.settlement.anchor.y,
      z: Math.round((context.settlement.anchor.z + Math.sin(angle) * radius) * 100) / 100,
    };
    const stage = radialStage(distanceXZ(point, context.settlement.anchor), context.settlement);
    nodes.push({
      id: `${context.settlement.id}-approach-${String(ordinal + 1).padStart(2, '0')}`,
      point,
      stage,
      chunkKey: chunkKeyFor(point.x, point.z),
      ownerChunkKey: context.ownerChunkKey,
      lod: computeLod({ stage, mobile }),
      readable: stage !== 'far' || ordinal % 3 === 0,
      serviceHint: ordinal === 0 ? 'gate' : SERVICE_IDS[(ordinal - 1) % SERVICE_IDS.length],
      distanceMeters: Math.round(distanceXZ(point, context.settlement.anchor) * 100) / 100,
    });
  }
  nodes.sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return freeze(nodes);
}

function validateCheckpoint(checkpoint, settlementId) {
  const source = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
  const errors = [];
  if (text(source.settlementId) !== settlementId) errors.push('settlement-mismatch');
  if (!TRANSITION_STAGES.includes(text(source.stage, 'far'))) errors.push('invalid-stage');
  if (!GATEWAY_STATES.includes(text(source.gatewayState, 'blocked'))) errors.push('invalid-gateway-state');
  if (!Number.isFinite(Number(source.sequence))) errors.push('invalid-sequence');
  return freeze({ ok: errors.length === 0, errors });
}

export function createSettlementWorldCoverageContinuitySession({
  settlement = {},
  initialPlayer = {},
  surface = {},
  regionId = null,
  seed = 0,
  mobile = false,
  now = () => Date.now(),
  historyLimit = 24,
} = {}) {
  const settlementData = normalizeSettlement(settlement);
  let player = clone(initialPlayer) || {};
  let sequence = 0;
  let disposed = false;
  let history = [];
  let checkpoint = null;
  const cap = int(historyLimit, 1, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.maxTransitionHistory, 24);
  const record = (type, payload = {}) => {
    const row = freeze({ sequence: ++sequence, type, at: number(now(), 0), ...clone(payload) });
    history = [...history, row].slice(-cap);
    return row;
  };
  const context = () => buildSettlementWorldCoverageContinuityContext({ settlement: settlementData, player, surface, regionId, seed, mobile });
  const transition = (fromStage = null) => planSettlementWorldCoverageTransition({ settlement: settlementData, player, surface, regionId, seed, mobile, fromStage });
  const checkpointNow = (metadata = {}) => {
    const plan = transition();
    checkpoint = freeze({
      version: 1,
      settlementId: settlementData.id,
      stage: plan.transition.stage,
      gatewayState: plan.transition.gatewayState,
      activeService: plan.transition.primaryService.id,
      worldChunkKey: plan.context.worldChunkKey,
      sequence,
      at: number(now(), 0),
      metadata: clone(metadata),
      digest: digest({ settlementId: settlementData.id, stage: plan.transition.stage, gatewayState: plan.transition.gatewayState, sequence, metadata }),
    });
    record('checkpoint', { checkpoint });
    return freeze({ ok: true, checkpoint, plan });
  };
  const resume = (rawCheckpoint) => {
    const check = validateCheckpoint(rawCheckpoint, settlementData.id);
    if (!check.ok) return freeze({ ok: false, reason: check.errors[0], errors: check.errors });
    checkpoint = freeze(clone(rawCheckpoint));
    record('resume', { checkpoint });
    return freeze({ ok: true, checkpoint, plan: transition() });
  };
  const move = (nextPlayer = {}) => {
    if (disposed) return freeze({ ok: false, reason: 'disposed' });
    player = { ...player, ...clone(nextPlayer) };
    const plan = transition();
    record('move', { stage: plan.transition.stage, gatewayState: plan.transition.gatewayState, worldChunkKey: plan.context.worldChunkKey });
    return freeze({ ok: true, plan, player: clone(player) });
  };
  const enter = () => {
    if (disposed) return freeze({ ok: false, reason: 'disposed' });
    const plan = transition();
    if (!plan.transition.canEnter) return freeze({ ok: false, reason: plan.transition.gatewayState === 'approach-only' ? 'too-far' : 'settlement-closed', plan });
    player = { ...player, inSettlement: true, settlementOpen: true };
    record('enter', { settlementId: settlementData.id, serviceId: 'gate' });
    return freeze({ ok: true, plan: transition('threshold'), player: clone(player) });
  };
  const exit = () => {
    if (disposed) return freeze({ ok: false, reason: 'disposed' });
    const plan = transition();
    if (!plan.transition.canExit) return freeze({ ok: false, reason: 'not-inside', plan });
    player = { ...player, inSettlement: false };
    record('exit', { settlementId: settlementData.id, routeId: 'north_gate' });
    return freeze({ ok: true, plan: transition('inside'), player: clone(player) });
  };
  const service = (serviceId) => {
    if (disposed) return freeze({ ok: false, reason: 'disposed' });
    const id = text(serviceId);
    if (!SERVICE_IDS.includes(id)) return freeze({ ok: false, reason: 'unknown-service' });
    if (!player.inSettlement) return freeze({ ok: false, reason: 'outside-settlement' });
    if (!getSettlementService(id)) return freeze({ ok: false, reason: 'content-service-missing' });
    record('service', { serviceId: id });
    return freeze({ ok: true, service: serviceMeta(id), message: text(getSettlementUxMessage(`${id}_greeting`)?.text) });
  };
  const snapshot = () => freeze({ version: 1, disposed, sequence, player: clone(player), history: clone(history), checkpoint: clone(checkpoint), settlementId: settlementData.id, digest: digest({ sequence, player, history, checkpoint, settlementId: settlementData.id }) });
  const proof = () => {
    const plan = transition();
    const content = validateSettlementContent();
    const manifest = createSettlementContentManifest();
    const continuity = {
      policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
      digest: plan.digest,
      stage: plan.transition.stage,
      gatewayState: plan.transition.gatewayState,
      serviceCount: plan.services.length,
      approachNodes: buildSettlementWorldCoverageApproachNodes({ settlement: settlementData, surface, regionId, seed, mobile }).length,
      historyCount: history.length,
      checkpoint: clone(checkpoint),
      contentValid: Boolean(content?.ok),
      contentDigest: digest(manifest),
      noTerrainMutation: true,
      noModelAttachment: true,
    };
    return freeze({ version: 1, settlementId: settlementData.id, continuity, fingerprint: digest(continuity) });
  };
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    record('dispose', { settlementId: settlementData.id });
    return true;
  };
  return Object.freeze({ context, transition, move, enter, exit, service, checkpoint: checkpointNow, resume, snapshot, proof, dispose });
}

export function validateSettlementWorldCoverageContinuity(options = {}) {
  const settlement = normalizeSettlement(options.settlement);
  const errors = [];
  if (!settlement.id) errors.push('settlement-id');
  if (!SERVICE_IDS.every((id) => settlement.services.length === 0 || settlement.services.includes(id))) errors.push('service-vocabulary');
  const plan = planSettlementWorldCoverageTransition(options);
  if (!plan.digest) errors.push('missing-digest');
  if (!plan.gatewayCandidates.length) errors.push('gateway-candidates');
  if (!plan.services.length) errors.push('services');
  const approach = buildSettlementWorldCoverageApproachNodes(options);
  if (!approach.length) errors.push('approach-nodes');
  if (plan.context.worldChunkKey !== chunkKeyFor(plan.context.settlement.anchor.x, plan.context.settlement.anchor.z)) errors.push('chunk-key');
  return freeze({ ok: errors.length === 0, errors, fingerprint: digest({ plan: plan.digest, approachCount: approach.length, settlement: settlement.id }) });
}

export function createSettlementWorldCoverageContinuityProof(options = {}) {
  const validation = validateSettlementWorldCoverageContinuity(options);
  const plan = planSettlementWorldCoverageTransition(options);
  const approachNodes = buildSettlementWorldCoverageApproachNodes(options);
  return freeze({
    version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_VERSION,
    policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY,
    settlementId: plan.settlementId,
    validation,
    transition: plan.transition,
    gateway: { state: plan.transition.gatewayState, candidates: plan.gatewayCandidates },
    approach: { count: approachNodes.length, nodes: approachNodes.slice(0, SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.maxApproachNodes) },
    lod: plan.lod,
    services: plan.services,
    fingerprint: digest({ validation, transition: plan.transition, gateway: plan.gatewayCandidates, approachNodes, lod: plan.lod }),
  });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_VERSION,
  services: [...SERVICE_IDS],
  stages: [...TRANSITION_STAGES],
  gatewayStates: [...GATEWAY_STATES],
});
