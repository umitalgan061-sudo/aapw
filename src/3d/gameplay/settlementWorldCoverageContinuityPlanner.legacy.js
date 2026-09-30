/**
 * Cross-scale planner facade.
 *
 * The facade combines continuity transition evidence with the canonical profile
 * catalogue. It is intentionally read-only: callers remain responsible for
 * executing settlement actions and attaching world assets through their
 * existing authoritative systems.
 */
import {
  buildSettlementWorldCoverageContinuityCatalogue,
  findSettlementWorldCoverageContinuityProfiles,
  getSettlementWorldCoverageContinuityProfile,
  validateSettlementWorldCoverageContinuityCatalogue,
} from './settlementWorldCoverageContinuityCatalog.js';
import {
  planSettlementWorldCoverageTransition,
  buildSettlementWorldCoverageApproachNodes,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY,
} from './settlementWorldCoverageContinuity.js';

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => {
  const n = String(value ?? '').trim();
  return n ? n.slice(0, 180) : fallback;
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
  for (let i = 0; i < source.length; i += 1) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const SERVICE_INTENT_PRIORITY = Object.freeze({
  gate: ['enter', 'exit', 'travel'],
  market: ['talk', 'trade', 'buy', 'sell'],
  tavern: ['talk', 'rest', 'acceptQuest', 'advanceQuest'],
  blacksmith: ['talk', 'craft', 'equip', 'trade'],
  farm: ['interact', 'rest', 'trade', 'travel'],
  barracks: ['talk', 'train', 'acceptQuest', 'equip'],
  stable: ['talk', 'travel', 'rest', 'trade'],
  house: ['interact', 'save', 'rest', 'talk'],
});

function contextForSurface(surface = {}) {
  const biome = text(surface.biome, '').toLowerCase();
  const layer = text(surface.layer, biome).toLowerCase();
  if (surface.isWater || layer.includes('shore') || layer.includes('river')) return 'shoreline';
  if (biome.includes('moor')) return 'north-moor';
  if (biome.includes('mountain') || layer.includes('alpine')) return 'mountain-pass';
  if (biome.includes('forest') || biome.includes('woodland')) return 'woodland';
  if (biome.includes('river') || layer.includes('lowland')) return 'river-lowland';
  if (biome.includes('cold') || biome.includes('snow') || layer.includes('snow')) return 'north-cold';
  return 'north-temperate';
}
function currentStage(plan) {
  return plan?.transition?.stage || 'far';
}
function scoreService(serviceId, profile, context, player) {
  const base = profile?.priority ?? 0;
  const access = player?.inSettlement ? 0.24 : serviceId === 'gate' ? 0.26 : -0.12;
  const fatigue = number(player?.fatigue, 0) >= 70 && (serviceId === 'tavern' || serviceId === 'house') ? 0.18 : 0;
  const trade = number(player?.copper, 0) > 0 && serviceId === 'market' ? 0.07 : 0;
  const climate = context === 'shoreline' && serviceId === 'stable' ? 0.04 : 0;
  return Math.round(clamp01(base + access + fatigue + trade + climate) * 10000) / 10000;
}
function buildServiceRecommendation(plan, context, player) {
  const rows = [];
  for (const service of plan.services) {
    const profiles = findSettlementWorldCoverageContinuityProfiles({ serviceId: service.id, stage: currentStage(plan), context });
    const profile = profiles[0] ?? getSettlementWorldCoverageContinuityProfile(service.id, currentStage(plan), context);
    const score = scoreService(service.id, profile, context, player);
    rows.push({
      serviceId: service.id,
      intent: SERVICE_INTENT_PRIORITY[service.id]?.[0] ?? 'interact',
      score,
      profileId: profile?.id ?? '',
      focus: profile?.focus ?? service.kind,
      tags: profile?.tags ?? [],
      density: profile?.density ?? 0,
      readable: profile?.readable !== false,
    });
  }
  return rows.sort((a, b) => b.score - a.score || a.serviceId.localeCompare(b.serviceId));
}

export function createSettlementWorldCoverageContinuityPlan(options = {}) {
  const transition = planSettlementWorldCoverageTransition(options);
  const surfaceContext = text(options.context, contextForSurface(options.surface));
  const player = options.player ?? options.initialPlayer ?? {};
  const serviceRecommendations = buildServiceRecommendation(transition, surfaceContext, player);
  const approachNodes = buildSettlementWorldCoverageApproachNodes(options);
  const catalogueCheck = validateSettlementWorldCoverageContinuityCatalogue();
  const result = {
    version: 1,
    policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
    settlementId: transition.settlementId,
    stage: transition.transition.stage,
    gatewayState: transition.transition.gatewayState,
    context: surfaceContext,
    worldChunkKey: transition.context.worldChunkKey,
    ownerChunkKey: transition.context.ownerChunkKey,
    lod: transition.lod,
    gateway: {
      canEnter: transition.transition.canEnter,
      canExit: transition.transition.canExit,
      candidateCount: transition.gatewayCandidates.length,
    },
    serviceRecommendations,
    recommendedService: serviceRecommendations[0] ?? null,
    approach: {
      count: approachNodes.length,
      readableCount: approachNodes.filter((node) => node.readable).length,
      nodes: approachNodes,
    },
    catalogue: {
      ok: catalogueCheck.ok,
      count: catalogueCheck.count,
      fingerprint: catalogueCheck.fingerprint,
    },
  };
  return freeze({ ...result, fingerprint: digest(result) });
}

export function createSettlementWorldCoverageContinuityQuickActions(options = {}, limit = 4) {
  const plan = createSettlementWorldCoverageContinuityPlan(options);
  const rows = plan.serviceRecommendations.slice(0, Math.max(1, Math.min(8, Math.trunc(number(limit, 4))))).map((row, index) => ({
    rank: index + 1,
    serviceId: row.serviceId,
    intent: row.intent,
    score: row.score,
    profileId: row.profileId,
    focus: row.focus,
  }));
  return freeze({ settlementId: plan.settlementId, stage: plan.stage, rows, fingerprint: digest(rows) });
}

export function verifySettlementWorldCoverageContinuityReplay(options = {}) {
  const first = createSettlementWorldCoverageContinuityPlan(options);
  const second = createSettlementWorldCoverageContinuityPlan(JSON.parse(JSON.stringify(options)));
  const equal = first.fingerprint === second.fingerprint && JSON.stringify(first) === JSON.stringify(second);
  return freeze({ ok: equal, firstFingerprint: first.fingerprint, secondFingerprint: second.fingerprint, equal });
}

export function summarizeSettlementWorldCoverageContinuity(options = {}) {
  const plan = createSettlementWorldCoverageContinuityPlan(options);
  const top = plan.recommendedService;
  return freeze({
    settlementId: plan.settlementId,
    stage: plan.stage,
    gatewayState: plan.gatewayState,
    context: plan.context,
    recommendedService: top?.serviceId ?? 'gate',
    recommendedIntent: top?.intent ?? 'enter',
    readableApproachNodes: plan.approach.readableCount,
    approachNodes: plan.approach.count,
    lod: plan.lod.factor,
    budget: plan.lod.budget,
    fingerprint: plan.fingerprint,
  });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_PLANNER_API = Object.freeze({
  version: 1,
  plan: 'createSettlementWorldCoverageContinuityPlan',
  quickActions: 'createSettlementWorldCoverageContinuityQuickActions',
  replay: 'verifySettlementWorldCoverageContinuityReplay',
  summary: 'summarizeSettlementWorldCoverageContinuity',
  generatedProfiles: buildSettlementWorldCoverageContinuityCatalogue().length,
});
