import fs from 'node:fs';
import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (v, m) => v ? passed++ : failures.push(m);
const actor = (id, x, z, extra = {}) => ({ id, ...extra, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const owner = () => ({
  perception: { getSignals: () => [] },
  factions: { getFactionIdForActor: () => 'watch' },
  reputation: { getReputation: () => 0 },
  diplomacy: { getRelation: () => 'neutral' },
  law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: () => ({ accepted: true }) },
  navigation: { requestTravel: () => ({ accepted: true }) },
  combat: { requestSupport: () => ({ accepted: true }), requestAttack: () => ({ accepted: true }) },
  worldEventsPublisher: { publish: () => ({ accepted: true }) },
});
const run = (name, target, follower, companions, services = owner(), extra = {}) => createLivingWorldCompanionRuntime({ services, seed: name }).tick({
  deltaSeconds: extra.delta ?? 0.25,
  collections: extra.collections ?? { npcs: [target], animals: [follower], creatures: [], dragons: [] },
  companions,
  playerPosition: extra.playerPosition ?? { x: 0, z: 0 },
});

for (let i = 0; i < 16; i += 1) {
  const target = actor('leader', 0, 0); const follower = actor('follower', 8 + i, i % 3);
  const result = run(`formation-${i}`, target, follower, [{ id: `link-${i}`, actorId: 'follower', targetId: 'leader', mode: 'follow', followDistanceMeters: 6, priority: i - 8 }]);
  check(result.accepted === true, `formation-${i}: accepted`);
  check(result.navigationRequests.every((request) => Number.isFinite(request.destination?.x ?? 0) && Number.isFinite(request.destination?.z ?? 0)), `formation-${i}: finite destination`);
  check(result.navigationRequests.every((request) => Number.isFinite(request.targetPosition?.x ?? 0) && Number.isFinite(request.targetPosition?.z ?? 0)), `formation-${i}: finite target projection`);
  check(result.results[0]?.followDistanceMeters >= 2 && result.results[0]?.followDistanceMeters <= 18, `formation-${i}: follow envelope`);
}

const velocityCases = [
  { x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 2 }, { x: 8, z: -4 },
  { x: 100, z: 100 }, { x: -100, z: -100 }, { x: 1e6, z: 0 }, { x: 0, z: -1e6 },
];
for (const [i, velocity] of velocityCases.entries()) {
  const target = actor('leader', 0, 0); target.velocity = velocity; const follower = actor('follower', 12, 0);
  const result = run(`velocity-${i}`, target, follower, [{ id: 'velocity', actorId: 'follower', targetId: 'leader' }]);
  for (const request of result.navigationRequests) {
    check(Number.isFinite(request.destination?.x ?? 0), `velocity-${i}: finite destination x`);
    check(Number.isFinite(request.destination?.z ?? 0), `velocity-${i}: finite destination z`);
    check(Number.isFinite(request.targetPosition?.x ?? 0), `velocity-${i}: finite projected x`);
    check(Number.isFinite(request.targetPosition?.z ?? 0), `velocity-${i}: finite projected z`);
  }
}

const distances = [2, 6, 18, 44, 45, 46, 119, 120, 121, 259, 260, 261, 500];
for (const distance of distances) {
  const target = actor('leader', 0, 0); const follower = actor('follower', distance, 0);
  const result = run(`distance-${distance}`, target, follower, [{ id: 'distance', actorId: 'follower', targetId: 'leader' }]);
  check(['near', 'distant', 'far', 'culled'].includes(result.results[0]?.lod), `distance-${distance}: canonical LOD`);
}

const modeCases = [
  ['follow', 'following', 'follow'], ['escort', 'following', 'escort'], ['assist', 'holding', 'assist'], ['regroup', 'regrouping', 'regroup'], ['hold', 'holding', 'hold'],
];
for (const [name, acceptable, mode] of modeCases) {
  const target = actor('leader', 0, 0); const follower = actor('follower', 8, 0);
  const result = run(`mode-${name}`, target, follower, [{ id: name, actorId: 'follower', targetId: 'leader', mode }]);
  check(result.results[0]?.mode === mode, `mode-${name}: mode preserved`);
  check(result.results[0]?.state === acceptable || (name === 'assist' && result.results[0]?.state !== 'detached'), `mode-${name}: state remains canonical`);
}

const mixedFamilies = [
  ['animals', actor('horse', 8, 0)], ['animals', actor('wolf', 8, 1)], ['animals', actor('bear', 8, -1)],
  ['creatures', actor('gryphon', 8, 2)], ['creatures', actor('beast', 8, -2)], ['dragons', actor('dragon', 8, 3)],
  ['dragons', actor('wyvern', 8, -3)],
];
for (const [family, follower] of mixedFamilies) {
  const target = actor('leader', 0, 0); const collections = { npcs: [target], animals: [], creatures: [], dragons: [] }; collections[family].push(follower);
  const result = run(`family-${follower.id}`, target, follower, [{ id: follower.id, actorId: follower.id, targetId: 'leader', mode: 'follow' }], owner(), { collections });
  check(result.companionCount === 1, `family-${follower.id}: accepted`);
}

// Source and placement boundary.
const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js', import.meta.url), 'utf8');
check(!source.includes('EditorMaterialStudio'), 'no editor material import');
check(!source.includes('MaterialAssignmentCore'), 'no duplicate material core');
check(!source.includes('WorldAssetPlacementPipeline'), 'no duplicate placement pipeline');
check(!source.includes('ActorRegistry'), 'no second registry');
check(!source.includes('EventBus'), 'no second event bus');

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_FORMATION_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_FORMATION_PASS checks=${passed}`);
