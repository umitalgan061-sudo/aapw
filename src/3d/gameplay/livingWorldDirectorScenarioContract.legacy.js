/**
 * Pure replay/QA contract for the existing living-world director runtime.
 * It normalizes caller-owned scenario inputs without creating controllers,
 * mutating world state, or becoming a second simulation authority.
 */
const TRACE_VERSION = 4;
const MAX_ACTORS = 8;
const MAX_SCENARIO_ACTORS = 128;
const MAX_DELTA_SECONDS = 0.25;

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizePosition(position = {}) {
  return {
    x: finite(position.x),
    z: finite(position.z),
  };
}

function normalizeActor(actor = {}, index = 0) {
  return {
    id: String(actor.id ?? `scenario-actor-${index}`),
    kind: String(actor.kind ?? 'npc'),
    state: String(actor.state ?? 'unknown'),
    position: normalizePosition({ x: actor.x, z: actor.z }),
  };
}

function normalizeEventContext(context = {}) {
  const result = {};
  for (const key of ['urgency', 'threat', 'scarcity', 'socialNeed', 'danger', 'travelRisk']) {
    result[key] = Math.max(0, Math.min(1, finite(context[key])));
  }
  if (context.weather != null) result.weather = String(context.weather);
  return result;
}

export function createLivingWorldDirectorScenario(input = {}) {
  const scenario = {
    schema: 'aapw-living-world-director-scenario-v4',
    version: TRACE_VERSION,
    seed: Number.isInteger(Number(input.seed)) ? Number(input.seed) : 0,
    deltaSeconds: Math.max(0, Math.min(MAX_DELTA_SECONDS, finite(input.deltaSeconds))),
    clockSeconds: Math.max(0, finite(input.clockSeconds)),
    playerPosition: freeze(normalizePosition(input.playerPosition)),
    actors: (Array.isArray(input.actors) ? input.actors : [])
      .slice(0, MAX_ACTORS)
      .map(normalizeActor)
      .map(freeze)
      .map((actor) => freezeDeep(actor)),
    eventContext: freeze(normalizeEventContext(input.eventContext)),
  };
  return freezeDeep(scenario);
}

export function scenarioToRuntimeCollections(scenario) {
  const actors = Array.isArray(scenario?.actors) ? scenario.actors : [];
  return {
    npcs: actors.filter((actor) => actor.kind === 'npc'),
    animals: actors.filter((actor) => actor.kind === 'animal'),
    creatures: actors.filter((actor) => actor.kind === 'creature'),
    dragons: actors.filter((actor) => actor.kind === 'dragon'),
  };
}

export function auditLivingWorldDirectorScenario(scenario) {
  const errors = [];
  if (!scenario || scenario.schema !== 'aapw-living-world-director-scenario-v4') errors.push('schema');
  if (scenario?.version !== TRACE_VERSION) errors.push('version');
  if (!Number.isFinite(scenario?.seed)) errors.push('seed');
  if (!Number.isFinite(scenario?.deltaSeconds) || scenario.deltaSeconds < 0 || scenario.deltaSeconds > MAX_DELTA_SECONDS) errors.push('deltaSeconds');
  if (!Number.isFinite(scenario?.clockSeconds) || scenario.clockSeconds < 0) errors.push('clockSeconds');
  if (!Array.isArray(scenario?.actors) || scenario.actors.length > MAX_ACTORS) errors.push('actors');
  if (!Number.isFinite(scenario?.playerPosition?.x) || !Number.isFinite(scenario?.playerPosition?.z)) errors.push('playerPosition');
  for (const actor of scenario?.actors ?? []) {
    if (!actor.id || !actor.kind || !Number.isFinite(actor.position?.x) || !Number.isFinite(actor.position?.z)) errors.push(`actor:${actor.id ?? 'unknown'}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export const LIVING_WORLD_DIRECTOR_SCENARIO_POLICY = freeze({
  id: 'living-world-director-scenario-contract-2026-09-15-v4',
  version: TRACE_VERSION,
  deterministic: true,
  maxActorsPerScenario: MAX_ACTORS,
  maxRuntimeActors: MAX_SCENARIO_ACTORS,
  maxDeltaSeconds: MAX_DELTA_SECONDS,
  ownsControllers: false,
  ownsSimulation: false,
  ownsWorldPersistence: false,
});
