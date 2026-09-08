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

assert(runtime.reset() === true, 'reset succeeds');
const after = runCycle(runtime);
assert(after.first.clockSeconds === 17.2, 'reset restores the configured clock origin');
assert(after.second.clockSeconds === 17.4, 'reset restores deterministic elapsed time');
assert(livingWorldReactionDigest(before.first) === livingWorldReactionDigest(after.first), 'reset restores the seeded first-tick digest');
assert(JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot), 'reset restores the complete deterministic snapshot');

if (failures.length) {
  console.error(`[living-world-reaction-reset] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[living-world-reaction-reset] PASS: reset restores clock and seeded deterministic state.');
