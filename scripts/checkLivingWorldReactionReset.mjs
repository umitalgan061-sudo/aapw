import { createLivingWorldReactionRuntime, livingWorldReactionDigest } from '../src/3d/gameplay/livingWorldReactionRuntime.js';

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

function makeActor() {
  return { id: 'reset-guard', object3D: { position: { x: 4, z: 6 }, userData: {} } };
}

function runCycle(runtime) {
  const first = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const second = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  return { first, second, snapshot: runtime.snapshot() };
}

const actor = makeActor();
const runtime = createLivingWorldReactionRuntime({
  actors: [actor],
  seed: 'reset-seed',
  clockSeconds: 17,
});
const before = runCycle(runtime);
assert(before.first.clockSeconds === 17.2, 'initial clock preserves the configured clock origin');
assert(before.second.clockSeconds === 17.4, 'clock advances from the configured clock origin');

const sensedActor = {
  id: 'cache-guard',
  object3D: { position: { x: 5, z: 5 }, userData: {} },
};
let senseCalls = 0;
const cacheRuntime = createLivingWorldReactionRuntime({
  actors: [sensedActor],
  seed: 'cache-seed',
  clockSeconds: 11,
  services: {
    perception: {
      sense() {
        senseCalls += 1;
        return [{
          id: 'visible-threat',
          targetId: 'target-cache',
          confidence: 1,
          distanceMeters: 12,
          visible: true,
          suspicious: true,
          position: { x: 12, z: 12 },
        }];
      },
    },
  },
});
const cacheFirst = cacheRuntime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
const cacheSecond = cacheRuntime.tick({ deltaSeconds: 0.05, playerPosition: { x: 0, z: 0 } });
assert(senseCalls === 1, 'sub-interval tick reuses the bounded perception cache');
assert(cacheFirst.results[0].phase === 'detect', 'fresh perception enters detect phase');
assert(cacheSecond.results[0].phase === 'investigate', 'cached perception preserves the detect-to-investigate chain');
assert(cacheSecond.results[0].signal?.signal?.id === 'visible-threat', 'cached perception remains the same deterministic signal');
assert(cacheSecond.results[0].cachedSignalCount === 1, 'cached signal count is observable in runtime telemetry');

assert(runtime.reset() === true, 'reset succeeds');
const after = runCycle(runtime);
assert(after.first.clockSeconds === 17.2, 'reset restores the configured clock origin');
assert(after.second.clockSeconds === 17.4, 'reset restores deterministic elapsed time');
assert(livingWorldReactionDigest(before.first) === livingWorldReactionDigest(after.first), 'reset restores the seeded first-tick digest');
assert(JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot), 'reset restores the complete deterministic snapshot');
assert(cacheRuntime.reset() === true, 'cache runtime reset succeeds');
const cacheAfterReset = cacheRuntime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
assert(cacheAfterReset.results[0].cachedSignalCount === 1, 'reset clears stale perception and deterministically reacquires the signal');
assert(senseCalls === 2, 'reset forces a fresh perception sample');

if (failures.length) {
  console.error(`[living-world-reaction-reset] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[living-world-reaction-reset] PASS: reset restores clock, seeded state, and bounded perception-cache behavior.');
