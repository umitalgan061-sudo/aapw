/**
 * World-aware target selection adapter for the existing player combat contract.
 *
 * This is intentionally stateless. It does not become a combat controller and does not mutate
 * the authoritative player/NPC state. It ranks already-visible caller-supplied targets using the
 * selected world context, stance and weapon profile so lock-on, melee and ranged presentation can
 * remain consistent across the full world.
 *
 * @module gameplay/playerWorldCoverageThreatAdapter
 */

const MAX_TARGETS = 32;
const MAX_RANGE_METERS = 120;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

function position(value) {
  return { x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) };
}

function distance(player, target) {
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  return Math.hypot(dx, dz);
}

function angularErrorDegrees(playerPosition, headingDegrees, targetPosition) {
  const desired = Math.atan2(targetPosition.x - playerPosition.x, targetPosition.z - playerPosition.z) * 180 / Math.PI;
  let delta = (desired - finite(headingDegrees) + 540) % 360 - 180;
  return Math.abs(delta);
}

function relationScore(target) {
  if (target.hostile === true || target.factionRelation === 'hostile') return 1;
  if (target.factionRelation === 'neutral') return 0.2;
  if (target.factionRelation === 'friendly') return -0.5;
  return 0;
}

function visibilityScore(target) {
  if (target.visible === false || target.culled === true) return 0;
  if (target.lineOfSight === false) return 0.35;
  return target.lineOfSight === true ? 1 : 0.7;
}

function elevationScore(playerPosition, targetPosition) {
  return clamp(1 - Math.abs(targetPosition.y - playerPosition.y) / 18, 0, 1);
}

function surfacePenalty(target, worldContext) {
  const slope = finite(worldContext?.selectedSample?.slopeDegrees);
  const water = finite(worldContext?.surfaceContext?.waterWeight);
  if (water > 0.85 && target.requiresGround === true) return 0.45;
  if (slope > 45 && target.groundBound === true) return 0.76;
  return 1;
}

export function normalizeWorldAwareTarget(target, index = 0) {
  const object = target?.object3D ?? target;
  const targetPosition = position(object?.position ?? target?.position);
  const id = String(target?.id ?? target?.actorId ?? target?.name ?? `target-${index}`);
  return {
    id,
    position: targetPosition,
    hostile: target?.hostile === true,
    factionRelation: String(target?.factionRelation ?? 'unknown'),
    visible: target?.visible !== false,
    culled: target?.culled === true,
    lineOfSight: target?.lineOfSight,
    active: target?.active !== false,
    lockOnEligible: target?.lockOnEligible !== false,
    rangedEligible: target?.rangedEligible !== false,
    groundBound: target?.groundBound === true,
    requiresGround: target?.requiresGround === true,
    threat: clamp(target?.threat, 0, 1),
    healthRatio: clamp(target?.healthRatio, 0, 1),
    distanceHint: target?.distanceMeters === undefined ? null : Math.max(0, finite(target.distanceMeters)),
  };
}

export function scoreWorldAwareTarget(target, {
  playerPosition = {},
  headingDegrees = 0,
  worldContext = {},
  combat = {},
  maxDistanceMeters = MAX_RANGE_METERS,
} = {}) {
  const player = position(playerPosition);
  const row = normalizeWorldAwareTarget(target);
  const range = row.distanceHint ?? distance(player, row.position);
  const angularError = angularErrorDegrees(player, headingDegrees, row.position);
  const rangeScore = clamp(1 - range / Math.max(1, maxDistanceMeters), 0, 1);
  const angleScore = clamp(1 - angularError / 180, 0, 1);
  const threat = row.threat * 0.42;
  const relation = relationScore(row) * 0.34;
  const visibility = visibilityScore(row) * 0.28;
  const elevation = elevationScore(player, row.position) * 0.12;
  const stanceBoost = combat?.lockOn ? angleScore * 0.14 : angleScore * 0.05;
  const rangedBoost = combat?.rangedReady && row.rangedEligible ? rangeScore * 0.16 : 0;
  const meleeBoost = !combat?.rangedReady && row.lockOnEligible ? rangeScore * 0.12 : 0;
  const penalty = surfacePenalty(row, worldContext);
  const eligible = row.active && row.visible && !row.culled && row.lockOnEligible && range <= maxDistanceMeters;
  const score = (rangeScore * 0.3 + angleScore * 0.22 + threat + relation + visibility + elevation + stanceBoost + rangedBoost + meleeBoost) * penalty;
  return freeze({
    id: row.id,
    distanceMeters: Math.round(range * 1000) / 1000,
    angularErrorDegrees: Math.round(angularError * 100) / 100,
    eligible,
    score: Math.round(score * 10000) / 10000,
    ranged: combat?.rangedReady === true,
    surface: worldContext?.surfaceContext?.dominantSurface ?? 'unknown',
  });
}

export function rankWorldAwareTargets(targets = [], options = {}) {
  const rows = (Array.isArray(targets) ? targets : [])
    .slice(0, MAX_TARGETS)
    .map((target, index) => scoreWorldAwareTarget(target, options));
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return freeze(rows);
}

export function chooseWorldAwareLockOnTarget(targets = [], options = {}) {
  const ranked = rankWorldAwareTargets(targets, options);
  return ranked.find((target) => target.eligible) ?? null;
}

export function buildWorldAwareCombatContext({ targets = [], playerPosition = {}, headingDegrees = 0, worldContext = {}, combat = {} } = {}) {
  const ranked = rankWorldAwareTargets(targets, { playerPosition, headingDegrees, worldContext, combat });
  const primary = ranked.find((target) => target.eligible) ?? null;
  const rangedCandidate = ranked.find((target) => target.eligible && target.ranged);
  return freeze({
    lockOnTargetId: primary?.id ?? null,
    lockOnReady: Boolean(primary),
    rangedTargetId: rangedCandidate?.id ?? null,
    rankedTargetCount: ranked.length,
    visibleTargetCount: ranked.filter((target) => target.eligible).length,
    topTargets: ranked.slice(0, 8),
    worldSurface: worldContext?.surfaceContext?.dominantSurface ?? 'unknown',
    biome: worldContext?.selectedSample?.biome ?? 'unknown',
  });
}

export function validateWorldAwareThreatContext(context) {
  const errors = [];
  if (!context || typeof context !== 'object') errors.push('missing-context');
  if (context?.rankedTargetCount < 0) errors.push('negative-target-count');
  if (context?.visibleTargetCount > context?.rankedTargetCount) errors.push('visible-target-count-overflow');
  if (context?.topTargets?.length > 8) errors.push('top-target-limit');
  if (context?.lockOnTargetId && !context.topTargets.some((target) => target.id === context.lockOnTargetId)) errors.push('primary-not-ranked');
  return Object.freeze({ ok: errors.length === 0, errors });
}
