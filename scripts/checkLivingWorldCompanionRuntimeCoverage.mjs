import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (condition, message) => condition ? passed++ : failures.push(message);
const actor = (id, x, z, extra = {}) => ({ id, ...extra, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const services = (signals = new Map()) => ({
  perception: { getSignals: (a) => signals.get(a?.id) ?? [] },
  factions: { getFactionIdForActor: (a) => a?.factionId ?? 'watch' },
  reputation: { getReputation: () => 0 },
  diplomacy: { getRelation: () => 'neutral' },
  law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: () => ({ accepted: true }) },
  navigation: { requestTravel: () => ({ accepted: true }) },
  combat: { requestSupport: () => ({ accepted: true }), requestAttack: () => ({ accepted: true }) },
  worldEventsPublisher: { publish: () => ({ accepted: true }) },
});
const collection = (target, follower, extra = {}) => ({ npcs: [target], animals: [follower], creatures: extra.creatures ?? [], dragons: extra.dragons ?? [] });
const input = (collections, companions, extra = {}) => ({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 }, ...extra });
const link = (id, actorId, targetId, mode = 'follow', extra = {}) => ({ id, actorId, targetId, mode, ...extra });

function basic(mode, followerX = 6, targetX = 0, extra = {}) {
  const follower = actor(extra.actorId ?? 'companion', followerX, 0);
  const target = actor(extra.targetId ?? 'leader', targetX, 0);
  const runtime = createLivingWorldCompanionRuntime({ services: services(), seed: extra.seed ?? mode });
  return { runtime, follower, target, result: runtime.tick(input(collection(target, follower), [link('case', follower.id, target.id, mode, extra)])), };
}

const scenarios = [
  ['01-follow-near', () => basic('follow', 8)],
  ['02-follow-close', () => basic('follow', 3)],
  ['03-follow-far', () => basic('follow', 20)],
  ['04-follow-default-mode', () => basic(undefined, 8)],
  ['05-escort', () => basic('escort', 8)],
  ['06-hold-near', () => basic('hold', 3)],
  ['07-hold-far', () => basic('hold', 20)],
  ['08-regroup', () => basic('regroup', 20)],
  ['09-assist-peace', () => basic('assist', 6)],
  ['10-invalid-mode', () => basic('invalid-mode', 6)],
  ['11-priority-negative', () => basic('follow', 6, 0, { priority: -999 })],
  ['12-priority-positive', () => basic('follow', 6, 0, { priority: 999 })],
  ['13-follow-distance-low', () => basic('follow', 6, 0, { followDistanceMeters: -30 })],
  ['14-follow-distance-high', () => basic('follow', 6, 0, { followDistanceMeters: 999 })],
  ['15-recover-distance-low', () => basic('follow', 20, 0, { recoverDistanceMeters: -2 })],
  ['16-recover-distance-high', () => basic('follow', 20, 0, { recoverDistanceMeters: 999 })],
  ['17-malformed-seed', () => basic('follow', 6, 0, { seed: null })],
  ['18-negative-delta', () => basic('follow', 6, 0, { deltaSeconds: -10 })],
  ['19-large-delta', () => basic('follow', 6, 0, { deltaSeconds: 99 })],
  ['20-zero-delta', () => basic('follow', 6, 0, { deltaSeconds: 0 })],
];

for (const [name, factory] of scenarios) {
  try {
    const { result } = factory();
    check(result.accepted === true, `${name}: accepted`);
    check(result.companionCount === 1, `${name}: companion count`);
    check(result.results.length === 1, `${name}: one result`);
    check(['near', 'distant', 'far', 'culled'].includes(result.results[0]?.lod), `${name}: canonical LOD`);
    check(typeof result.digest === 'string' && result.digest.length === 8, `${name}: digest`);
  } catch (error) {
    failures.push(`${name}: threw ${error?.message || error}`);
  }
}

// 21-24: missing participant matrix.
{
  const follower = actor('follower', 0, 0);
  const target = actor('target', 0, 0);
  const cases = [
    ['21-missing-target', collection(follower, follower), [link('missing-target', 'follower', 'missing')]],
    ['22-missing-follower', { npcs: [target], animals: [], creatures: [], dragons: [] }, [link('missing-follower', 'missing', 'target')]],
    ['23-empty-collections', { npcs: [], animals: [], creatures: [], dragons: [] }, [link('empty', 'missing', 'missing')]],
    ['24-null-collections', {}, [link('null-collections', 'missing', 'missing')]],
  ];
  for (const [name, collections, companions] of cases) {
    const result = createLivingWorldCompanionRuntime({ services: services(), seed: name }).tick(input(collections, companions));
    check(result.accepted === true, `${name}: accepted`);
    check(result.companionCount === 1, `${name}: tracked malformed link`);
    check(result.results[0]?.state === 'recovering', `${name}: recovery state`);
  }
}

// 25-28: distance and population-radius boundaries.
{
  const boundaryCases = [
    ['25-near-edge', 45, 'near'],
    ['26-distant-edge', 120, 'distant'],
    ['27-far-edge', 260, 'far'],
    ['28-culled-over-edge', 260.01, 'culled'],
  ];
  for (const [name, x, expectedLod] of boundaryCases) {
    const target = actor('leader', 0, 0); const follower = actor('companion', x, 0);
    const result = createLivingWorldCompanionRuntime({ services: services(), seed: name }).tick(input(collection(target, follower), [link(name, follower.id, target.id)], { playerPosition: { x: 0, z: 0 } }));
    check(result.results[0]?.lod === expectedLod, `${name}: LOD boundary`);
  }
}

// 29-32: missing or invalid player coordinates fail closed.
{
  const playerCases = [
    ['29-no-player', null],
    ['30-nan-player', { x: Number.NaN, z: 0 }],
    ['31-inf-player', { x: Number.POSITIVE_INFINITY, z: Number.NEGATIVE_INFINITY }],
    ['32-large-player', { x: 1e12, z: -1e12 }],
  ];
  for (const [name, playerPosition] of playerCases) {
    const target = actor('leader', 0, 0); const follower = actor('companion', 5, 0);
    const result = createLivingWorldCompanionRuntime({ services: services(), seed: name }).tick(input(collection(target, follower), [link(name, follower.id, target.id)], { playerPosition }));
    check(result.accepted === true, `${name}: accepted`);
    check(result.results.every((row) => ['near', 'distant', 'far', 'culled'].includes(row.lod)), `${name}: LOD stays canonical`);
  }
}

// 33-36: velocity prediction bounds.
{
  const velocities = [
    ['33-zero-velocity', { x: 0, z: 0 }],
    ['34-positive-velocity', { x: 5, z: 0 }],
    ['35-negative-velocity', { x: -5, z: -5 }],
    ['36-extreme-velocity', { x: 1e9, z: -1e9 }],
  ];
  for (const [name, velocity] of velocities) {
    const target = actor('leader', 0, 0); target.velocity = velocity; const follower = actor('companion', 10, 0);
    const result = createLivingWorldCompanionRuntime({ services: services(), seed: name }).tick(input(collection(target, follower), [link(name, follower.id, target.id)]));
    for (const request of result.navigationRequests) {
      check(Number.isFinite(request.destination?.x ?? 0) && Number.isFinite(request.destination?.z ?? 0), `${name}: finite navigation destination`);
      check(Number.isFinite(request.targetPosition?.x ?? 0) && Number.isFinite(request.targetPosition?.z ?? 0), `${name}: finite target position`);
    }
  }
}

// 37-40: mixed actor families have the same ownership contract.
{
  const familyCases = [
    ['37-horse', 'horse', { animals: [actor('horse', 7, 0)] }],
    ['38-wolf', 'wolf', { animals: [actor('wolf', 7, 0)] }],
    ['39-creature', 'creature', { animals: [], creatures: [actor('creature', 7, 0)] }],
    ['40-dragon', 'dragon', { animals: [], creatures: [], dragons: [actor('dragon', 7, 0)] }],
  ];
  for (const [name, followerId, payload] of familyCases) {
    const target = actor('leader', 0, 0);
    const follower = payload.animals?.[0] ?? payload.creatures?.[0] ?? payload.dragons?.[0];
    const collections = { npcs: [target], animals: payload.animals ?? [], creatures: payload.creatures ?? [], dragons: payload.dragons ?? [] };
    const result = createLivingWorldCompanionRuntime({ services: services(), seed: name }).tick(input(collections, [link(name, followerId, target.id)]));
    check(result.accepted === true, `${name}: accepted`);
    check(result.companionCount === 1, `${name}: one family companion`);
    check(result.results[0]?.actorId === followerId, `${name}: actor identity`);
  }
}

// Deterministic scenario pair checks.
for (let index = 0; index < 20; index += 1) {
  const target = actor('leader', index, 0); const follower = actor('companion', index + 6, index % 3);
  const collections = collection(target, follower);
  const companions = [link(`det-${index}`, follower.id, target.id, index % 2 ? 'follow' : 'escort', { priority: index - 10 })];
  const first = createLivingWorldCompanionRuntime({ services: services(), seed: `det-${index}` }).tick(input(collections, companions));
  const second = createLivingWorldCompanionRuntime({ services: services(), seed: `det-${index}` }).tick(input(collections, companions));
  check(first.digest === second.digest, `det-${index}: digest stable`);
  check(JSON.stringify(first.results) === JSON.stringify(second.results), `det-${index}: result stable`);
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_COVERAGE_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_COVERAGE_PASS scenarios=60 checks=${passed}`);
