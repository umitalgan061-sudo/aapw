/**
 * Şafak Kartalı — deterministic living-world director.
 * Extends the existing NPC/creature/faction/event runtime through adapters;
 * it does not create a second spawn, material or placement framework.
 */

const STATES = Object.freeze({
  PATROL: 'patrol', DETECT: 'detect', INVESTIGATE: 'investigate', CHASE: 'chase',
  ATTACK: 'attack', RETURN: 'return', FLEE: 'flee', WORK: 'work', TRAVEL: 'travel',
  REST: 'rest', ROAM: 'roam', THREATENED: 'threatened', DORMANT: 'dormant',
});

function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function distance2D(a, b) { return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hash32(input) {
  let hash = 2166136261;
  for (const ch of String(input ?? 'seed')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function deterministicLivingWorldSeed(id, worldSeed = 0x51afac) {
  return hash32(`${worldSeed}:${id}`);
}

export function sampleOccupationSchedule({ schedule = [], hour = 12, fallback = 'rest' } = {}) {
  if (!Array.isArray(schedule) || schedule.length === 0) return fallback;
  const normalizedHour = ((finite(hour) % 24) + 24) % 24;
  const entry = schedule.find((item) => {
    const start = finite(item?.startHour);
    const end = finite(item?.endHour);
    return end >= start ? normalizedHour >= start && normalizedHour < end : normalizedHour >= start || normalizedHour < end;
  });
  return entry?.activity ?? fallback;
}

export function evaluatePerception({ observer, target, forward = { x: 0, z: 1 }, visionRange = 18, fovDegrees = 110, hearingRange = 8, lineOfSight = true, noise = 0 } = {}) {
  if (!observer || !target) return { detected: false, mode: 'invalid', distanceMeters: Infinity };
  const distanceMeters = distance2D(observer, target);
  if (!Number.isFinite(distanceMeters)) return { detected: false, mode: 'invalid', distanceMeters };
  if (noise > 0 && distanceMeters <= hearingRange) return { detected: true, mode: 'hearing', distanceMeters };
  if (!lineOfSight || distanceMeters > visionRange) return { detected: false, mode: 'occluded', distanceMeters };
  if (distanceMeters < 1e-6) return { detected: true, mode: 'vision', distanceMeters };
  const dx = target.x - observer.x; const dz = target.z - observer.z;
  const forwardLength = Math.hypot(forward.x, forward.z) || 1;
  const dot = clamp((forward.x * dx + forward.z * dz) / (forwardLength * distanceMeters), -1, 1);
  const angle = Math.acos(dot) * 180 / Math.PI;
  return { detected: angle <= fovDegrees / 2, mode: angle <= fovDegrees / 2 ? 'vision' : 'behind', distanceMeters, angleDegrees: angle };
}

export function createReputationLedger(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clamp(finite(value), -100, 100)]));
  return {
    get(factionId) { return values.get(String(factionId)) ?? 0; },
    adjust(factionId, delta) { const next = clamp(this.get(factionId) + finite(delta), -100, 100); values.set(String(factionId), next); return next; },
    snapshot() { return Object.fromEntries(values.entries()); },
  };
}

export function evaluateCrime({ law, actorId, victimFaction, severity = 1, witnessIds = [] } = {}) {
  const wanted = Boolean(law?.enabled && finite(severity) > 0 && witnessIds.length > 0);
  return { wanted, severity: clamp(finite(severity), 0, 5), actorId: actorId ?? null, victimFaction: victimFaction ?? null, witnessIds: [...new Set(witnessIds)] };
}

export function createDeterministicWorldEventDirector({ seed = 1, cooldownSeconds = 30, maxEventsPerTick = 2 } = {}) {
  let elapsed = 0; let serial = 0; let lastEventAt = -Infinity;
  return {
    tick(delta, candidates = []) {
      elapsed += clamp(finite(delta), 0, 0.25);
      if (elapsed - lastEventAt < cooldownSeconds || !Array.isArray(candidates) || candidates.length === 0) return [];
      const count = Math.min(maxEventsPerTick, candidates.length);
      const events = [];
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates[(hash32(`${seed}:${serial}:${index}`) + serial) % candidates.length];
        events.push({ id: `world-event-${serial++}`, type: candidate.type ?? 'ambient', anchorId: candidate.anchorId ?? null, seed: hash32(`${seed}:${candidate.anchorId ?? index}:${serial}`) });
      }
      lastEventAt = elapsed;
      return events;
    },
    get elapsedSeconds() { return elapsed; },
  };
}

export function createLivingWorldAgent({
  id,
  role = 'guard',
  factionId = 'neutral',
  home = { x: 0, z: 0 },
  schedule = [],
  speedMps = 1.4,
  threatRadiusMeters = 14,
  attackRadiusMeters = 2.2,
  fleeRadiusMeters = 7,
  simulationLod,
  onMove = () => {},
  onAttack = () => {},
  onStateChange = () => {},
} = {}) {
  if (!id) throw new Error('living world agent id is required');
  let state = role === 'wildlife' ? STATES.ROAM : STATES.PATROL;
  let target = null; let suspicion = 0; let lastKnown = null; let stateTime = 0;
  const setState = (next, reason) => { if (state === next) return; const previous = state; state = next; stateTime = 0; onStateChange({ id, previous, state, reason }); };
  const locomote = (destination, delta, multiplier = 1) => {
    const dx = finite(destination?.x) - finite(home.x); const dz = finite(destination?.z) - finite(home.z);
    const length = Math.hypot(dx, dz) || 1; onMove({ id, x: dx / length * speedMps * multiplier * delta, z: dz / length * speedMps * multiplier * delta, destination });
  };
  return {
    id, role, factionId,
    observe({ delta = 0, nowHour = 12, threat = null, targetPosition = null, targetFaction = null, lineOfSight = true, noise = 0, distanceToPlayer = Infinity } = {}) {
      const tick = simulationLod?.step ? simulationLod.step(delta, distanceToPlayer, Boolean(threat)) : clamp(finite(delta), 0, 0.25);
      if (!(tick > 0)) return { id, state, tickSeconds: 0, skipped: true };
      stateTime += tick;
      const activity = sampleOccupationSchedule({ schedule, hour: nowHour, fallback: role === 'farmer' ? 'work' : 'patrol' });
      const perceived = targetPosition ? evaluatePerception({ observer: home, target: targetPosition, lineOfSight, noise }) : { detected: false, distanceMeters: Infinity };
      if (threat && perceived.detected && perceived.distanceMeters <= fleeRadiusMeters) setState(STATES.FLEE, 'immediate-threat');
      else if (perceived.detected && perceived.distanceMeters <= attackRadiusMeters) { target = targetPosition; lastKnown = { ...targetPosition }; setState(STATES.ATTACK, 'close-detection'); }
      else if (perceived.detected) { target = targetPosition; lastKnown = { ...targetPosition }; suspicion = clamp(suspicion + tick * 1.5, 0, 1); setState(STATES.CHASE, perceived.mode); }
      else if (suspicion > 0 && lastKnown) { suspicion = clamp(suspicion - tick * 0.35, 0, 1); setState(STATES.INVESTIGATE, 'lost-contact'); }
      else if (role === 'farmer' && activity === 'work') setState(STATES.WORK, 'schedule');
      else if (role === 'farmer' && activity === 'travel') setState(STATES.TRAVEL, 'schedule');
      else if (activity === 'rest') setState(STATES.REST, 'schedule');
      else if (role === 'wildlife') setState(threat ? STATES.THREATENED : STATES.ROAM, threat ? 'threat' : 'ecology');
      else if (state === STATES.INVESTIGATE && stateTime > 3) setState(STATES.RETURN, 'investigation-complete');
      else if (state === STATES.RETURN && distance2D(home, lastKnown ?? home) < 1) setState(STATES.PATROL, 'home-reached');
      if (state === STATES.ATTACK) onAttack({ id, targetPosition, factionId: targetFaction, delta: tick });
      else if (state === STATES.FLEE) locomote({ x: home.x - finite(targetPosition?.x), z: home.z - finite(targetPosition?.z) }, tick, 1.35);
      else if (state === STATES.CHASE && target) locomote(target, tick, 1);
      else if (state === STATES.RETURN && lastKnown) locomote(home, tick, 0.8);
      return { id, state, tickSeconds: tick, activity, suspicion, perceived, lastKnown };
    },
    get state() { return state; },
    get snapshot() { return { id, role, factionId, state, suspicion, lastKnown }; },
  };
}

export { STATES };
