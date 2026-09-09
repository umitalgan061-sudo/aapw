/**
 * Owner-service reaction policy: relation/faction/reputation/diplomacy/law resolution, phase-decision
 * gates and the small dependency-injected service-call bridge (navigation/encounters/law/world-events).
 *
 * Extracted from `livingWorldReactionRuntime.js` (Run 358) to bring that file under GOVERNANCE.md's
 * 600-line file cap (Altın Kural 7) — a pure lossless move, zero logic changes. These functions were
 * already private to the runtime module (no external importers per a repo-wide grep of every
 * `livingWorldReactionRuntime` consumer); they share one cohesive concern (resolving how an actor
 * should react to a target and telling the caller-owned services about it) distinct from the
 * runtime's own state machine and tick-loop orchestration, which remain in the original module.
 *
 * `freeze`/`finite`/`clamp`/`asId`/`normalizeSeverity`/`readPosition` are small primitive duplicates
 * of the identically-named helpers in `livingWorldReactionRuntime.js`, matching this codebase's
 * existing, widespread convention (see e.g. `roadSurfaceProfile.js`, `naturalGeologyPlacement.js`,
 * `terrainMacroWeathering.js` for the numeric one-liners, and `livingWorldDirectorRuntimeAdapter.js`
 * for an existing sibling duplicate of `readPosition` itself) of each leaf module owning its own copy
 * of these small, dependency-free helpers rather than importing them — this keeps the split strictly
 * one-directional (this module imports nothing from `livingWorldReactionRuntime.js`, which imports
 * from it instead), avoiding a circular import between the two files.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);

function normalizeSeverity(value) {
  return clamp(value, 0, 100);
}

function readPosition(actor) {
  const p = actor?.object3D?.position ?? actor?.position ?? actor?.transform?.position;
  if (!p) return null;
  const x = Number(p.x);
  const z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

const HOSTILE_WANTED_THRESHOLD = 45;
const ALERT_REPUTATION_THRESHOLD = -25;
const FRIENDLY_REPUTATION_THRESHOLD = 25;

function normalizeReputation(value) {
  return Math.max(-100, Math.min(100, finite(value, 0)));
}

function normalizeWanted(value) {
  return Math.max(0, Math.min(100, finite(value, 0)));
}

function defaultRelation(reputation) {
  if (reputation >= FRIENDLY_REPUTATION_THRESHOLD) return 'friendly';
  if (reputation <= ALERT_REPUTATION_THRESHOLD) return 'hostile';
  return 'neutral';
}

export function callService(service, candidates, args, fallback = null) {
  if (!service || typeof service !== 'object') return fallback;
  for (const name of candidates) {
    if (typeof service[name] !== 'function') continue;
    try {
      const value = service[name](...args);
      if (value != null) return value;
    } catch {
      // An owner service is allowed to reject an optional query; the runtime falls back safely.
    }
  }
  return fallback;
}

function resolveFaction(actor, services) {
  const direct = actor?.factionId ?? actor?.faction?.id ?? actor?.userData?.factionId;
  if (direct) return asId(direct);
  const resolved = callService(services?.factions, ['getFactionIdForActor', 'resolveActorFaction', 'getActorFactionId'], [actor], null);
  return asId(resolved, 'neutral');
}

function resolveReputation(actor, target, services) {
  const actorFaction = resolveFaction(actor, services);
  const targetFaction = asId(target?.factionId ?? target?.faction?.id, 'neutral');
  const explicit = target?.reputation ?? actor?.reputationByFaction?.[targetFaction];
  if (Number.isFinite(Number(explicit))) return normalizeReputation(explicit);
  const queried = callService(
    services?.reputation,
    ['getReputation', 'getRelationScore', 'readReputation'],
    [actor, target, actorFaction, targetFaction],
    null,
  );
  return normalizeReputation(queried);
}

function resolveDiplomaticRelation(actor, target, services) {
  const actorFaction = resolveFaction(actor, services);
  const targetFaction = asId(target?.factionId ?? target?.faction?.id, 'neutral');
  const relation = callService(
    services?.diplomacy,
    ['getRelation', 'getDiplomaticState', 'resolveTreaty'],
    [actorFaction, targetFaction],
    null,
  );
  if (typeof relation === 'string') return relation;
  if (relation?.state) return asId(relation.state);
  return actorFaction === targetFaction ? 'allied' : 'unknown';
}

function resolveWanted(actor, target, services) {
  const explicit = target?.wanted ?? target?.crime?.wantedLevel;
  if (Number.isFinite(Number(explicit))) return normalizeWanted(explicit);
  const queried = callService(
    services?.law,
    ['getWantedLevel', 'getWanted', 'resolveWantedLevel'],
    [target, actor],
    null,
  );
  return normalizeWanted(queried);
}

function resolveCrimeSeverity(target, services) {
  const explicit = target?.crime?.severity ?? target?.crimeSeverity;
  if (Number.isFinite(Number(explicit))) return normalizeSeverity(explicit);
  const queried = callService(
    services?.law,
    ['getCrimeSeverity', 'resolveCrimeSeverity', 'getRecentCrimeSeverity'],
    [target],
    null,
  );
  return normalizeSeverity(queried);
}

export function relationSnapshot(actor, target, services) {
  const reputation = resolveReputation(actor, target, services);
  const diplomaticRelation = resolveDiplomaticRelation(actor, target, services);
  const wanted = resolveWanted(actor, target, services);
  const crimeSeverity = resolveCrimeSeverity(target, services);
  const relation = defaultRelation(reputation);
  return freeze({
    actorFaction: resolveFaction(actor, services),
    targetFaction: asId(target?.factionId ?? target?.faction?.id, 'neutral'),
    reputation,
    relation,
    diplomaticRelation,
    wanted,
    crimeSeverity,
    hostile: relation === 'hostile' || diplomaticRelation === 'war',
    reportable: wanted >= HOSTILE_WANTED_THRESHOLD || crimeSeverity >= 50,
  });
}

function thresholdForPhase(actor, relation, options) {
  const base = Math.max(0, Math.min(1, finite(options?.detectionThreshold, 0.62)));
  const courage = clamp(actor?.courage ?? actor?.traits?.courage, 0, 1);
  let threshold = base - courage * 0.15;
  if (relation.hostile) threshold -= 0.1;
  if (relation.reputation >= FRIENDLY_REPUTATION_THRESHOLD) threshold += 0.2;
  return clamp(threshold, 0.25, 0.9);
}

export function nextPhaseForSignal(actor, signal, relation, options) {
  const threshold = thresholdForPhase(actor, relation, options);
  if (!signal || signal.score < threshold) return 'patrol';
  if (relation.reportable || relation.hostile) return 'detect';
  if (signal.signal.audible && !signal.signal.visible) return 'investigate';
  if (signal.signal.suspicious || signal.signal.visible) return 'investigate';
  return 'detect';
}

export function canAttack(relation, signal, services) {
  if (!signal) return false;
  if (relation.hostile) return true;
  if (relation.reportable && relation.wanted >= HOSTILE_WANTED_THRESHOLD) return true;
  const decision = callService(services?.encounters, ['canAttack', 'isAttackAuthorized', 'resolveAttackPermission'], [relation, signal.signal], null);
  return decision === true;
}

export function canChase(relation, signal, services) {
  if (!signal) return false;
  const decision = callService(services?.encounters, ['shouldChase', 'isChaseAuthorized', 'resolveChaseIntent'], [relation, signal.signal], null);
  if (decision != null) return Boolean(decision);
  return relation.hostile || relation.reportable || signal.signal.suspicious;
}

export function scheduleDirective(actor, schedule, clockSeconds, services) {
  if (!schedule) return null;
  const directive = callService(
    services?.occupation,
    ['buildOccupationDirective', 'resolveOccupationDirective', 'getCurrentOccupationDirective'],
    [schedule, clockSeconds, readPosition(actor), actor],
    null,
  );
  if (directive && typeof directive === 'object') {
    return freeze({
      accepted: directive.accepted !== false,
      phase: asId(directive.phase, 'work'),
      activityId: asId(directive.activityId, 'idle'),
      locationId: asId(directive.locationId, ''),
      shouldTravel: Boolean(directive.shouldTravel),
      destination: directive.destination ?? null,
      nextChangeSeconds: Math.max(0, finite(directive.nextChangeSeconds, 0)),
    });
  }
  return freeze({
    accepted: true,
    phase: asId(schedule.phase, 'work'),
    activityId: asId(schedule.activityId, 'idle'),
    locationId: asId(schedule.locationId, ''),
    shouldTravel: Boolean(schedule.shouldTravel),
    destination: schedule.destination ?? null,
    nextChangeSeconds: Math.max(0, finite(schedule.nextChangeSeconds, 0)),
  });
}

export function callNavigation(services, actor, directive) {
  if (!directive?.destination) return { accepted: true, invoked: false };
  const result = callService(
    services?.navigation,
    ['requestTravel', 'requestPath', 'setDestination', 'goTo'],
    [actor, directive.destination, directive],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

export function callCombat(services, actor, directive) {
  if (directive?.kind !== 'attack') return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.encounters,
    ['requestAttack', 'beginCombat', 'enterCombat'],
    [actor, directive.targetId, directive],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

export function callLawReport(services, event, relation) {
  if (!relation.reportable) return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.law,
    ['reportCrime', 'recordWantedObservation', 'publishCrimeObservation'],
    [event, relation],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}

export function callWorldEvent(services, event) {
  if (!event) return freeze({ accepted: true, invoked: false });
  const result = callService(
    services?.worldEvents,
    ['publish', 'emit', 'queue'],
    [event],
    null,
  );
  return freeze({ accepted: result !== false, invoked: result != null, result: result ?? null });
}
