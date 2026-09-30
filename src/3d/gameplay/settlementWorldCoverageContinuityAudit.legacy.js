/**
 * Read-only audit helpers for the World Coverage continuity bridge.
 * The audit turns the bridge output into compact operational flags.
 */
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API,
  planSettlementWorldCoverageTransition,
  buildSettlementWorldCoverageApproachNodes,
  validateSettlementWorldCoverageContinuity,
} from './settlementWorldCoverageContinuity.js';

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 180) : fallback;
};
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function auditGateway(plan) {
  const candidates = plan.gatewayCandidates ?? [];
  const state = text(plan.transition?.gatewayState, 'blocked');
  return {
    state,
    candidateCount: candidates.length,
    inContinuityWindow: candidates.filter((candidate) => candidate.insideContinuityWindow).length,
    nearEntrance: candidates.filter((candidate) => candidate.distanceToEntrance <= 24).length,
    usable: ['available', 'inside', 'departure-only'].includes(state),
  };
}
function auditApproach(nodes, chunkKey) {
  const sameOwner = nodes.filter((node) => node.ownerChunkKey === chunkKey).length;
  const readable = nodes.filter((node) => node.readable).length;
  const stageCounts = {};
  for (const node of nodes) stageCounts[node.stage] = (stageCounts[node.stage] || 0) + 1;
  return { count: nodes.length, sameOwner, readable, foreignOwnerCount: nodes.length - sameOwner, stageCounts };
}
function auditServices(services = []) {
  const unique = new Set(services.map((service) => service.id));
  return {
    count: services.length,
    uniqueCount: unique.size,
    knownCount: services.filter((service) => ['gate','market','tavern','blacksmith','farm','barracks','stable','house'].includes(service.id)).length,
    labelsPresent: services.filter((service) => text(service.label)).length,
  };
}

export function auditSettlementWorldCoverageContinuity(options = {}) {
  const validation = validateSettlementWorldCoverageContinuity(options);
  const plan = planSettlementWorldCoverageTransition(options);
  const approach = buildSettlementWorldCoverageApproachNodes(options);
  const gateway = auditGateway(plan);
  const approachAudit = auditApproach(approach, plan.context.ownerChunkKey);
  const services = auditServices(plan.services);
  const errors = [...validation.errors];
  if (gateway.candidateCount < 1) errors.push('no-gateway-candidates');
  if (approachAudit.count < 1) errors.push('no-approach-nodes');
  if (approachAudit.foreignOwnerCount > approachAudit.count * 0.5) errors.push('approach-owner-drift');
  if (services.uniqueCount !== services.count) errors.push('duplicate-services');
  const score = errors.length === 0 ? 1 : Math.max(0, 1 - errors.length / 8);
  const report = {
    version: 1,
    policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
    settlementId: plan.settlementId,
    stage: plan.transition.stage,
    gateway,
    approach: approachAudit,
    services,
    geography: plan.context.geography,
    lod: plan.lod,
    score: Math.round(score * 100) / 100,
    ok: errors.length === 0,
    errors,
  };
  return freeze({ ...report, fingerprint: digest(report) });
}

export function buildSettlementWorldCoverageContinuityMatrix(options = {}) {
  const modes = ['desktop', 'mobile'];
  const positions = [
    { id: 'far', offset: 240 },
    { id: 'approach', offset: 110 },
    { id: 'threshold', offset: 28 },
    { id: 'inside', offset: 0 },
  ];
  const rows = [];
  for (const mode of modes) {
    for (const position of positions) {
      const settlement = options.settlement ?? {};
      const anchor = settlement.anchor ?? { x: 0, y: 0, z: 0 };
      const player = position.offset === 0
        ? { inSettlement: true, position: anchor }
        : { inSettlement: false, position: { x: number(anchor.x) + position.offset, y: number(anchor.y), z: number(anchor.z) } };
      const rowOptions = { ...options, mobile: mode === 'mobile', player, initialPlayer: player };
      const plan = planSettlementWorldCoverageTransition(rowOptions);
      rows.push({
        mode,
        position: position.id,
        stage: plan.transition.stage,
        gatewayState: plan.transition.gatewayState,
        lod: plan.lod.factor,
        budget: plan.lod.budget,
        canEnter: plan.transition.canEnter,
        canExit: plan.transition.canExit,
        digest: plan.digest,
      });
    }
  }
  return freeze({ rows, rowCount: rows.length, fingerprint: digest(rows) });
}

export function validateSettlementWorldCoverageContinuityAudit(options = {}) {
  const report = auditSettlementWorldCoverageContinuity(options);
  const matrix = buildSettlementWorldCoverageContinuityMatrix(options);
  const errors = [...report.errors];
  if (matrix.rowCount !== 8) errors.push('matrix-row-count');
  if (!matrix.rows.some((row) => row.gatewayState === 'available')) errors.push('matrix-no-entry-state');
  if (!matrix.rows.some((row) => row.gatewayState === 'inside')) errors.push('matrix-no-inside-state');
  return freeze({ ok: errors.length === 0, errors, score: errors.length ? Math.max(0, 1 - errors.length / 10) : 1, report, matrix, fingerprint: digest({ report, matrix }) });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_AUDIT_API = Object.freeze({
  version: 1,
  stageCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.stages.length,
  gatewayStateCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.gatewayStates.length,
  serviceCount: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_API.services.length,
});
