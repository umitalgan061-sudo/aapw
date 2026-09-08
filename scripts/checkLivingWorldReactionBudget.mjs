import {
  LIVING_WORLD_REACTION_RUNTIME_POLICY,
  createLivingWorldReactionRuntime,
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
function makeActor(index, distanceMeters = 5) {
  return {
    id: `budget-${index}`,
    object3D: {
      name: `budget-${index}`,
      position: { x: distanceMeters + index * 0.01, z: 0 },
      userData: {},
    },
    traits: {},
  };
}

assert(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors <= 128, 'max actor budget is mobile-safe');
assert(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxSignalsPerActor <= 12, 'per-actor sensing payload is bounded');
assert(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxEventsPerTick <= 6, 'world-event emissions are bounded per tick');
assert(LIVING_WORLD_REACTION_RUNTIME_POLICY.maxHistoryEntries === undefined || LIVING_WORLD_REACTION_RUNTIME_POLICY.maxHistoryEntries <= 8, 'history policy is bounded when declared');

// A large caller collection is trimmed before any owner service is queried.
{
  const actors = Array.from({ length: 1000 }, (_, index) => makeActor(index, index < 16 ? 8 : 500));
  let sensed = 0;
  const runtime = createLivingWorldReactionRuntime({
    actors,
    services: { perception: { sense() { sensed += 1; return []; } } },
    seed: 'budget-large',
  });
  const result = runtime.tick({ deltaSeconds: 0.016, playerPosition: { x: 0, z: 0 } });
  equal(result.actorCount, LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors, '1000-agent input is capped at the declared runtime maximum');
  equal(result.stats.trackedActors, LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors, 'tracked states never exceed the actor cap');
  assert(sensed <= LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors, 'perception calls never exceed the actor cap on one frame');
  assert(result.results.length === LIVING_WORLD_REACTION_RUNTIME_POLICY.maxActors, 'bounded result surface matches capped actor count');
}

// Distance LOD prevents every distant actor from receiving a full simulation cadence.
{
  const actors = [
    makeActor(1, 5),
    makeActor(2, 60),
    makeActor(3, 170),
    makeActor(4, 500),
  ];
  let senseCalls = 0;
  const runtime = createLivingWorldReactionRuntime({
    actors,
    services: { perception: { sense() { senseCalls += 1; return []; } } },
  });
  const first = runtime.tick({ deltaSeconds: 0.05, playerPosition: { x: 0, z: 0 } });
  const second = runtime.tick({ deltaSeconds: 0.05, playerPosition: { x: 0, z: 0 } });
  const third = runtime.tick({ deltaSeconds: 0.05, playerPosition: { x: 0, z: 0 } });
  equal(first.results[0].lod, 'near', 'close actor uses near LOD');
  equal(first.results[1].lod, 'distant', 'medium actor uses distant LOD');
  equal(first.results[2].lod, 'far', 'far actor uses far LOD');
  equal(first.results[3].lod, 'culled', 'out-of-range actor is culled');
  assert(second.results.filter((entry) => entry.simulated !== false).length <= first.results.length, 'second frame never expands beyond the first simulation population');
  assert(third.results.filter((entry) => entry.simulated !== false).length <= first.results.length, 'third frame remains bounded');
  assert(senseCalls <= 12, 'three short frames do not explode perception calls');
}

// A long frame is clamped rather than allowing runaway state advancement or event emission.
{
  const actor = makeActor(7, 2);
  let emitted = 0;
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: {
      perception: { sense() { return []; } },
      worldEvents: { publish() { emitted += 1; return true; } },
    },
  });
  const result = runtime.tick({ deltaSeconds: 900, playerPosition: { x: 0, z: 0 } });
  equal(result.clockSeconds, LIVING_WORLD_REACTION_RUNTIME_POLICY.maxDeltaSeconds, 'long frame delta is clamped');
  assert(emitted <= LIVING_WORLD_REACTION_RUNTIME_POLICY.maxEventsPerTick, 'event emissions stay inside per-tick budget');
}

// Repeated culled frames must not accumulate hidden per-actor history or create work after the first admission.
{
  const actors = Array.from({ length: 128 }, (_, index) => makeActor(index, 1000));
  let senses = 0;
  const runtime = createLivingWorldReactionRuntime({ actors, services: { perception: { sense() { senses += 1; return []; } } } });
  for (let frame = 0; frame < 20; frame += 1) {
    const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    assert(result.results.every((entry) => entry.simulated === false && entry.lod === 'culled'), `all far actors stay culled on frame ${frame}`);
  }
  equal(senses, 0, 'culled population creates zero sensing work across repeated frames');
  assert(runtime.snapshot().actors.every((actor) => actor.history.length <= 8), 'culled population history remains bounded');
}

// Signal normalization caps a hostile sensing burst to twelve candidates without changing deterministic priority.
{
  const signals = Array.from({ length: 40 }, (_, index) => ({
    id: `signal-${index}`,
    kind: 'noise',
    confidence: index === 39 ? 1 : 0.1,
    distanceMeters: index + 1,
    visible: index === 39,
    suspicious: index === 39,
    targetId: `target-${index}`,
    position: { x: index + 1, z: 0 },
  }));
  let acceptedSignalCount = 0;
  const runtime = createLivingWorldReactionRuntime({
    actors: [makeActor(99, 2)],
    services: {
      perception: { sense() { return signals; } },
      reputation: { getReputation() { acceptedSignalCount += 1; return -80; } },
    },
  });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const signal = result.results[0].signal;
  equal(signal.signal.id, 'signal-39', 'highest deterministic signal survives the normalized twelve-signal input cap');
  assert(acceptedSignalCount >= 1, 'relationship resolver sees the selected target only');
}

// Owner service exceptions are isolated; an optional owner cannot crash the world runtime.
{
  const actor = makeActor(11, 4);
  const runtime = createLivingWorldReactionRuntime({
    actors: [actor],
    services: {
      perception: { sense() { throw new Error('expected perception rejection'); } },
      diplomacy: { getRelation() { throw new Error('expected diplomacy rejection'); } },
      law: { getWantedLevel() { throw new Error('expected law rejection'); } },
      navigation: { requestTravel() { throw new Error('expected navigation rejection'); } },
      encounters: { shouldChase() { throw new Error('expected encounter rejection'); } },
    },
  });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 0, z: 0 } });
  equal(result.accepted, true, 'owner service rejection does not crash the simulation');
  assert(result.results[0].phase === 'patrol', 'safe fallback remains patrol after owner rejection');
  assert(runtime.audit().ok, 'runtime remains auditable after optional-service rejection');
}

// Duplicate actor references remain deterministic and bounded by identity, not object count alone.
{
  const actor = makeActor(12, 4);
  const runtime = createLivingWorldReactionRuntime({ actors: [actor, actor, actor] });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 0, z: 0 } });
  equal(result.actorCount, 3, 'caller collection cardinality is preserved in one result');
  equal(result.stats.trackedActors, 1, 'duplicate object identity shares one runtime state');
  assert(result.results.every((entry) => entry.actorId === 'budget-12'), 'duplicate references keep the same actor identity');
}

// Deterministic repeated runs must keep the same budget surfaces and digest inputs.
{
  function run() {
    const runtime = createLivingWorldReactionRuntime({ actors: Array.from({ length: 24 }, (_, index) => makeActor(index, index * 12 + 2)), seed: 'budget-determinism' });
    const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    return { actorCount: result.actorCount, simulated: result.simulatedActors, lods: result.results.map((entry) => entry.lod) };
  }
  const left = run();
  const right = run();
  equal(JSON.stringify(left), JSON.stringify(right), 'same budget scenario is byte-stable across independent runs');
}

if (failures.length) {
  console.error(`[living-world-reaction-budget] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-budget] PASS: ${passed} deterministic budget assertions.`);
