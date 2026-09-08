/**
 * Thin runtime admission gate for existing living-world actors.
 * It validates canonical context before an owner attaches or updates an actor.
 * It does not spawn, navigate, own factions or replace the shared placement core.
 */
import { habitatDecision, habitatEvidence } from './livingWorldHabitatContract.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function buildLivingWorldHabitatContext(actor = {}, world = {}) {
  const kind = actor.kind ?? actor.type ?? 'wildlife';
  return {
    kind,
    biome: world.biome ?? actor.biome,
    water: Boolean(world.water ?? actor.water),
    slopeDegrees: finite(world.slopeDegrees ?? actor.slopeDegrees),
    roadDistance: Math.max(0, finite(world.roadDistance ?? actor.roadDistance)),
    settlementDistance: Math.max(0, finite(world.settlementDistance ?? actor.settlementDistance)),
    groundY: finite(world.groundY ?? actor.groundY),
    navReachable: world.navReachable !== false && actor.navReachable !== false,
    surface: world.surface ?? actor.surface ?? 'wilderness',
    habitatKey: world.habitatKey ?? actor.habitatKey ?? '',
  };
}

export function admitLivingWorldActor(actor = {}, world = {}) {
  const sample = buildLivingWorldHabitatContext(actor, world);
  const decision = habitatDecision(sample);
  const evidence = habitatEvidence(sample);
  return Object.freeze({
    admitted: decision.accepted,
    sample: Object.freeze(sample),
    decision,
    evidence,
    reason: decision.reason,
  });
}

export function applyLivingWorldHabitatAdmission(actor = {}, world = {}) {
  const result = admitLivingWorldActor(actor, world);
  if (result.admitted) {
    actor.userData ??= {};
    actor.userData.livingWorldHabitat = result.evidence;
    return result;
  }
  return Object.freeze({ ...result, rejected: true });
}

export function habitatRuntimeDigest(actor = {}, world = {}) {
  return admitLivingWorldActor(actor, world).evidence.digest;
}
