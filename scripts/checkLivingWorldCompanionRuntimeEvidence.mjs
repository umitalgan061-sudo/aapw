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
const target = actor('leader', 0, 0);
const follower = actor('companion', 7, 0);
const collections = { npcs: [target], animals: [follower], creatures: [], dragons: [] };
const companions = [{ id: 'evidence-link', actorId: 'companion', targetId: 'leader', mode: 'follow', priority: 5, followDistanceMeters: 6 }];
const runtime = createLivingWorldCompanionRuntime({ services, seed: 'evidence' });

let previousTick = 0;
for (let frame = 0; frame < 40; frame += 1) {
  const result = runtime.tick({ deltaSeconds: 0.05, collections, companions, playerPosition: { x: 0, z: 0 } });
  check(result.accepted === true, `frame-${frame}: accepted`);
  check(result.tick === previousTick + 1, `frame-${frame}: sequential tick`);
  check(Number.isFinite(result.clockSeconds), `frame-${frame}: clock finite`);
  check(result.companionCount === 1, `frame-${frame}: companion count`);
  check(result.results.length === 1, `frame-${frame}: result count`);
  check(result.results[0].companionId === 'evidence-link', `frame-${frame}: identity`);
  check(result.results[0].actorId === 'companion', `frame-${frame}: actor id`);
  check(result.results[0].targetId === 'leader', `frame-${frame}: target id`);
  check(['follow', 'escort', 'assist', 'regroup', 'hold'].includes(result.results[0].mode), `frame-${frame}: mode enum`);
  check(['linked', 'following', 'assisting', 'regrouping', 'holding', 'recovering', 'detached'].includes(result.results[0].state), `frame-${frame}: state enum`);
  check(['near', 'distant', 'far', 'culled'].includes(result.results[0].lod), `frame-${frame}: LOD enum`);
  check(typeof result.results[0].digest === 'string' && result.results[0].digest.length === 8, `frame-${frame}: digest`);
  check(result.results[0].history.length <= 8, `frame-${frame}: bounded history`);
  previousTick = result.tick;
}

const snapshot = runtime.snapshot();
check(snapshot.companionCount === 1, 'snapshot companion count');
check(snapshot.links.length === 1, 'snapshot link count');
check(snapshot.links[0].id === 'evidence-link', 'snapshot link id');
check(snapshot.links[0].history.length <= 8, 'snapshot history bound');
check(typeof snapshot.digest === 'string' && snapshot.digest.length === 8, 'snapshot digest');
check(snapshot.disposed === false, 'snapshot not disposed');

// Telemetry is deliberately namespaced and serializable.
const telemetry = follower.object3D.userData.livingWorldCompanion;
check(Boolean(telemetry), 'telemetry exists');
check(Object.isFrozen(telemetry), 'telemetry frozen');
check(typeof telemetry.companionId === 'string', 'telemetry companion id');
check(typeof telemetry.actorId === 'string', 'telemetry actor id');
check(typeof telemetry.targetId === 'string', 'telemetry target id');
check(Number.isFinite(telemetry.distanceMeters ?? 0), 'telemetry distance finite');
check(typeof telemetry.digest === 'string' && telemetry.digest.length === 8, 'telemetry digest');
check(!('mesh' in telemetry) && !('material' in telemetry), 'telemetry carries no render ownership');
check(!('damage' in telemetry) && !('hitPoints' in telemetry), 'telemetry carries no combat state ownership');
check(!('spawn' in telemetry) && !('despawn' in telemetry), 'telemetry carries no spawn ownership');

// Stable replays produce the same telemetry digest sequence.
function replay(seed) {
  const a = actor('leader', 0, 0); const b = actor('companion', 7, 0);
  const instance = createLivingWorldCompanionRuntime({ services, seed });
  const values = [];
  for (let frame = 0; frame < 12; frame += 1) {
    const result = instance.tick({ deltaSeconds: 0.1, collections: { npcs: [a], animals: [b], creatures: [], dragons: [] }, companions, playerPosition: { x: 0, z: 0 } });
    values.push({ tick: result.tick, digest: result.digest, row: result.results[0]?.digest ?? '' });
  }
  return values;
}
const firstReplay = replay('evidence-replay');
const secondReplay = replay('evidence-replay');
check(JSON.stringify(firstReplay) === JSON.stringify(secondReplay), 'evidence replay bytes are identical');

// Changing seed must remain legal without introducing non-finite evidence.
for (const seed of ['a', 'b', 0, 1, 9999, null, undefined]) {
  const values = replay(seed);
  check(values.every((entry) => typeof entry.digest === 'string' && entry.digest.length === 8), `seed-${String(seed)}: digest schema`);
  check(values.every((entry) => typeof entry.row === 'string' && entry.row.length === 8), `seed-${String(seed)}: row digest schema`);
}

// Recovery evidence remains explicit after the target disappears.
{
  const f = actor('companion', 1, 0); const t = actor('leader', 0, 0);
  const instance = createLivingWorldCompanionRuntime({ services, seed: 'recovery-evidence' });
  const first = instance.tick({ deltaSeconds: 0.25, collections: { npcs: [t], animals: [f], creatures: [], dragons: [] }, companions: [{ id: 'recovery', actorId: 'companion', targetId: 'leader' }] });
  check(first.results[0].state !== 'detached', 'recovery starts linked');
  const second = instance.tick({ deltaSeconds: 0.25, collections: { npcs: [], animals: [f], creatures: [], dragons: [] }, companions: [{ id: 'recovery', actorId: 'companion', targetId: 'leader' }] });
  check(second.results[0].state === 'recovering', 'recovery state explicit');
  check(second.results[0].recoveryCount >= 1, 'recovery counter explicit');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_EVIDENCE_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_EVIDENCE_PASS checks=${passed}`);
