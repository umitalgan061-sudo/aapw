import {
  createLivingWorldCompanionCommandRuntime,
  auditLivingWorldCompanionCommandRuntime,
  LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY,
} from '../src/3d/gameplay/livingWorldCompanionCommandRuntime.js';

const failures = [];
let passed = 0;
const check = (value, message) => value ? passed++ : failures.push(message);
const eq = (a, b, message) => check(Object.is(a, b), `${message}: ${String(a)} !== ${String(b)}`);
const actor = (id, x, z, extra = {}) => ({
  id,
  ...extra,
  position: { x, z },
  object3D: { position: { x, z }, userData: {} },
});
const collections = (leader = actor('leader', 0, 0), follower = actor('wolf', 15, 0), extras = {}) => ({
  npcs: [leader, ...(extras.raider ? [extras.raider] : [])],
  animals: [follower],
  creatures: extras.creatures ?? [],
  dragons: extras.dragons ?? [],
});
const makeServices = ({ hostile = false } = {}) => {
  const calls = [];
  return {
    calls,
    services: {
      perception: {
        getSignals: (a) => a?.id === 'leader' && hostile
          ? [{ id: 'enemy', kind: 'enemy', confidence: 1, distanceMeters: 3, visible: true, audible: true, targetId: 'raider', position: { x: 2, z: 0 } }]
          : [],
      },
      factions: { getFactionIdForActor: () => 'watch' },
      reputation: { getReputation: () => hostile ? -20 : 0 },
      diplomacy: { getRelation: () => hostile ? 'war' : 'neutral' },
      law: { getWantedLevel: () => hostile ? 80 : 0, getCrimeSeverity: () => hostile ? 60 : 0, reportCrime: () => ({ accepted: true }) },
      navigation: {
        requestTravel: (follower, request) => { calls.push(['navigation', follower.id, request]); return { accepted: true }; },
      },
      combat: {
        requestSupport: (follower, target, request) => { calls.push(['combat-support', follower.id, target.id, request]); return { accepted: true }; },
        requestAttack: (follower, target, request) => { calls.push(['combat-attack', follower.id, target.id, request]); return { accepted: true }; },
      },
      worldEventsPublisher: {
        publish: (event) => { calls.push(['event', event]); return { accepted: true }; },
      },
    },
  };
};

for (const [key, expected] of Object.entries({
  deterministic: true,
  maxQueuedCommands: 48,
  maxPendingExternalCommands: 24,
  maxNavigationCommands: 8,
  maxCombatCommands: 8,
  maxEventCommands: 6,
})) eq(LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY[key], expected, `policy ${key}`);

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'buffer-contract' });
  const input = {
    deltaSeconds: 0.25,
    collections: collections(),
    companions: [{ id: 'follow', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }],
    playerPosition: { x: 0, z: 0 },
  };
  const result = runtime.tick(input);
  eq(result.accepted, true, 'runtime accepts generated companion commands');
  eq(result.tick, 1, 'gateway tick index');
  eq(result.receiptCount > 0, true, 'generated command receives receipt');
  eq(calls.length > 0, true, 'winning command reaches real owner');
  check(calls.every((call) => ['navigation', 'event', 'combat-support', 'combat-attack'].includes(call[0])), 'real calls use known owner seams');
  check(Object.isFrozen(result), 'tick result frozen');
  check(Object.isFrozen(result.receipts), 'receipt list frozen');
  check(result.base?.policyId.startsWith('living-world-companion-runtime-'), 'base runtime is composed');
  check(result.basePolicyId.startsWith('living-world-companion-runtime-'), 'base policy retained');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'command audit accepts valid result');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'priority' });
  const first = runtime.enqueueCommand({
    id: 'external-low', owner: 'navigation', kind: 'follow', companionId: 'wolf-link', actorId: 'wolf', targetId: 'leader', priority: 1,
  });
  eq(first.accepted, true, 'external command queues');
  const second = runtime.enqueueCommand({
    id: 'external-emergency', owner: 'navigation', kind: 'recover', companionId: 'wolf-link', actorId: 'wolf', targetId: 'leader', priority: 100,
  });
  eq(second.accepted, true, 'emergency command queues');
  const result = runtime.tick({
    deltaSeconds: 0,
    collections: collections(),
    companions: [],
  });
  const selected = result.receipts.find((receipt) => receipt.commandId === 'external-emergency');
  const preempted = result.receipts.find((receipt) => receipt.commandId === 'external-low');
  check(selected?.state === 'accepted', 'emergency command wins arbitration');
  check(['rejected', 'deduped'].includes(preempted?.state), 'lower priority loses under emergency arbitration');
  check(calls.some((call) => call[0] === 'navigation'), 'emergency navigation commits');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'ttl' });
  const queued = runtime.enqueueCommand({
    id: 'old-command', owner: 'navigation', kind: 'follow', companionId: 'old', actorId: 'wolf', targetId: 'leader', priority: 5, ttlSeconds: 0.05, createdAtSeconds: 0,
  });
  eq(queued.accepted, true, 'old command queued');
  const result = runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] });
  const receipt = result.receipts.find((row) => row.commandId === 'old-command');
  eq(receipt?.state, 'expired', 'expired command is rejected with explicit state');
  check(!calls.some((call) => call[1] === 'wolf'), 'expired command does not reach owner');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'dedupe' });
  runtime.enqueueCommand({ id: 'same-a', owner: 'navigation', kind: 'follow', companionId: 'same', actorId: 'wolf', targetId: 'leader', priority: 5, payload: { destination: { x: 4, z: 0 } } });
  runtime.enqueueCommand({ id: 'same-b', owner: 'navigation', kind: 'follow', companionId: 'same', actorId: 'wolf', targetId: 'leader', priority: 5, payload: { destination: { x: 4, z: 0 } } });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  const deduped = result.receipts.filter((receipt) => receipt.state === 'deduped');
  eq(deduped.length, 1, 'identical external commands dedupe');
  eq(calls.filter((call) => call[0] === 'navigation').length, 1, 'dedupe allows one navigation commit');
}

{
  const { services, calls } = makeServices({ hostile: true });
  const leader = actor('leader', 0, 0);
  const follower = actor('wolf', 5, 0);
  const raider = actor('raider', 2, 0, { factionId: 'raiders' });
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'combat-buffer' });
  const result = runtime.tick({
    deltaSeconds: 0.25,
    collections: collections(leader, follower, { raider }),
    companions: [{ id: 'assist', actorId: 'wolf', targetId: 'leader', mode: 'assist', priority: 50 }],
  });
  check(result.base?.integration?.reaction != null, 'combat scenario retains reaction integration');
  check(result.receipts.some((receipt) => receipt.owner === 'combat'), 'combat command arbitrated');
  check(calls.some((call) => call[0] === 'combat-support' || call[0] === 'combat-attack'), 'combat command reaches combat owner');
}

{
  const { services, calls } = makeServices();
  services.navigation.requestTravel = () => { throw new Error('navigation-outage'); };
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'owner-failure' });
  const result = runtime.tick({
    deltaSeconds: 0.25,
    collections: collections(),
    companions: [{ id: 'outage', actorId: 'wolf', targetId: 'leader', mode: 'follow' }],
  });
  check(result.accepted, 'downstream navigation failure does not reject base runtime');
  check(result.receipts.some((receipt) => receipt.state === 'failed' && receipt.owner === 'navigation'), 'owner failure has explicit receipt');
  eq(calls.length, 0, 'throwing owner records failure without fabricating a success call');
  check(runtime.audit().ok, 'owner failure remains audit-clean');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'external-budget' });
  for (let i = 0; i < LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.maxPendingExternalCommands; i += 1) {
    const queued = runtime.enqueueCommand({
      id: `queued-${i}`,
      owner: 'navigation',
      kind: 'follow',
      companionId: `companion-${i}`,
      actorId: `actor-${i}`,
      targetId: 'leader',
      priority: i,
    });
    check(queued.accepted, `external queue accepts bounded item ${i}`);
  }
  const overflow = runtime.enqueueCommand({ id: 'overflow', owner: 'navigation', kind: 'follow', companionId: 'overflow', actorId: 'overflow', targetId: 'leader' });
  eq(overflow.accepted, false, 'external queue rejects overflow');
  eq(overflow.reason, 'external-queue-budget', 'external queue exposes overflow reason');
  const audit = runtime.audit();
  check(audit.ok, 'bounded external queue stays audit-clean');
}

{
  const input = {
    deltaSeconds: 0.25,
    collections: collections(),
    companions: [{ id: 'deterministic', actorId: 'wolf', targetId: 'leader', mode: 'follow', priority: 20 }],
    playerPosition: { x: 0, z: 0 },
  };
  const aServices = makeServices();
  const bServices = makeServices();
  const a = createLivingWorldCompanionCommandRuntime({ services: aServices.services, seed: 'same-seed' });
  const b = createLivingWorldCompanionCommandRuntime({ services: bServices.services, seed: 'same-seed' });
  const first = a.tick(input);
  const second = b.tick(input);
  eq(first.digest, second.digest, 'same seed produces command digest deterministically');
  eq(JSON.stringify(first.receipts), JSON.stringify(second.receipts), 'same seed produces identical receipts');
  eq(JSON.stringify(first.base.results), JSON.stringify(second.base.results), 'same seed preserves base runtime determinism');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'snapshot' });
  runtime.enqueueCommand({ id: 'snap', owner: 'navigation', kind: 'follow', companionId: 'snap', actorId: 'wolf', targetId: 'leader', priority: 10 });
  const result = runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [] });
  const snapshot = runtime.snapshot();
  check(snapshot.companions.length === 1, 'snapshot records companion command history');
  check(snapshot.receipts.length >= 1, 'snapshot retains receipts');
  check(Object.isFrozen(snapshot), 'snapshot frozen');
  check(Object.isFrozen(snapshot.companions), 'snapshot companion list frozen');
  check(Object.isFrozen(snapshot.receipts), 'snapshot receipt list frozen');
  check(snapshot.policyId === LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY.id, 'snapshot exposes command policy');
  check(snapshot.digest.length === 8, 'snapshot digest stable shape');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'result audit remains valid');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services, seed: 'reset' });
  runtime.enqueueCommand({ id: 'reset-me', owner: 'navigation', kind: 'follow', companionId: 'reset', actorId: 'wolf', targetId: 'leader' });
  runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] });
  runtime.reset();
  runtime.reset();
  const snapshot = runtime.snapshot();
  eq(snapshot.tick, 0, 'double reset clears tick state');
  eq(snapshot.pendingExternal, 0, 'reset clears external queue');
  eq(snapshot.companionCount, 0, 'reset clears command records');
  eq(calls.length, 1, 'reset does not replay prior commands');
  check(runtime.audit().ok, 'reset leaves runtime audit-clean');
}

{
  const { services, calls } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  runtime.tick({ deltaSeconds: 0, collections: collections(), companions: [{ id: 'dispose', actorId: 'wolf', targetId: 'leader' }] });
  const before = calls.length;
  eq(runtime.dispose(), true, 'first dispose accepted');
  eq(runtime.dispose(), false, 'second dispose rejected');
  eq(runtime.disposed, true, 'disposed getter true');
  eq(runtime.enqueueCommand({ id: 'blocked', owner: 'navigation', kind: 'follow', companionId: 'blocked', actorId: 'wolf', targetId: 'leader' }).accepted, false, 'enqueue fails closed after dispose');
  eq(runtime.tick({ deltaSeconds: 0.25, collections: collections(), companions: [] }).accepted, false, 'tick fails closed after dispose');
  eq(calls.length, before, 'disposed runtime does not reach owners');
  check(runtime.audit().ok === false, 'disposed runtime audit is deliberately not ok');
}

{
  const { services } = makeServices();
  const runtime = createLivingWorldCompanionCommandRuntime({ services });
  const result = runtime.tick({ deltaSeconds: 0, collections: { npcs: [actor('leader', 0, 0)], animals: [], creatures: [], dragons: [] }, companions: [] });
  check(result.accepted, 'empty tick is accepted');
  eq(result.selectedCount, 0, 'empty tick selects no commands');
  eq(result.receiptCount, 0, 'empty tick emits no receipts');
  check(auditLivingWorldCompanionCommandRuntime(result).ok, 'empty tick audits cleanly');
}

{
  const source = await import('../src/3d/gameplay/livingWorldCompanionCommandRuntime.js?contract=1');
  check(typeof source.createLivingWorldCompanionCommandRuntime === 'function', 'production command runtime factory exported');
  check(typeof source.auditLivingWorldCompanionCommandRuntime === 'function', 'production command audit exported');
  check(Object.isFrozen(source.LIVING_WORLD_COMPANION_COMMAND_RUNTIME_POLICY), 'command policy frozen');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_COMMAND_RUNTIME_PASS checks=${passed}`);
