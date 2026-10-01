/**
 * Bounded runtime coordinator for the existing NPC/animal/creature/dragon controllers.
 * It owns scheduling/telemetry only; behavior, combat, spawn, faction and scene ownership stay
 * with the established modules that expose `update(delta, playerPosition)` / `dispose()`.
 * @module gameplay/livingWorldRuntimeSlice
 */

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const distanceTo = (actor, player) => {
  const position = actor?.object3D?.position ?? actor?.position;
  if (!position || !player) return Infinity;
  return Math.hypot(finite(position.x) - finite(player.x), finite(position.z) - finite(player.z));
};
const asEntries = (value) => Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === 'function' ? [...value] : [];

export const LIVING_WORLD_RUNTIME_BUDGET = Object.freeze({
  npc: Object.freeze({ nearMeters: 90, farIntervalSeconds: 0.25, distantIntervalSeconds: 0.75 }),
  animal: Object.freeze({ nearMeters: 80, farIntervalSeconds: 0.35, distantIntervalSeconds: 1 }),
  creature: Object.freeze({ nearMeters: 70, farIntervalSeconds: 0.25, distantIntervalSeconds: 1 }),
  dragon: Object.freeze({ nearMeters: 140, farIntervalSeconds: 0.2, distantIntervalSeconds: 0.6 }),
});

function laneFor(kind) { return LIVING_WORLD_RUNTIME_BUDGET[kind] ?? LIVING_WORLD_RUNTIME_BUDGET.creature; }

function invokeLane(entries, kind, delta, playerPosition, elapsed, accumulators) {
  const lane = laneFor(kind);
  let updated = 0;
  let skipped = 0;
  for (const entry of asEntries(entries)) {
    if (!entry || typeof entry.update !== 'function') continue;
    const distance = distanceTo(entry, playerPosition);
    const interval = distance <= lane.nearMeters ? 0 : distance <= lane.nearMeters * 2 ? lane.farIntervalSeconds : lane.distantIntervalSeconds;
    const accumulated = finite(accumulators.get(entry)) + delta;
    accumulators.set(entry, accumulated);
    if (interval > 0 && accumulated < interval) { skipped += 1; continue; }
    const step = Math.min(accumulated, 0.25);
    accumulators.set(entry, 0);
    entry.update(step, playerPosition);
    if (entry.object3D?.userData) entry.object3D.userData.livingWorldRuntime = { kind, distanceMeters: Number(distance.toFixed(2)), intervalSeconds: interval, elapsedSeconds: Number(elapsed.toFixed(2)) };
    updated += 1;
  }
  return { updated, skipped };
}

export function createLivingWorldRuntimeSlice({ state = {}, playerPositionProvider = () => null } = {}) {
  let elapsed = 0;
  let disposed = false;
  const accumulators = new WeakMap();
  const telemetry = { frames: 0, updated: 0, skipped: 0, lanes: {} };
  const lanes = [
    ['npc', () => state.npcs ?? []],
    ['animal', () => state.animals ?? []],
    ['creature', () => state.creatures ?? []],
    ['dragon', () => state.dragons ?? []],
  ];
  return {
    tick(delta = 0, playerPosition = playerPositionProvider()) {
      if (disposed) return Object.freeze({ disposed: true, ...telemetry });
      const dt = Math.max(0, Math.min(finite(delta), 0.25));
      elapsed += dt;
      telemetry.frames += 1;
      telemetry.updated = 0;
      telemetry.skipped = 0;
      for (const [kind, read] of lanes) {
        const result = invokeLane(read(), kind, dt, playerPosition, elapsed, accumulators);
        telemetry.lanes[kind] = result;
        telemetry.updated += result.updated;
        telemetry.skipped += result.skipped;
      }
      return Object.freeze({ disposed: false, elapsedSeconds: Number(elapsed.toFixed(3)), frames: telemetry.frames, updated: telemetry.updated, skipped: telemetry.skipped, lanes: Object.freeze({ ...telemetry.lanes }) });
    },
    dispose() { disposed = true; },
  };
}
