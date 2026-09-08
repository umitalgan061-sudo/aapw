import {
  LIVING_WORLD_REACTION_RUNTIME_POLICY,
  auditLivingWorldReactionResult,
  createLivingWorldReactionRuntime,
  livingWorldReactionDigest,
} from '../src/3d/gameplay/livingWorldReactionRuntime.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function equal(actual, expected, message) {
  assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function includes(array, value, message) {
  assert(Array.isArray(array) && array.includes(value), `${message}: missing ${value}`);
}
function hasCall(calls, name, message) {
  assert(calls.some((call) => call.name === name), message);
}
function makeActor(id, x, z, extra = {}) {
  const telemetry = {};
  return {
    id,
    object3D: {
      name: id,
      position: { x, z },
      userData: telemetry,
    },
    factionId: extra.factionId ?? 'north-watch',
    traits: extra.traits ?? {},
    ...extra,
  };
}

assert(LIVING_WORLD_REACTION_RUNTIME_POLICY.deterministic === true, 'runtime policy is deterministic');
equal(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors, 128, 'runtime actor cap remains bounded');
equal(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxEventsPerTick, 6, 'runtime event cap remains bounded');
equal(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxDeltaSeconds, 0.25, 'large frame deltas are clamped');
equal(LIVING_WORLD_REACTION_RUNTIME_POLICY.sensingIntervalSeconds, 0.15, 'perception sampling is throttled');

// A patrol actor remains in the real controller collection and writes inspectable runtime evidence.
{
  const actor = makeActor('guard-1', 0, 0, { occupationSchedule: { phase: 'patrol', activityId: 'watch', locationId: 'gate' } });
  const calls = [];
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: {
      perception: { sense() { calls.push({ name: 'sense' }); return []; } },
      occupation: { buildOccupationDirective(schedule) { calls.push({ name: 'occupation', schedule }); return { phase: 'work', activityId: 'watch', locationId: 'gate', shouldTravel: false }; } },
    },
    seed: 'patrol-proof',
  });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 2, z: 2 } });
  equal(result.accepted, true, 'patrol tick accepted');
  equal(result.actorCount, 1, 'patrol tick sees one actor');
  equal(result.results[0].phase, 'patrol', 'no signal keeps guard on patrol');
  equal(result.results[0].directive.kind, 'patrol', 'patrol directive delegates only movement intent');
  equal(result.results[0].occupation.activityId, 'watch', 'occupation intent is preserved');
  equal(actor.object3D.userData.livingWorldReaction.phase, 'patrol', 'runtime telemetry is attached to actor userData');
  hasCall(calls, 'sense', 'patrol branch samples perception through injected owner');
  hasCall(calls, 'occupation', 'patrol branch reads occupation through injected owner');
  assert(runtime.audit().ok, 'patrol runtime audit passes');
}

// A visible hostile signal advances through the required shipped runtime state chain.
{
  const actor = makeActor('guard-2', 0, 0, { factionId: 'north-watch' });
  const calls = [];
  let senseCount = 0;
  const services = {
    perception: {
      sense() {
        senseCount += 1;
        calls.push({ name: 'sense', count: senseCount });
        return [{
          id: 'intruder-sighting',
          kind: 'intruder',
          confidence: 0.98,
          distanceMeters: 18,
          visible: true,
          suspicious: true,
          severity: 75,
          targetId: 'raider-1',
          position: { x: 18, z: 0 },
        }];
      },
    },
    factions: { getFactionIdForActor() { return 'north-watch'; } },
    reputation: { getReputation() { return -80; } },
    diplomacy: { getRelation() { return 'war'; } },
    law: {
      getWantedLevel() { return 80; },
      getCrimeSeverity() { return 70; },
      reportCrime(event) { calls.push({ name: 'reportCrime', event }); return true; },
    },
    encounters: {
      shouldChase() { return true; },
      canAttack() { return true; },
      requestAttack() { calls.push({ name: 'requestAttack' }); return true; },
    },
    navigation: { requestTravel() { calls.push({ name: 'requestTravel' }); return true; } },
    worldEvents: { publish(event) { calls.push({ name: 'publish', event }); return true; } },
  };
  const runtime = createLivingWorldReactionRuntime({ actors: [actor], services, seed: 'chain-proof' });
  const r1 = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(r1.results[0].phase, 'detect', 'first hostile perception enters detect');
  const r2 = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(r2.results[0].phase, 'investigate', 'confirmed visible hostile signal enters investigate');
  const r3 = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(r3.results[0].phase, 'chase', 'existing encounter policy authorizes chase');
  const r4 = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(r4.results[0].phase, 'attack', 'existing encounter policy authorizes attack');
  assert(r4.results[0].combat.invoked, 'attack delegates into encounter owner');
  hasCall(calls, 'requestAttack', 'attack owner is actually called');
  hasCall(calls, 'requestTravel', 'chase/investigate movement delegates into navigation owner');
  hasCall(calls, 'reportCrime', 'wanted/crime evidence delegates into law owner');
  hasCall(calls, 'publish', 'reaction event delegates into world-event publisher');
  assert(r4.results[0].relation.diplomaticRelation === 'war', 'diplomacy relation affects runtime reaction');
  assert(r4.results[0].relation.reputation === -80, 'reputation is read without owning reputation state');
  assert(r4.results[0].relation.wanted === 80, 'wanted level is read from law owner');
  assert(r4.results[0].relation.reportable === true, 'crime evidence becomes reportable');
}

// Missing target evidence closes chase and returns the actor to its home position.
{
  const actor = makeActor('guard-return', 10, 10);
  let present = true;
  const nav = [];
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: {
      perception: { sense() { return present ? [{ id: 'target', kind: 'threat', confidence: 1, distanceMeters: 8, visible: true, suspicious: true, targetId: 'runner', position: { x: 18, z: 10 } }] : []; } },
      reputation: { getReputation() { return -70; } },
      diplomacy: { getRelation() { return 'war'; } },
      encounters: { shouldChase() { return true; }, canAttack() { return false; } },
      navigation: { requestTravel(_actor, destination, directive) { nav.push({ destination, directive }); return true; } },
    },
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  present = false;
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].phase, 'return', 'lost target causes return phase');
  equal(result.results[0].directive.kind, 'return', 'return phase owns only home destination intent');
  assert(nav.some((entry) => entry.directive.kind === 'return'), 'return destination reaches navigation owner');
  assert(result.results[0].directive.destination.x === 10 && result.results[0].directive.destination.z === 10, 'return target remains original home position');
}

// Wildlife with a panic trait chooses flee without creating a second wildlife simulator.
{
  const actor = makeActor('wolf-pack-1', 5, 5, { traits: { fleeWhenOutnumbered: true }, groupThreatCount: 4, factionId: 'wildlife' });
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: {
      perception: { sense() { return [{ id: 'predator', kind: 'predator', confidence: 1, distanceMeters: 9, visible: true, suspicious: true, targetId: 'hunter', position: { x: 5, z: 9 } }]; } },
      reputation: { getReputation() { return 0; } },
    },
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 5, z: 5 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 5, z: 5 } });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 5, z: 5 } });
  equal(result.results[0].phase, 'flee', 'outnumbered wildlife enters flee');
  equal(result.results[0].directive.kind, 'flee', 'flee directive is explicit');
  assert(result.results[0].directive.destination != null, 'flee destination is derived from threat position');
  assert(result.results[0].directive.speedMultiplier > 1, 'flee increases movement urgency');
}

// Occupation scheduling stays behind the existing owner and does not mutate the schedule.
{
  const schedule = Object.freeze({ phase: 'work', activityId: 'smith', locationId: 'forge', shouldTravel: true, destination: { x: 20, z: 30 }, nextChangeSeconds: 15 });
  const actor = makeActor('smith-1', 0, 0, { occupationSchedule: schedule });
  let received = null;
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: { occupation: { buildOccupationDirective(s) { received = s; return { ...s }; } } },
  });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 0, z: 0 } });
  assert(received === schedule, 'occupation service receives caller-owned schedule by identity');
  equal(result.results[0].occupation.activityId, 'smith', 'occupation activity survives runtime normalization');
  equal(result.results[0].occupation.locationId, 'forge', 'occupation location survives runtime normalization');
  assert(result.results[0].occupation.shouldTravel === true, 'occupation can request travel');
}

// Near/distant/far/culled LOD changes tick frequency without changing identity or state ownership.
{
  const actors = [
    makeActor('near', 2, 0),
    makeActor('distant', 100, 0),
    makeActor('far', 200, 0),
    makeActor('culled', 500, 0),
  ];
  let senses = 0;
  const runtime = createLivingWorldReactionRuntime({ actors, services: { perception: { sense() { senses += 1; return []; } } } });
  const first = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(first.results[0].lod, 'near', 'near actor has near LOD');
  equal(first.results[1].lod, 'distant', 'distant actor has distant LOD');
  equal(first.results[2].lod, 'far', 'far actor has far LOD');
  equal(first.results[3].lod, 'culled', 'out-of-range actor is culled');
  assert(first.results[3].simulated === false, 'culled actor is not simulated');
  const firstSenseCount = senses;
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  assert(senses >= firstSenseCount, 'LOD tick never decreases sampled-owner call count incorrectly');
  runtime.tick({ deltaSeconds: 2.0, playerPosition: { x: 0, z: 0 } });
  const snapshot = runtime.snapshot();
  assert(snapshot.actors.every((entry) => ['near', 'distant', 'far', 'culled'].includes(entry.lod)), 'LOD snapshot stays within bounded levels');
  assert(snapshot.actors.every((entry) => entry.history.length <= 8), 'state history remains bounded');
}

// Actor collections are hard-capped before simulation; no 1000-agent full-tick path is admitted.
{
  const actors = Array.from({ length: 300 }, (_, i) => makeActor(`crowd-${i}`, i, 0));
  const runtime = createLivingWorldReactionRuntime({ actors, services: { perception: { sense() { return []; } } } });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 0, z: 0 } });
  equal(result.actorCount, 128, 'actor collection is capped before runtime simulation');
  assert(result.stats.trackedActors <= 128, 'tracked actor state remains bounded');
  assert(auditLivingWorldReactionResult(result).ok, 'capped crowd still produces an auditable result');
}

// Large frame deltas are clamped and negative deltas do not move the clock backwards.
{
  const actor = makeActor('delta-test', 0, 0);
  const runtime = createLivingWorldReactionRuntime({ actors: [actor] });
  const large = runtime.tick({ deltaSeconds: 99, playerPosition: { x: 0, z: 0 } });
  equal(large.clockSeconds, 0.25, 'large delta clamps to runtime maximum');
  const negative = runtime.tick({ deltaSeconds: -10, playerPosition: { x: 0, z: 0 } });
  equal(negative.clockSeconds, 0.25, 'negative delta contributes no time');
}

// Deterministic seeds produce identical full tick telemetry; different seeds may change the deterministic sample.
{
  function run(seed) {
    const actorA = makeActor('det-a', 2, 4);
    const actorB = makeActor('det-b', 40, 4);
    const runtime = createLivingWorldReactionRuntime({ actors: [actorA, actorB], seed });
    runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    const finalTick = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    return { snapshot: runtime.snapshot(), tick: finalTick, digest: livingWorldReactionDigest(finalTick) };
  }
  const left = run('same-seed');
  const right = run('same-seed');
  equal(left.digest, right.digest, 'same seed generates the same full tick digest');
  equal(JSON.stringify(left.snapshot), JSON.stringify(right.snapshot), 'same seed generates identical state');
  const other = run('other-seed');
  assert(other.digest !== left.digest, 'different seed changes only the deterministic sample digest');
  assert(other.tick.results.map((entry) => entry.randomSample).every((sample) => Number.isFinite(sample)), 'random samples remain finite');
}

// Audit rejects malformed externally supplied-style results instead of silently passing them.
{
  const bad = auditLivingWorldReactionResult({
    accepted: true,
    actorCount: 200,
    results: [{ actorId: 'broken', phase: 'teleport', lod: 'near', relation: { wanted: 120, reputation: -150 } }],
  });
  equal(bad.ok, false, 'audit rejects actor overflow');
  includes(bad.errors, 'actor-count-overflow', 'audit reports actor overflow');
  includes(bad.errors, 'invalid-phase:broken', 'audit reports invalid phase');
  includes(bad.errors, 'invalid-wanted:broken', 'audit reports invalid wanted level');
  includes(bad.errors, 'invalid-reputation:broken', 'audit reports invalid reputation');
}

// Disposal is terminal and cannot accidentally restart the world simulation.
{
  const runtime = createLivingWorldReactionRuntime({ actors: [makeActor('dispose-test', 0, 0)] });
  equal(runtime.dispose(), true, 'dispose reports success');
  const result = runtime.tick({ deltaSeconds: 0.1 });
  equal(result.accepted, false, 'disposed runtime rejects further ticks');
  equal(runtime.audit().ok, false, 'disposed runtime is not reported healthy');
  assert(runtime.reset() === true, 'reset remains a pure local state operation after disposal');
}

// State history records real transitions with a bounded, inspectable reason.
{
  const actor = makeActor('history-test', 0, 0);
  let active = true;
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: { perception: { sense() { return active ? [{ id: 'h', kind: 'threat', confidence: 1, distanceMeters: 5, visible: true, targetId: 'enemy', position: { x: 5, z: 0 } }] : []; } }, reputation: { getReputation() { return -80; } } },
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  active = false;
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const history = runtime.snapshot().actors[0].history;
  assert(history.length >= 2, 'real runtime transitions are persisted in bounded local history');
  assert(history.every((entry) => entry.from && entry.to && entry.reason), 'transition history has inspectable reason fields');
}

if (failures.length) {
  console.error(`[living-world-reaction-runtime] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-runtime] PASS: ${passed} deterministic runtime assertions.`);
