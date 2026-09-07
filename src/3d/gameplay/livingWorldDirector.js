/**
 * Şafak Kartalı — deterministic living-world director.
 * Extends the existing NPC/creature/faction/event runtime through adapters;
 * it does not create a second spawn, material or placement framework.
 */

const STATES = Object.freeze({
  PATROL: 'patrol', DETECT: 'detect', INVESTIGATE: 'investigate', CHASE: 'chase',
  ATTACK: 'attack', RETURN: 'return', FLEE: 'flee', WORK: 'work', TRAVEL: 'travel',
  REST: 'rest', ROAM: 'roam', THREATENED: 'threatened', DORMANT: 'dormant', STEALTH: 'stealth',
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

export function evaluatePerception({
  observer,
  target,
  forward = { x: 0, z: 1 },
  visionRange = 18,
  fovDegrees = 110,
  hearingRange = 8,
  lineOfSight = true,
  noise = 0,
  stealth = 0,
  lighting = 1,
  cover = 0,
} = {}) {
  if (!observer || !target) return { detected: false, mode: 'invalid', distanceMeters: Infinity };
  const distanceMeters = distance2D(observer, target);
  if (!Number.isFinite(distanceMeters)) return { detected: false, mode: 'invalid', distanceMeters };
  const normalizedStealth = clamp(stealth, 0, 1);
  const normalizedLighting = clamp(lighting, 0.15, 1);
  const normalizedCover = clamp(cover, 0, 1);
  const effectiveVisionRange = visionRange * (1 - normalizedStealth * 0.65) * (0.65 + normalizedLighting * 0.35) * (1 - normalizedCover * 0.45);
  const effectiveHearingRange = hearingRange * (1 - normalizedStealth * 0.25);
  if (noise > 0 && distanceMeters <= effectiveHearingRange) {
    return { detected: true, mode: 'hearing', distanceMeters, effectiveVisionRange, effectiveHearingRange };
  }
  if (!lineOfSight || distanceMeters > effectiveVisionRange) return { detected: false, mode: 'occluded', distanceMeters, effectiveVisionRange, effectiveHearingRange };
  if (distanceMeters < 1e-6) return { detected: true, mode: 'vision', distanceMeters, effectiveVisionRange, effectiveHearingRange };
  const dx = target.x - observer.x; const dz = target.z - observer.z;
  const forwardLength = Math.hypot(finite(forward.x), finite(forward.z)) || 1;
  const dot = clamp((forward.x * dx + forward.z * dz) / (forwardLength * distanceMeters), -1, 1);
  const angle = Math.acos(dot) * 180 / Math.PI;
  const halfFov = (fovDegrees * (1 - normalizedStealth * 0.30)) / 2;
  return {
    detected: angle <= halfFov,
    mode: angle <= halfFov ? 'vision' : 'behind',
    distanceMeters,
    angleDegrees: angle,
    effectiveVisionRange,
    effectiveHearingRange,
  };
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
  const locomote = (from, destination, delta, multiplier = 1) => {
    const source = from ?? home;
    const dx = finite(destination?.x) - finite(source?.x); const dz = finite(destination?.z) - finite(source?.z);
    const length = Math.hypot(dx, dz);
    if (!(length > 1e-6)) return;
    onMove({ id, x: dx / length * speedMps * multiplier * delta, z: dz / length * speedMps * multiplier * delta, destination });
  };
  return {
    id, role, factionId,
    observe({
      delta = 0,
      nowHour = 12,
      threat = null,
      targetPosition = null,
      selfPosition = home,
      targetFaction = null,
      lineOfSight = true,
      noise = 0,
      stealth = 0,
      lighting = 1,
      cover = 0,
      distanceToPlayer = Infinity,
    } = {}) {
      const tick = simulationLod?.step ? simulationLod.step(delta, distanceToPlayer, Boolean(threat)) : clamp(finite(delta), 0, 0.25);
      if (!(tick > 0)) return { id, state, tickSeconds: 0, skipped: true };
      stateTime += tick;
      const activity = sampleOccupationSchedule({ schedule, hour: nowHour, fallback: role === 'farmer' ? 'work' : 'patrol' });
      const perceived = targetPosition ? evaluatePerception({ observer: selfPosition, target: targetPosition, lineOfSight, noise, stealth, lighting, cover }) : { detected: false, distanceMeters: Infinity };
      if (threat && perceived.detected && perceived.distanceMeters <= fleeRadiusMeters) setState(STATES.FLEE, 'immediate-threat');
      else if (perceived.detected && perceived.distanceMeters <= attackRadiusMeters) { target = targetPosition; lastKnown = { ...targetPosition }; setState(STATES.ATTACK, 'close-detection'); }
      else if (perceived.detected) { target = targetPosition; lastKnown = { ...targetPosition }; suspicion = clamp(suspicion + tick * 1.5, 0, 1); setState(STATES.CHASE, perceived.mode); }
      else if (suspicion > 0 && lastKnown) { suspicion = clamp(suspicion - tick * 0.35, 0, 1); setState(STATES.INVESTIGATE, 'lost-contact'); }
      else if (role === 'farmer' && activity === 'work') setState(STATES.WORK, 'schedule');
      else if (role === 'farmer' && activity === 'travel') setState(STATES.TRAVEL, 'schedule');
      else if (activity === 'rest') setState(STATES.REST, 'schedule');
      else if (role === 'wildlife') setState(threat ? STATES.THREATENED : STATES.ROAM, threat ? 'threat' : 'ecology');
      else if (state === STATES.INVESTIGATE && stateTime > 3) setState(STATES.RETURN, 'investigation-complete');
      else if (state === STATES.RETURN && distance2D(selfPosition, home) < 1) setState(STATES.PATROL, 'home-reached');
      else if (role !== 'wildlife' && stealth > 0.65 && !perceived.detected) setState(STATES.STEALTH, 'low-detection');
      if (state === STATES.ATTACK) onAttack({ id, targetPosition, factionId: targetFaction, delta: tick });
      else if (state === STATES.FLEE) {
        const away = { x: finite(selfPosition?.x) + (finite(selfPosition?.x) - finite(targetPosition?.x)), z: finite(selfPosition?.z) + (finite(selfPosition?.z) - finite(targetPosition?.z)) };
        locomote(selfPosition, away, tick, 1.35);
      } else if (state === STATES.CHASE && target) locomote(selfPosition, target, tick, 1);
      else if (state === STATES.RETURN && lastKnown) locomote(selfPosition, home, tick, 0.8);
      return { id, state, tickSeconds: tick, activity, suspicion, perceived, lastKnown, target: target ? { ...target } : null, stateTime };
    },
    get state() { return state; },
    get snapshot() { return { id, role, factionId, state, suspicion, lastKnown, target }; },
  };
}

export { STATES };
