import { createLivingWorldCompanionRuntime, LIVING_WORLD_COMPANION_RUNTIME_POLICY } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (condition, message) => condition ? passed++ : failures.push(message);
const actor = (id, x, z) => ({ id, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const makeServices = () => {
  let navigation = 0; let combat = 0; let events = 0;
  const services = {
    perception: { getSignals: () => [] },
    factions: { getFactionIdForActor: () => 'watch' },
    reputation: { getReputation: () => 0 },
    diplomacy: { getRelation: () => 'neutral' },
    law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: () => ({ accepted: true }) },
    navigation: { requestTravel: () => { navigation += 1; return { accepted: true }; } },
    combat: { requestSupport: () => { combat += 1; return { accepted: true }; } },
    worldEventsPublisher: { publish: () => { events += 1; return { accepted: true }; } },
  };
  return { services, counts: () => ({ navigation, combat, events }) };
};

const guard = actor('guard', 0, 0);
const wolves = Array.from({ length: 32 }, (_, index) => actor(`wolf-${index}`, 6 + index, 0));
const collections = { npcs: [guard], animals: wolves, creatures: [], dragons: [] };
const companions = wolves.map((wolf, index) => ({ id: `link-${index}`, actorId: wolf.id, targetId: guard.id, mode: index % 5 === 0 ? 'hold' : 'follow' }));
const { services, counts } = makeServices();
const runtime = createLivingWorldCompanionRuntime({ services, seed: 'performance' });

const start = process.hrtime.bigint();
let last;
for (let frame = 0; frame < 120; frame += 1) {
  last = runtime.tick({ deltaSeconds: 1 / 60, collections, companions, playerPosition: { x: 0, z: 0 } });
}
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
const maxNavigation = LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxNavigationRequests;
const maxCombat = LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxCombatRequests;
const maxEvents = LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxEventPublishes;
const snapshot = runtime.snapshot();

check(last?.accepted === true, '120-frame stress remains accepted');
check(last?.companionCount === 32, 'stress retains 32 companion links');
check(last?.navigationRequests?.length <= maxNavigation, 'per-frame navigation requests remain capped');
check(last?.combatRequests?.length <= maxCombat, 'per-frame combat requests remain capped');
check(last?.publishedEvents?.length <= maxEvents, 'per-frame world events remain capped');
check(snapshot.links.length === 32, 'tracked link state stays bounded');
check(elapsedMs < 5000, `120-frame deterministic stress remains bounded (${elapsedMs.toFixed(1)}ms)`);
check(Number.isFinite(elapsedMs), 'stress measurement finite');
check(Number.isInteger(counts().navigation) && counts().navigation >= 0, 'navigation owner count finite');
check(Number.isInteger(counts().combat) && counts().combat >= 0, 'combat owner count finite');
check(Number.isInteger(counts().events) && counts().events >= 0, 'event owner count finite');
check(last.results.every((row) => ['near', 'distant', 'far', 'culled'].includes(row.lod)), 'all LODs canonical');
check(last.results.every((row) => typeof row.digest === 'string' && row.digest.length === 8), 'all telemetry digests bounded');
check(last.results.every((row) => Number.isFinite(row.distanceMeters ?? 0)), 'all distances finite');
check(last.results.every((row) => row.history.length <= LIVING_WORLD_COMPANION_RUNTIME_POLICY.maxHistoryPerLink), 'history stays within budget');

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_PERF_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log('LIVING_WORLD_COMPANION_PERF_PASS', JSON.stringify({
  frames: 120,
  companions: 32,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  navigationCalls: counts().navigation,
  combatCalls: counts().combat,
  eventCalls: counts().events,
  maxNavigation,
  maxCombat,
  maxEvents,
}));
