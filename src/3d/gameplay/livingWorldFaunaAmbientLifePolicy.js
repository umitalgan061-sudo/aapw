/**
 * Şafak Kartalı — deterministic ambient fauna life policy.
 *
 * Pure adapter over caller-owned fauna observations. It produces bounded, declarative
 * ambient intents and never owns spawning, navigation, combat, factions, world events,
 * THREE, DOM, or asset loading. Existing runtime owners remain authoritative.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const idOf = (value, fallback = '') => String(value ?? fallback).trim() || fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY = freeze({
  id: 'safak-kartali-fauna-ambient-life-2026-09-17-v1',
  deterministic: true,
  maxActors: 128,
  maxIntents: 24,
  maxEvents: 8,
  maxAmbientDistanceMeters: 220,
});

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  return (h >>> 0);
}

function unit(seed) {
  return hash(seed) / 0x100000000;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

function phase(hour) {
  const h = ((finite(hour, 12) % 24) + 24) % 24;
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
}

function roleFor(actor) {
  const role = text(actor?.role, '').toLowerCase();
  if (role) return role;
  const species = text(actor?.species, '').toLowerCase();
  if (species.includes('wolf') || species.includes('bear') || species.includes('dragon')) return 'predator';
  if (species.includes('deer') || species.includes('horse') || species.includes('boar')) return 'grazer';
  if (species.includes('eagle') || species.includes('hawk') || species.includes('raven')) return 'avian';
  if (species.includes('bee') || species.includes('butter')) return 'pollinator';
  return 'forager';
}

function chooseActivity(actor, world, seed) {
  const role = roleFor(actor);
  const current = text(actor?.activity, '').toLowerCase();
  if (current && ['graze', 'forage', 'drink', 'perch', 'roost', 'howl', 'patrol', 'rest'].includes(current)) return current;
  const p = phase(world?.hour);
  if (role === 'predator') return p === 'night' || p === 'dusk' ? 'howl' : 'patrol';
  if (role === 'grazer') return p === 'day' ? (actor?.nearWater ? 'drink' : 'graze') : 'rest';
  if (role === 'avian') return p === 'night' ? 'roost' : 'perch';
  if (role === 'pollinator') return p === 'day' ? 'forage' : 'rest';
  return unit(`${seed}:${actor?.id}:activity`) < 0.5 ? 'forage' : 'rest';
}

function intensity(actor, world, playerDistance) {
  const threat = clamp(actor?.threatLevel);
  const weather = clamp(world?.weatherPressure, 0, 1);
  const proximity = clamp(1 - playerDistance / LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxAmbientDistanceMeters);
  return Math.round((0.18 + threat * 0.45 + weather * 0.17 + proximity * 0.2) * 1000) / 1000;
}

function eventFor(actor, activity, world, seed) {
  const role = roleFor(actor);
  const p = phase(world?.hour);
  const roll = unit(`${seed}:${actor.id}:event:${world?.tick ?? 0}`);
  if (activity === 'howl' && role === 'predator' && roll < 0.12) return { type: 'fauna-predator-call', eventId: `predator-call:${actor.id}:${world?.tick ?? 0}` };
  if (activity === 'roost' && role === 'avian' && p === 'dusk' && roll < 0.16) return { type: 'fauna-roost-settle', eventId: `roost-settle:${actor.id}:${world?.tick ?? 0}` };
  if (activity === 'drink' && role === 'grazer' && roll < 0.08) return { type: 'fauna-water-disturbance', eventId: `water-disturbance:${actor.id}:${world?.tick ?? 0}` };
  return null;
}

export function planFaunaAmbientLife(input = {}) {
  const world = input.world || {};
  const playerPosition = input.playerPosition || null;
  const actors = Array.isArray(input.actors) ? input.actors.slice(0, LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxActors) : [];
  const seed = text(input.seed, 'safak-kartali');
  const intents = [];
  const events = [];
  const seen = new Set();

  for (const actor of actors) {
    const id = idOf(actor?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const playerDistance = distance(actor?.position, playerPosition);
    if (playerDistance > LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxAmbientDistanceMeters) continue;
    if (actor?.groundValid === false || actor?.navReachable === false) continue;
    const activity = chooseActivity(actor, world, seed);
    const ambient = {
      kind: 'fauna-ambient-intent',
      actorId: id,
      groupId: idOf(actor?.groupId),
      species: text(actor?.species, 'unknown'),
      activity,
      phase: phase(world?.hour),
      intensity: intensity(actor, world, playerDistance),
      position: actor?.position ? { x: finite(actor.position.x), z: finite(actor.position.z) } : null,
      budgetClass: playerDistance < 60 ? 'near' : playerDistance < 140 ? 'distant' : 'far',
      assetFirst: true,
      placement: {
        materialContract: 'src/3d/materials/MaterialAssignmentCore.js',
        placementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
        missingAssetPolicy: 'skip-and-report',
      },
    };
    intents.push(freeze(ambient));
    const event = eventFor(actor, activity, world, seed);
    if (event) events.push(freeze({ ...event, actorId: id, species: ambient.species }));
  }

  intents.sort((a, b) => a.actorId.localeCompare(b.actorId));
  events.sort((a, b) => a.eventId.localeCompare(b.eventId));
  return freeze({
    policyId: LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.id,
    accepted: true,
    intents: freeze(intents.slice(0, LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxIntents)),
    events: freeze(events.slice(0, LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxEvents)),
    audit: freeze({
      ok: true,
      inputActors: actors.length,
      intentCount: Math.min(intents.length, LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxIntents),
      eventCount: Math.min(events.length, LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxEvents),
      assetFirst: true,
      sharedMaterialPlacement: true,
    }),
  });
}

export function auditFaunaAmbientLifePlan(plan) {
  if (!plan || plan.accepted !== true) return freeze({ ok: false, reason: 'not-accepted' });
  const intents = Array.isArray(plan.intents) ? plan.intents : [];
  const actorIds = intents.map((item) => item.actorId);
  const uniqueIds = new Set(actorIds);
  const sorted = [...actorIds].sort();
  const noPlaceholders = intents.every((item) => item.assetFirst === true && item.placement?.missingAssetPolicy === 'skip-and-report');
  const bounded = intents.length <= LIVING_WORLD_FAUNA_AMBIENT_LIFE_POLICY.maxIntents;
  return freeze({
    ok: uniqueIds.size === actorIds.length && JSON.stringify(actorIds) === JSON.stringify(sorted) && noPlaceholders && bounded,
    uniqueActorIds: uniqueIds.size,
    sorted: JSON.stringify(actorIds) === JSON.stringify(sorted),
    noPlaceholders,
    bounded,
  });
}
