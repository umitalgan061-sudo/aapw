import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (v, m) => v ? passed++ : failures.push(m);
const actor = (id, x, z) => ({ id, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const services = {
  perception: { getSignals: () => [] },
  factions: { getFactionIdForActor: () => 'watch' },
  reputation: { getReputation: () => 0 },
  diplomacy: { getRelation: () => 'neutral' },
  law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: () => ({ accepted: true }) },
  navigation: { requestTravel: () => ({ accepted: true }) },
  combat: { requestSupport: () => ({ accepted: true }), requestAttack: () => ({ accepted: true }) },
  worldEventsPublisher: { publish: () => ({ accepted: true }) },
};
const leader = actor('leader', 0, 0);
const companion = actor('companion', 8, 0);
const collections = { npcs: [leader], animals: [companion], creatures: [], dragons: [] };
const companions = [{ id: 'api-link', actorId: 'companion', targetId: 'leader', mode: 'follow' }];
const runtime = createLivingWorldCompanionRuntime({ services, seed: 'api-contract', clockSeconds: 10 });

check(typeof runtime.tick === 'function', 'tick API exposed');
check(typeof runtime.snapshot === 'function', 'snapshot API exposed');
check(typeof runtime.reset === 'function', 'reset API exposed');
check(typeof runtime.audit === 'function', 'audit API exposed');
check(typeof runtime.dispose === 'function', 'dispose API exposed');
check(runtime.disposed === false, 'runtime starts undisposed');

const result = runtime.tick({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 } });
check(result.accepted === true, 'tick accepts valid input');
check(result.tick === 1, 'first tick index');
check(result.clockSeconds === 10.25, 'clock advances from supplied start');
check(result.companionCount === 1, 'one companion tracked');
check(result.integration != null, 'existing integration result is composed');
check(result.stats != null, 'runtime stats are exposed');
check(result.policyId.startsWith('living-world-companion-runtime-'), 'policy id is namespaced');
check(result.integrationPolicyId.startsWith('living-world-reaction-integration-'), 'integration policy is retained');
check(Object.isFrozen(result), 'result frozen');
check(Object.isFrozen(result.results), 'result rows frozen');
check(Object.isFrozen(result.navigationRequests), 'navigation collection frozen');
check(Object.isFrozen(result.combatRequests), 'combat collection frozen');
check(Object.isFrozen(result.publishedEvents), 'event collection frozen');
check(Object.isFrozen(result.stats), 'stats frozen');

const snapshotBefore = runtime.snapshot();
check(snapshotBefore.tick === 1, 'snapshot mirrors tick count');
check(snapshotBefore.clockSeconds === 10.25, 'snapshot mirrors clock');
check(snapshotBefore.companionCount === 1, 'snapshot mirrors link count');
check(snapshotBefore.links[0].id === 'api-link', 'snapshot preserves link identity');
check(Object.isFrozen(snapshotBefore), 'snapshot frozen');
check(Object.isFrozen(snapshotBefore.links), 'snapshot link collection frozen');
check(Object.isFrozen(snapshotBefore.links[0]), 'snapshot link frozen');

const auditBefore = runtime.audit();
check(auditBefore.ok === true, 'audit passes immediately after valid tick');
check(auditBefore.trackedLinks === 1, 'audit tracks one link');
check(Object.isFrozen(auditBefore), 'audit frozen');
check(Object.isFrozen(auditBefore.errors), 'audit errors frozen');

const second = runtime.tick({ deltaSeconds: 0, collections, companions, playerPosition: { x: 0, z: 0 } });
check(second.accepted === true, 'zero-delta tick accepted');
check(second.tick === 2, 'zero-delta increments tick index');
check(second.clockSeconds === 10.25, 'zero-delta leaves clock unchanged');
check(typeof second.digest === 'string' && second.digest.length === 8, 'zero-delta digest stable shape');

runtime.reset();
const resetSnapshot = runtime.snapshot();
check(resetSnapshot.tick === 0, 'reset tick count');
check(resetSnapshot.clockSeconds === 10, 'reset restores initial clock');
check(resetSnapshot.companionCount === 1, 'reset retains tracked link state without deleting caller link');
check(resetSnapshot.links[0].state === 'linked', 'reset state linked');
check(resetSnapshot.links[0].history.length === 0, 'reset clears transition history');

const afterReset = runtime.tick({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 } });
check(afterReset.tick === 1, 'post-reset tick restarts at one');
check(afterReset.clockSeconds === 10.25, 'post-reset clock deterministic');

const beforeDisposeCalls = runtime.snapshot().tick;
check(runtime.dispose() === true, 'first dispose true');
check(runtime.disposed === true, 'disposed getter true');
check(runtime.dispose() === false, 'second dispose false');
const disposed = runtime.tick({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 } });
check(disposed.accepted === false, 'disposed tick rejected');
check(disposed.reason === 'disposed', 'disposed reason explicit');
check(beforeDisposeCalls === 1, 'dispose did not alter prior tick count');
check(runtime.audit().ok === false, 'audit fails closed after dispose');

// Constructor options are fail-safe rather than trusted blindly.
for (const options of [
  { seed: undefined, clockSeconds: Number.NaN },
  { seed: null, clockSeconds: -100 },
  { seed: 'api', clockSeconds: Number.POSITIVE_INFINITY },
]) {
  const instance = createLivingWorldCompanionRuntime({ ...options, services });
  const proof = instance.tick({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 } });
  check(proof.accepted === true, `constructor ${String(options.seed)} accepts fail-safe options`);
  check(Number.isFinite(proof.clockSeconds), `constructor ${String(options.seed)} clock finite`);
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_API_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_API_PASS checks=${passed}`);
