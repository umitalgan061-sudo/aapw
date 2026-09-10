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
  npcs: [leader, ...(raider ? [raider] : [])], animals: [follower], creatures: [], dragons: [],
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
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'generated' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'follow', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }], playerPosition: { x: 0, z: 0 } });
  check(result.accepted, 'generated command runtime accepted');
  check(result.receiptCount > 0, 'generated command has receipt');
  check(calls.length > 0, 'generated command reached an owner');
  check(Object.isFrozen(result.receipts), 'result receipts frozen');
  check(result.basePolicyId.startsWith('living-world-companion-runtime-'), 'base runtime policy retained');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'generated result audit clean');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'priority' });
  for (let i = 0; i < 6; i += 1) runtime.enqueueCommand({ id: `low-${i}`, owner: 'event', kind: 'companion-runtime', companionId: `low-${i}`, actorId: `a-${i}`, targetId: 'leader', priority: i });
  runtime.enqueueCommand({ id: 'emergency', owner: 'event', kind: 'companion-combat-intent', companionId: 'emergency', actorId: 'wolf', targetId: 'leader', priority: 100 });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  check(result.receipts.some((r) => r.commandId === 'emergency' && r.state === 'accepted'), 'emergency command admitted first');
  check(result.receipts.some((r) => r.commandId === 'low-0' && r.state === 'rejected'), 'owner budget rejects overflow after emergency');
  eq(calls.filter((call) => call[0] === 'event').length, 6, 'event budget commits exactly six winners');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'dedupe-a', owner: 'event', kind: 'companion-runtime', companionId: 'same', actorId: 'wolf', targetId: 'leader', payload: { x: 1 } });
  runtime.enqueueCommand({ id: 'dedupe-b', owner: 'event', kind: 'companion-runtime', companionId: 'same', actorId: 'wolf', targetId: 'leader', payload: { x: 1 } });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  eq(result.receipts.filter((r) => r.state === 'deduped').length, 1, 'identical signatures dedupe');
  eq(calls.filter((call) => call[0] === 'event').length, 1, 'dedupe commits one event');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'expired', owner: 'event', kind: 'companion-runtime', companionId: 'expired', actorId: 'wolf', targetId: 'leader', ttlSeconds: 0.05, createdAtSeconds: 0 });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] });
  eq(result.receipts.find((r) => r.commandId === 'expired')?.state, 'expired', 'expired command is rejected');
  eq(calls.length, 0, 'expired external command has no owner side effect');
}

{
  const { services } = makeServices({ hostile: true });
  const leader = actor('leader', 0, 0); const follower = actor('wolf', 5, 0); const raider = actor('raider', 2, 0);
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'combat' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(leader, follower, raider), companions: [{ id: 'assist', actorId: 'wolf', targetId: 'leader', mode: 'assist', priority: 50 }] });
  check(result.base?.integration?.reaction != null, 'reaction integration remains composed');
  check(result.receipts.some((r) => r.owner === 'combat'), 'combat request enters arbitration');
}

{
  const { services, calls } = makeServices();
  services.navigation.requestTravel = () => { throw new Error('navigation-outage'); };
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'outage', actorId: 'wolf', targetId: 'leader', mode: 'follow' }] });
  check(result.accepted, 'navigation outage keeps runtime accepted');
  check(result.receipts.some((r) => r.state === 'failed' && r.owner === 'navigation'), 'navigation outage recorded as failure');
  check(!calls.some((call) => call[0] === 'navigation'), 'failed navigation never reports fake side effect');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  for (let i = 0; i < LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxPendingExternalCommands; i += 1) {
    check(runtime.enqueueCommand({ id: `queue-${i}`, owner: 'event', kind: 'companion-runtime', companionId: `c-${i}`, actorId: `a-${i}`, targetId: 'leader' }).accepted, `queue accepts ${i}`);
  }
  const overflow = runtime.enqueueCommand({ id: 'overflow', owner: 'event', kind: 'companion-runtime', companionId: 'overflow', actorId: 'overflow', targetId: 'leader' });
  eq(overflow.accepted, false, 'queue overflow rejected');
  eq(overflow.reason, 'external-queue-budget', 'queue overflow reason explicit');
}

{
  const input = { deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'det', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }], playerPosition: { x: 0, z: 0 } };
  const a = createLivingWorldCompanionCommandRuntime({ services: makeServices().services, seed: 'same' });
  const b = createLivingWorldCompanionCommandRuntime({ services: makeServices().services, seed: 'same' });
  const first = a.tick(input); const second = b.tick(input);
  eq(first.digest, second.digest, 'same seed digest deterministic');
  eq(JSON.stringify(first.receipts), JSON.stringify(second.receipts), 'same seed receipts deterministic');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'snap', owner: 'event', kind: 'companion-runtime', companionId: 'snap', actorId: 'wolf', targetId: 'leader' });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  const snapshot = runtime.snapshot();
  check(snapshot.companions.length === 1, 'snapshot keeps companion record');
  check(snapshot.receipts.length === 1, 'snapshot keeps receipt history');
  check(Object.isFrozen(snapshot), 'snapshot frozen');
  check(snapshot.digest.length === 8, 'snapshot digest stable shape');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.enqueueCommand({ id: 'reset', owner: 'event', kind: 'companion-runtime', companionId: 'reset', actorId: 'wolf', targetId: 'leader' });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  runtime.reset(); runtime.reset();
  eq(runtime.snapshot().tick, 0, 'reset clears tick state');
  eq(runtime.snapshot().pendingExternal, 0, 'reset clears queued commands');
  eq(calls.length, 1, 'reset does not replay commands');
  check(runtime.audit().ok, 'reset audit clean');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [{ id: 'dispose', actorId: 'wolf', targetId: 'leader' }] });
  const before = calls.length;
  eq(runtime.dispose(), true, 'first dispose true');
  eq(runtime.dispose(), false, 'second dispose false');
  eq(runtime.disposed, true, 'disposed getter true');
  eq(runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] }).accepted, false, 'disposed tick fails closed');
  eq(runtime.enqueueCommand({ id: 'blocked', owner: 'event', kind: 'companion-runtime', companionId: 'blocked', actorId: 'wolf', targetId: 'leader' }).accepted, false, 'disposed enqueue fails closed');
  eq(calls.length, before, 'dispose blocks owner side effects');
  check(runtime.audit().ok === false, 'disposed audit fails closed');
}

{
  const runtime = createLivingWorldCompanionCommandRuntime({ services: makeServices().services });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  check(result.accepted && result.selectedCount === 0 && result.receiptCount === 0, 'empty tick is a no-op');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'empty tick audits cleanly');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_PASS checks=${passed}`);
