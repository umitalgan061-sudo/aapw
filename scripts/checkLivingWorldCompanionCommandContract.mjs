import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (value, message) => value ? passed++ : failures.push(message);
const actor = (id, x, z, extra = {}) => ({ id, position: { x, z }, object3D: { position: { x, z }, userData: {} }, ...extra });
const calls = [];
const services = {
  perception: { getSignals: (a) => a?.id === 'leader' ? [{ id: 'threat', kind: 'enemy', confidence: 1, distanceMeters: 4, visible: true, audible: true, targetId: 'raider', position: { x: 6, z: 0 } }] : [] },
  factions: { getFactionIdForActor: () => 'watch' },
  reputation: { getReputation: () => -15 },
  diplomacy: { getRelation: () => 'war' },
  law: { getWantedLevel: () => 70, getCrimeSeverity: () => 60, reportCrime: (event) => { calls.push(['law', event]); return { accepted: true }; } },
  navigation: { requestTravel: (a, request) => { calls.push(['navigation', request]); return { accepted: true }; } },
  combat: { requestSupport: (a, t, request) => { calls.push(['combat', request]); return { accepted: true }; }, requestAttack: (a, t, request) => { calls.push(['attack', request]); return { accepted: true }; } },
  worldEventsPublisher: { publish: (event) => { calls.push(['event', event]); return { accepted: true }; } },
};
const target = actor('leader', 0, 0);
const follower = actor('wolf', 12, 0);
const raider = actor('raider', 6, 0, { factionId: 'raiders' });
const collections = { npcs: [target, raider], animals: [follower], creatures: [], dragons: [] };

const runtime = createLivingWorldCompanionRuntime({ services, seed: 'command-contract' });
const result = runtime.tick({
  deltaSeconds: 0.25,
  collections,
  companions: [{ id: 'command-link', actorId: 'wolf', targetId: 'leader', mode: 'assist', followDistanceMeters: 6, settlementId: 'watch-post' }],
  playerPosition: { x: 0, z: 0 },
});

check(result.accepted === true, 'command contract runtime accepted');
check(result.companionCount === 1, 'command contract companion count');
check(result.results.length === 1, 'one command result');
const row = result.results[0];
check(typeof row.companionId === 'string', 'result has companion id');
check(typeof row.actorId === 'string', 'result has actor id');
check(typeof row.targetId === 'string', 'result has target id');
check(['follow', 'escort', 'assist', 'regroup', 'hold'].includes(row.mode), 'result mode enum');
check(['linked', 'following', 'assisting', 'regrouping', 'holding', 'recovering', 'detached'].includes(row.state), 'result state enum');
check(['near', 'distant', 'far', 'culled'].includes(row.lod), 'result LOD enum');
check(Number.isFinite(row.distanceMeters), 'result distance finite');
check(Number.isFinite(row.followDistanceMeters), 'result follow distance finite');
check(Number.isFinite(row.staleSeconds), 'result stale seconds finite');
check(Number.isFinite(row.recoveryCount), 'recovery counter finite');
check(Number.isFinite(row.transitionCount), 'transition counter finite');
check(row.history.length <= 8, 'history bounded');

for (const request of result.navigationRequests) {
  check(typeof request.id === 'string', 'navigation id');
  check(typeof request.actorId === 'string', 'navigation actor id');
  check(typeof request.targetId === 'string', 'navigation target id');
  check(typeof request.kind === 'string', 'navigation kind');
  check(Number.isFinite(request.destination?.x), 'navigation destination x finite');
  check(Number.isFinite(request.destination?.z), 'navigation destination z finite');
  check(Number.isFinite(request.targetPosition?.x), 'navigation target x finite');
  check(Number.isFinite(request.targetPosition?.z), 'navigation target z finite');
  check(Number.isFinite(request.distanceMeters), 'navigation distance finite');
  check(Number.isFinite(request.followDistanceMeters), 'navigation follow distance finite');
  check(request.maxDetourMeters <= 12, 'navigation detour bound');
  check(request.formationSize >= 1 && request.formationSize <= 32, 'navigation formation size bound');
}

for (const request of result.combatRequests) {
  check(typeof request.id === 'string', 'combat id');
  check(typeof request.actorId === 'string', 'combat actor id');
  check(typeof request.targetId === 'string', 'combat target id');
  check(typeof request.kind === 'string', 'combat kind');
  check(request.damageOwner === true, 'combat damage remains owner-controlled');
  check(request.owner === 'existing-combat-service', 'combat owner identity');
}

for (const event of result.publishedEvents) {
  check(typeof event.type === 'string', 'event type');
  check(typeof event.companionId === 'string', 'event companion id');
  check(typeof event.actorId === 'string', 'event actor id');
  check(typeof event.targetId === 'string', 'event target id');
  check(typeof event.digest === 'string' && event.digest.length === 8, 'event digest');
}

// Owner calls must be bounded, typed, and never multiplied by rendering frames.
check(calls.filter((entry) => entry[0] === 'navigation').length <= 8, 'navigation owner call bound');
check(calls.filter((entry) => entry[0] === 'combat').length + calls.filter((entry) => entry[0] === 'attack').length <= 8, 'combat owner call bound');
check(calls.filter((entry) => entry[0] === 'event').length <= 6, 'event owner call bound');
check(calls.some((entry) => entry[0] === 'navigation'), 'navigation owner called');
check(calls.some((entry) => entry[0] === 'event') || result.publishedEvents.length === 0, 'event path is owner-controlled');

// Snapshot schema is stable after repeated ticks.
for (let index = 0; index < 6; index += 1) {
  const tick = runtime.tick({ deltaSeconds: 0.25, collections, companions: [{ id: 'command-link', actorId: 'wolf', targetId: 'leader', mode: 'assist', followDistanceMeters: 6 }], playerPosition: { x: 0, z: 0 } });
  check(typeof tick.digest === 'string' && tick.digest.length === 8, `repeat-${index}: digest`);
  check(tick.navigationRequests.length <= 8, `repeat-${index}: navigation budget`);
  check(tick.combatRequests.length <= 8, `repeat-${index}: combat budget`);
  check(tick.publishedEvents.length <= 6, `repeat-${index}: event budget`);
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_COMMAND_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_COMMAND_PASS checks=${passed}`);
