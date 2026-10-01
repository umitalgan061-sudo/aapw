import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (condition, message) => condition ? passed++ : failures.push(message);
const actor = (id, x, z, extra = {}) => ({ id, ...extra, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const baseServices = (signalByActor = new Map()) => ({
  perception: { getSignals: (a) => signalByActor.get(a?.id) ?? [] },
  factions: { getFactionIdForActor: () => 'watch' },
  reputation: { getReputation: () => 0 },
  diplomacy: { getRelation: () => 'neutral' },
  law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: () => ({ accepted: true }) },
  navigation: { requestTravel: () => ({ accepted: true }) },
  combat: { requestSupport: () => ({ accepted: true }), requestAttack: () => ({ accepted: true }) },
  worldEventsPublisher: { publish: () => ({ accepted: true }) },
});
const makeInput = (collections, companions, extra = {}) => ({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 }, ...extra });

// Matrix 01: empty companion list.
{
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm01' });
  const result = runtime.tick(makeInput({ npcs: [actor('guard', 0, 0)], animals: [], creatures: [], dragons: [] }, []));
  check(result.accepted === true && result.companionCount === 0, 'empty companion list is accepted');
}

// Matrix 02: target and follower are co-located -> holding envelope.
{
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 0, 0);
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm02' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'co-located', actorId: 'wolf', targetId: 'guard' }]));
  check(result.results[0]?.state === 'holding', 'co-located companion holds');
}

// Matrix 03: follower slightly outside envelope -> following.
{
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 8, 0);
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm03' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'outside', actorId: 'wolf', targetId: 'guard', followDistanceMeters: 4 }]));
  check(result.results[0]?.state === 'following', 'outside-envelope companion follows');
  check(result.navigationRequests.length <= 8, 'following is bounded');
}

// Matrix 04: explicit escort is a valid mode, not an alias that leaks into a new state machine.
{
  const guard = actor('guard', 0, 0); const horse = actor('horse', 12, 0);
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm04' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [horse], creatures: [], dragons: [] }, [{ id: 'escort', actorId: 'horse', targetId: 'guard', mode: 'escort' }]));
  check(result.results[0]?.mode === 'escort', 'escort mode remains explicit');
}

// Matrix 05: assist link when the target reaction is peaceful does not request combat.
{
  const signalMap = new Map();
  const services = baseServices(signalMap); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm05' });
  const calls = [];
  services.combat.requestSupport = (...args) => { calls.push(args); return { accepted: true }; };
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'assist-peace', actorId: 'wolf', targetId: 'guard', mode: 'assist' }]));
  check(result.results[0]?.state !== 'assisting', 'peaceful target is not treated as combat');
  check(calls.length === 0, 'no combat call for peaceful target');
}

// Matrix 06: assist link when target is attacking requests support through owner seam.
{
  const signalMap = new Map([['guard', [{ id: 'enemy', kind: 'enemy', confidence: 1, distanceMeters: 5, visible: true, audible: true, targetId: 'raider', position: { x: 5, z: 0 } }]]]);
  const services = baseServices(signalMap); services.diplomacy.getRelation = () => 'war'; services.reputation.getReputation = () => -30; services.law.getWantedLevel = () => 80;
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0); const raider = actor('raider', 5, 0, { factionId: 'raiders' }); const calls = [];
  services.combat.requestSupport = (...args) => { calls.push(args); return { accepted: true }; };
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm06' });
  const result = runtime.tick(makeInput({ npcs: [guard, raider], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'assist-war', actorId: 'wolf', targetId: 'guard', mode: 'assist' }]));
  check(result.integration?.accepted === true, 'attack composition remains accepted');
  check(result.results[0]?.state === 'assisting' || result.results[0]?.targetPhase === 'attack', 'assist sees attack phase');
}

// Matrix 07: regroup always prefers navigation, never damage ownership.
{
  const services = baseServices(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 18, 0); const nav = [];
  services.navigation.requestTravel = (...args) => { nav.push(args[1]); return { accepted: true }; };
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm07' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'regroup', actorId: 'wolf', targetId: 'guard', mode: 'regroup' }]));
  check(result.results[0]?.state === 'regrouping', 'regroup mode enters regrouping');
  check(nav.some((request) => request.kind === 'regroup'), 'regroup calls navigation');
}

// Matrix 08: hold mode suppresses movement even when well outside follow distance.
{
  const services = baseServices(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 16, 0); const nav = [];
  services.navigation.requestTravel = (...args) => { nav.push(args[1]); return { accepted: true }; };
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm08' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'hold-far', actorId: 'wolf', targetId: 'guard', mode: 'hold', followDistanceMeters: 4 }]));
  check(result.results[0]?.state === 'holding', 'hold remains holding at distance');
  check(nav.every((request) => request.kind !== 'follow'), 'hold does not become follow');
}

// Matrix 09: target leaving the population radius triggers recovery rather than teleporting.
{
  const services = baseServices(); const guard = actor('guard', 500, 0); const wolf = actor('wolf', 2, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm09' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'radius', actorId: 'wolf', targetId: 'guard' }]));
  check(result.results[0]?.state === 'recovering', 'out-of-radius target causes recovery');
  check(result.results[0]?.recoveryCount >= 1, 'recovery counter increments');
}

// Matrix 10: a valid recovery re-enters following after the target returns.
{
  const services = baseServices(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 20, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm10' }); const companions = [{ id: 'recover', actorId: 'wolf', targetId: 'guard' }];
  const collections = { npcs: [guard], animals: [wolf], creatures: [], dragons: [] };
  const first = runtime.tick(makeInput(collections, companions));
  check(first.results[0]?.state === 'following' || first.results[0]?.state === 'recovering', 'initial long-distance state bounded');
  wolf.position = { x: 6, z: 0 }; wolf.object3D.position = { x: 6, z: 0 };
  const second = runtime.tick(makeInput(collections, companions));
  check(['following', 'holding'].includes(second.results[0]?.state), 'returned target distance restores normal lifecycle');
}

// Matrix 11: stale velocity does not produce an unbounded prediction horizon.
{
  const services = baseServices(); const guard = actor('guard', 0, 0); guard.velocity = { x: 99999, z: 99999 }; const wolf = actor('wolf', 10, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm11' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'velocity', actorId: 'wolf', targetId: 'guard' }]));
  const destination = result.navigationRequests[0]?.destination;
  check(!destination || (Number.isFinite(destination.x) && Number.isFinite(destination.z)), 'velocity prediction stays finite');
  check(result.navigationRequests.every((r) => Math.abs((r.targetPosition?.x ?? 0) - 0) < 100000), 'prediction remains bounded by authored horizon');
}

// Matrix 12: malformed player position cannot create a non-finite LOD route.
{
  const services = baseServices(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 5, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'm12' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'bad-player', actorId: 'wolf', targetId: 'guard' }], { playerPosition: { x: Number.NaN, z: Number.POSITIVE_INFINITY } }));
  check(result.accepted === true, 'malformed player coordinates fail closed');
  check(result.results.every((row) => ['near', 'distant', 'far', 'culled'].includes(row.lod)), 'LOD remains canonical');
}

// Matrix 13: link ordering is independent of input insertion order.
{
  const target = actor('guard', 0, 0); const a = actor('a', 5, 0); const b = actor('b', 6, 0); const collections = { npcs: [target], animals: [a, b], creatures: [], dragons: [] };
  const one = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm13' }).tick(makeInput(collections, [{ id: 'b-link', actorId: 'b', targetId: 'guard', priority: 1 }, { id: 'a-link', actorId: 'a', targetId: 'guard', priority: 1 }]));
  const two = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm13' }).tick(makeInput(collections, [{ id: 'a-link', actorId: 'a', targetId: 'guard', priority: 1 }, { id: 'b-link', actorId: 'b', targetId: 'guard', priority: 1 }]));
  check(JSON.stringify(one.results) === JSON.stringify(two.results), 'link input order does not alter results');
}

// Matrix 14: deterministic budget under a mixed four-family population.
{
  const guard = actor('guard', 0, 0); const animals = Array.from({ length: 12 }, (_, i) => actor(`horse-${i}`, i + 2, 0)); const creatures = Array.from({ length: 8 }, (_, i) => actor(`creature-${i}`, i + 2, 3)); const dragons = Array.from({ length: 4 }, (_, i) => actor(`dragon-${i}`, i + 2, -3));
  const all = [...animals, ...creatures, ...dragons]; const companions = all.map((a, i) => ({ id: `mix-${i}`, actorId: a.id, targetId: 'guard', mode: i % 4 === 0 ? 'assist' : 'follow' }));
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm14' });
  const result = runtime.tick(makeInput({ npcs: [guard], animals, creatures, dragons }, companions));
  check(result.companionCount === 24, 'mixed population preserves all 24 allowed links');
  check(result.navigationRequests.length <= 8 && result.combatRequests.length <= 8, 'mixed population owner budgets stay bounded');
}

// Matrix 15: audit error propagation remains deterministic when integration is disposed.
{
  const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm15' });
  runtime.dispose();
  const result = runtime.tick(makeInput({ npcs: [], animals: [], creatures: [], dragons: [] }, []));
  check(result.accepted === false && result.reason === 'disposed', 'dispose state is observable');
}

// Matrix 16: persisted actor telemetry is namespaced and bounded.
{
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0); const runtime = createLivingWorldCompanionRuntime({ services: baseServices(), seed: 'm16' });
  runtime.tick(makeInput({ npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, [{ id: 'telemetry', actorId: 'wolf', targetId: 'guard' }]));
  const telemetry = wolf.object3D.userData.livingWorldCompanion;
  check(Boolean(telemetry), 'companion telemetry is written');
  check(typeof telemetry.digest === 'string' && telemetry.digest.length === 8, 'telemetry digest bounded');
  check(Object.isFrozen(telemetry), 'telemetry snapshot is immutable');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_MATRIX_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_MATRIX_PASS scenarios=16 checks=${passed}`);
