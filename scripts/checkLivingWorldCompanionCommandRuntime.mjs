import {
  createLivingWorldCompanionCommandRuntime,
  auditLivingWorldCompanionCommandRuntime,
  LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY,
} from '../src/3d/gameplay/livingWorldCompanionCommandRuntime.js';

const failures = [];
let passed = 0;
const check = (value, message) => value ? passed++ : failures.push(message);
const eq = (a, b, message) => check(Object.is(a, b), `${message}: ${String(a)} !== ${String(b)}`);
const actor = (id, x, z) => ({ id, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const collections = (leader = actor('leader', 0, 0), follower = actor('wolf', 15, 0), raider = null) => ({
  npcs: [leader, ...(raider ? [raider] : [])],
  animals: [follower],
  creatures: [],
  dragons: [],
});
const makeServices = ({ hostile = false } = {}) => {
  const calls = [];
  return {
    calls,
    services: {
      perception: { getSignals: (a) => a?.id === 'leader' && hostile ? [{ id: 'enemy', kind: 'enemy', confidence: 1, distanceMeters: 3, visible: true, audible: true, targetId: 'raider', position: { x: 2, z: 0 } }] : [] },
      factions: { getFactionIdForActor: () => 'watch' },
      reputation: { getReputation: () => hostile ? -20 : 0 },
      diplomacy: { getRelation: () => hostile ? 'war' : 'neutral' },
      law: { getWantedLevel: () => hostile ? 80 : 0, getCrimeSeverity: () => hostile ? 60 : 0, reportCrime: () => ({ accepted: true }) },
      navigation: { requestTravel: (follower, request) => { calls.push(['navigation', follower?.id ?? null, request]); return { accepted: true }; } },
      combat: { requestSupport: (follower, target, request) => { calls.push(['combat-support', follower?.id ?? null, target?.id ?? null, request]); return { accepted: true }; }, requestAttack: (follower, target, request) => { calls.push(['combat-attack', follower?.id ?? null, target?.id ?? null, request]); return { accepted: true }; } },
      worldEventsPublisher: { publish: (event) => { calls.push(['event', event]); return { accepted: true }; } },
    },
  };
};

for (const [key, expected] of Object.entries({ deterministic: true, maxQueuedCommands: 48, maxPendingExternalCommands: 24, maxNavigationCommands: 8, maxCombatCommands: 8, maxEventCommands: 6 })) {
  eq(LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY[key], expected, `policy ${key}`);
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'buffer' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'follow', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }], playerPosition: { x: 0, z: 0 } });
  check(result.accepted === true, 'generated runtime command accepted');
  check(result.receiptCount > 0, 'generated command receipt emitted');
  check(calls.length > 0, 'generated winner reaches real owner');
  check(Object.isFrozen(result.receipts), 'receipt list frozen');
  check(result.basePolicyId.startsWith('living-world-companion-runtime-'), 'base runtime remains visible');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'generated result audits cleanly');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'external-event' });
  const a = runtime.enqueueCommand({ id: 'event-low', owner: 'event', kind: 'companion-runtime', companionId: 'event-link', actorId: 'wolf', targetId: 'leader', priority: 1, payload: { marker: 'low' } });
  const b = runtime.enqueueCommand({ id: 'event-high', owner: 'event', kind: 'companion-combat-intent', companionId: 'event-link', actorId: 'wolf', targetId: 'leader', priority: 100, payload: { marker: 'high' } });
  check(a.accepted && b.accepted, 'external event commands queue');
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  check(result.receipts.some((r) => r.commandId === 'event-high' && r.state === 'accepted'), 'high priority event wins');
  check(result.receipts.some((r) => r.commandId === 'event-low' && r.state === 'rejected'), 'low priority event rejected by owner budget');
  check(calls.filter((call) => call[0] === 'event').length === 1, 'one winning event commits');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'dedupe-a', owner: 'event', kind: 'companion-runtime', companionId: 'same', actorId: 'wolf', targetId: 'leader', payload: { x: 1 } });
  runtime.enqueueCommand({ id: 'dedupe-b', owner: 'event', kind: 'companion-runtime', companionId: 'same', actorId: 'wolf', targetId: 'leader', payload: { x: 1 } });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  eq(result.receipts.filter((r) => r.state === 'deduped').length, 1, 'identical commands dedupe');
  eq(calls.filter((call) => call[0] === 'event').length, 1, 'dedupe commits once');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  const queued = runtime.enqueueCommand({ id: 'expired', owner: 'event', kind: 'companion-runtime', companionId: 'expired', actorId: 'wolf', targetId: 'leader', ttlSeconds: 0.05, createdAtSeconds: 0 });
  check(queued.accepted, 'ttl command queued');
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] });
  eq(result.receipts.find((r) => r.commandId === 'expired')?.state, 'expired', 'expired command has explicit receipt');
  eq(calls.length, 0, 'expired command never commits');
}

{
  const { services } = makeServices({ hostile: true });
  const leader = actor('leader', 0, 0);
  const follower = actor('wolf', 5, 0);
  const raider = actor('raider', 2, 0);
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'combat' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(leader, follower, raider), companions: [{ id: 'assist', actorId: 'wolf', targetId: 'leader', mode: 'assist', priority: 50 }] });
  check(result.base?.integration?.reaction != null, 'reaction integration still composed');
  check(result.receipts.some((r) => r.owner === 'combat'), 'combat command reaches arbitration');
}

{
  const { services, calls } = makeServices();
  services.navigation.requestTravel = () => { throw new Error('navigation-outage'); };
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'outage' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'outage', actorId: 'wolf', targetId: 'leader', mode: 'follow' }] });
  check(result.accepted, 'owner exception does not reject runtime');
  check(result.receipts.some((r) => r.state === 'failed' && r.owner === 'navigation'), 'owner exception becomes failure receipt');
  eq(calls.length, 0, 'throwing owner produces no fake success');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  for (let i = 0; i < LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxPendingExternalCommands; i += 1) {
    check(runtime.enqueueCommand({ id: `queue-${i}`, owner: 'event', kind: 'companion-runtime', companionId: `c-${i}`, actorId: `a-${i}`, targetId: 'leader' }).accepted, `queue accepts ${i}`);
  }
  const overflow = runtime.enqueueCommand({ id: 'overflow', owner: 'event', kind: 'companion-runtime', companionId: 'overflow', actorId: 'overflow', targetId: 'leader' });
  eq(overflow.accepted, false, 'external queue rejects overflow');
  eq(overflow.reason, 'external-queue-budget', 'external queue reason explicit');
}

{
  const input = { deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'det', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }], playerPosition: { x: 0, z: 0 } };
  const aServices = makeServices();
  const bServices = makeServices();
  const a = createLivingWorldCompanionCommandRuntime({ services: aServices.services, seed: 'same' });
  const b = createLivingWorldCompanionCommandRuntime({ services: bServices.services, seed: 'same' });
  const first = a.tick(input);
  const second = b.tick(input);
  eq(first.digest, second.digest, 'same seed command digest deterministic');
  eq(JSON.stringify(first.receipts), JSON.stringify(second.receipts), 'same seed receipts deterministic');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'snap', owner: 'event', kind: 'companion-runtime', companionId: 'snap', actorId: 'wolf', targetId: 'leader' });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  const snapshot = runtime.snapshot();
  check(snapshot.companions.length === 1, 'snapshot retains companion record');
  check(snapshot.receipts.length === 1, 'snapshot retains receipt');
  check(Object.isFrozen(snapshot), 'snapshot frozen');
  check(Object.isFrozen(snapshot.companions), 'snapshot companions frozen');
  check(Object.isFrozen(snapshot.receipts), 'snapshot receipts frozen');
  check(snapshot.digest.length === 8, 'snapshot digest shape stable');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'reset', owner: 'event', kind: 'companion-runtime', companionId: 'reset', actorId: 'wolf', targetId: 'leader' });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  runtime.reset();
  runtime.reset();
  eq(runtime.snapshot().tick, 0, 'double reset clears tick');
  eq(runtime.snapshot().pendingExternal, 0, 'double reset clears queue');
  eq(calls.length, 1, 'reset does not replay commands');
  check(runtime.audit().ok, 'reset audit clean');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [{ id: 'dispose', actorId: 'wolf', targetId: 'leader' }] });
  const before = calls.length;
  eq(runtime.dispose(), true, 'dispose first call true');
  eq(runtime.dispose(), false, 'dispose second call false');
  eq(runtime.disposed, true, 'disposed getter true');
  eq(runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] }).accepted, false, 'disposed tick fails closed');
  eq(runtime.enqueueCommand({ id: 'blocked', owner: 'event', kind: 'companion-runtime', companionId: 'blocked', actorId: 'wolf', targetId: 'leader' }).accepted, false, 'disposed enqueue fails closed');
  eq(calls.length, before, 'disposed runtime cannot call owners');
  check(runtime.audit().ok === false, 'disposed audit fails closed');
}

{
  const runtime = createLivingWorldCompanionCommandRuntime({ services: makeServices().services });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  check(result.accepted && result.selectedCount === 0 && result.receiptCount === 0, 'empty tick remains no-op');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'empty tick audits cleanly');
}

{
  const source = await import('../src/3d/gameplay/livingWorldCompanionCommandRuntime.js?contract=2');
  check(typeof source.createLivingWorldCompanionCommandRuntime === 'function', 'factory export present');
  check(typeof source.auditLivingWorldCompanionCommandRuntime === 'function', 'audit export present');
  check(Object.isFrozen(source.LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY), 'policy export frozen');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_PASS checks=${passed}`);
