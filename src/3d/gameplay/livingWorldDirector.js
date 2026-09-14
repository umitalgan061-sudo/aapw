/**
 * Şafak Kartalı — bounded living-world director.
 * Orchestrates existing ActorRegistry/navigation/combat/world-event/faction owners;
 * it does not replace them or create a second framework.
 */

const PHASES = ['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee'];
const MAX_ACTORS = 256;
const MAX_TICKS = 64;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const dist = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}

function digest(value) {
  const text = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createLivingWorldDirector({
  actorRegistry,
  navigation,
  combat,
  worldEvents,
  factions,
  placement,
  seed = 1,
  budgets = {},
} = {}) {
  let disposed = false;
  let tickIndex = 0;
  const state = new Map();
  const telemetry = { transitions: 0, sensed: 0, commands: 0, skipped: 0, rejected: 0 };

  function readActors() {
    const actors = typeof actorRegistry?.list === 'function' ? actorRegistry.list() : [];
    return [...actors].filter((a) => a?.id).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, MAX_ACTORS);
  }

  function sense(actor, target, now) {
    const range = clamp(actor?.perception?.range, 1, 200);
    const hearing = clamp(actor?.perception?.hearing, 0, 100);
    const distance = dist(actor?.position, target?.position);
    const los = typeof actorRegistry?.hasLineOfSight === 'function'
      ? Boolean(actorRegistry.hasLineOfSight(actor.id, target?.id))
      : distance <= range;
    const noise = clamp(target?.noiseLevel, 0, 100);
    const heard = distance <= hearing && noise > 0;
    const visible = distance <= range && los && !target?.stealthed;
    telemetry.sensed += Number(visible || heard);
    return { distance, visible, heard, threat: Boolean(visible || heard), now };
  }

  function choosePhase(actor, target, observation, current) {
    if (actor?.health <= 0) return 'flee';
    if (!observation.threat) return current === 'return' ? 'patrol' : current === 'patrol' ? 'patrol' : 'investigate';
    if (observation.distance > 30) return 'investigate';
    if (observation.distance > 8) return 'chase';
    if (target?.health > 0 && observation.visible) return 'attack';
    return 'return';
  }

  function issue(actor, phase, target) {
    const command = { actorId: actor.id, phase, targetId: target?.id || null, tick: tickIndex };
    const result = phase === 'attack'
      ? combat?.engage?.(command)
      : phase === 'flee'
        ? navigation?.flee?.(command)
        : phase === 'chase' || phase === 'investigate'
          ? navigation?.moveTo?.(command)
          : phase === 'return'
            ? navigation?.returnToPost?.(command)
            : navigation?.patrol?.(command);
    telemetry.commands += Number(result !== false);
    return command;
  }

  function update({ now = 0, delta = 0, targetByActor = {} } = {}) {
    if (disposed) return read();
    tickIndex += 1;
    const actorBudget = clamp(budgets.actorTicks ?? 24, 1, MAX_ACTORS);
    const tickActors = readActors().filter((_, index) => index < actorBudget);
    telemetry.skipped += Math.max(0, readActors().length - tickActors.length);
    for (const actor of tickActors) {
      const target = targetByActor[actor.id] || actorRegistry?.getThreat?.(actor.id) || null;
      const observation = target ? sense(actor, target, now) : { distance: Infinity, visible: false, heard: false, threat: false, now };
      const previous = state.get(actor.id) || { phase: actor.schedule?.phase || 'patrol', lastTick: -1 };
      const minInterval = clamp(actor?.lod === 'far' ? 4 : actor?.lod === 'mid' ? 2 : 1, 1, 8);
      if (tickIndex - previous.lastTick < minInterval) { telemetry.skipped += 1; continue; }
      const phase = choosePhase(actor, target, observation, previous.phase);
      if (!PHASES.includes(phase)) { telemetry.rejected += 1; continue; }
      if (phase !== previous.phase) telemetry.transitions += 1;
      state.set(actor.id, { phase, lastTick: tickIndex, distance: observation.distance, threat: observation.threat });
      issue(actor, phase, target);
      factions?.recordObservation?.({ actorId: actor.id, targetId: target?.id || null, phase, tick: tickIndex });
      if (phase === 'attack') worldEvents?.publish?.({ type: 'npc-combat-intent', actorId: actor.id, targetId: target?.id || null, tick: tickIndex, seed });
    }
    return read();
  }

  function read() {
    const actors = [...state.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([actorId, value]) => ({ actorId, ...value }));
    return Object.freeze({ tick: tickIndex, actors: Object.freeze(actors), telemetry: Object.freeze({ ...telemetry }), fingerprint: digest({ tick: tickIndex, actors, telemetry }) });
  }

  function dispose() { disposed = true; state.clear(); }
  return Object.freeze({ update, read, dispose, manifest: Object.freeze({ id: 'safak-kartali-living-world-director', phases: PHASES, maxActors: MAX_ACTORS, maxTicks: MAX_TICKS, sharedOwners: ['ActorRegistry', 'Navigation', 'Combat', 'WorldEventSystem', 'Faction/Reputation/Diplomacy', 'WorldAssetPlacementPipeline'] }) });
}
