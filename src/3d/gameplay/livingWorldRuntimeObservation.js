/**
 * Read-only runtime observation for existing living-world actors.
 * This does not own AI, combat, spawning, factions or scene mutation.
 * @module gameplay/livingWorldRuntimeObservation
 */
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const entries = (value) => Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === 'function' ? [...value] : [];
const distance = (actor, player) => {
  const p = actor?.object3D?.position ?? actor?.position;
  if (!p || !player) return Infinity;
  return Math.hypot(finite(p.x) - finite(player.x), finite(p.z) - finite(player.z));
};
const stateOf = (actor) => String(actor?.state ?? actor?.aiState ?? actor?.behaviorState ?? 'unknown');
const stableId = (actor, index) => String(actor?.id ?? actor?.uuid ?? actor?.object3D?.uuid ?? `${index}`);

export function observeLivingWorldRuntime({ state = {}, playerPosition = null, maxActors = 64 } = {}) {
  const lanes = [['npc', state.npcs], ['animal', state.animals], ['creature', state.creatures], ['dragon', state.dragons]];
  const actors = [];
  for (const [kind, source] of lanes) {
    for (const [index, actor] of entries(source).entries()) {
      if (!actor || actors.length >= maxActors) break;
      const d = distance(actor, playerPosition);
      actors.push({ kind, id: stableId(actor, index), distanceMeters: Number.isFinite(d) ? Number(d.toFixed(2)) : null, state: stateOf(actor), visible: Boolean(actor.visible ?? actor.object3D?.visible ?? true) });
    }
  }
  actors.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return Object.freeze({ actorCount: actors.length, truncated: actors.length >= maxActors, actors: Object.freeze(actors) });
}

export function writeLivingWorldObservation(actor, observation) {
  if (!actor?.object3D?.userData || !observation) return false;
  actor.object3D.userData.livingWorldObservation = observation;
  return true;
}
