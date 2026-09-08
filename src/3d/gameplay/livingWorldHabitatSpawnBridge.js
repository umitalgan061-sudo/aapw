/**
 * Shared bridge for existing NPC/fauna spawn owners.
 * The caller remains responsible for spawning, scene ownership and disposal; this module only
 * normalizes canonical world context, applies the fail-closed habitat gate and annotates admitted
 * actors for runtime proof/telemetry.
 */
import { applyLivingWorldHabitatAdmission } from './livingWorldHabitatRuntimeGate.js';

const actorKind = (actor = {}) => actor.kind ?? actor.type ?? actor.userData?.kind ?? 'wildlife';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function buildHabitatSpawnWorld({ actor = {}, sample = {}, groundCollider = null, nav = null } = {}) {
  const x = finite(actor.position?.x ?? actor.object3D?.position?.x);
  const z = finite(actor.position?.z ?? actor.object3D?.position?.z);
  const groundY = Number.isFinite(Number(sample.groundY)) ? Number(sample.groundY)
    : Number.isFinite(Number(groundCollider?.getGroundHeight?.(x, z))) ? Number(groundCollider.getGroundHeight(x, z)) : 0;
  return {
    ...sample,
    kind: actorKind(actor),
    groundY,
    navReachable: sample.navReachable !== false && nav?.isReachable ? Boolean(nav.isReachable(x, z)) : sample.navReachable,
  };
}

export function admitHabitatSpawn({ actor, sample, groundCollider, nav } = {}) {
  if (!actor || typeof actor !== 'object') return Object.freeze({ admitted: false, reason: 'invalid-actor' });
  const world = buildHabitatSpawnWorld({ actor, sample, groundCollider, nav });
  return applyLivingWorldHabitatAdmission(actor, world);
}

export function admitHabitatSpawns(actors = [], context = {}) {
  const admitted = [];
  const rejected = [];
  for (const actor of Array.isArray(actors) ? actors : []) {
    const result = admitHabitatSpawn({ actor, sample: context.sampleForActor?.(actor) ?? context.sample ?? {}, groundCollider: context.groundCollider, nav: context.nav });
    (result.admitted ? admitted : rejected).push({ actor, result });
  }
  return Object.freeze({ admitted: Object.freeze(admitted), rejected: Object.freeze(rejected), total: admitted.length + rejected.length });
}

export function habitatSpawnTelemetry(batch = {}) {
  return Object.freeze({
    total: Number(batch.total ?? 0),
    admitted: batch.admitted?.length ?? 0,
    rejected: batch.rejected?.length ?? 0,
    rejectedReasons: Object.freeze((batch.rejected ?? []).reduce((counts, entry) => {
      const reason = entry.result?.reason ?? 'unknown';
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {})),
  });
}
