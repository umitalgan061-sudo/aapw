import {
  createSettlementWorldCoverageAcceptance,
} from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const services = [
  ['gate', ['door-north', 'road-east']],
  ['market', ['vendor-market', 'stall-market']],
  ['tavern', ['interior-tavern', 'npc-tavern']],
  ['blacksmith', ['forge-blacksmith', 'workbench-blacksmith']],
  ['farm', ['field-farm', 'barn-farm']],
  ['barracks', ['barracks-main', 'training-barracks']],
  ['stable', ['stable-main', 'mount-stable']],
  ['house', ['house-main', 'bed-house']],
];

const assets = services.flatMap(([serviceId, ids]) => ids.map((assetId) => ({
  family: serviceId === 'tavern' || serviceId === 'house' ? 'houses' : 'settlements',
  assetId,
  status: 'loaded',
  textured: true,
  grounded: true,
})));
const materials = ['wall', 'roof', 'wood', 'door', 'window', 'metal', 'stone-trim'].map((role) => ({
  id: `${role}-canonical`,
  role,
  kind: 'pbr',
  textured: true,
  textureSize: 1024,
}));
const manifests = services.map(([serviceId, ids]) => ({
  id: `${serviceId}-manifest`,
  serviceId,
  assetId: ids[0],
  materialManifestId: `materials-${serviceId}`,
  status: 'validated',
  surfaceRoles: materials.map((material) => material.role),
  materialIds: materials.map((material) => material.id),
  groundAligned: true,
  sceneAttached: true,
}));
const placements = services.map(([serviceId, ids]) => ({
  id: `${serviceId}-placement`,
  serviceId,
  assetId: ids[0],
  status: 'attached',
  manifestId: `${serviceId}-manifest`,
  materialManifestId: `materials-${serviceId}`,
  position: { x: 0, y: 0, z: 0 },
  groundPosition: { x: 0, y: 0, z: 0 },
  expectedGroundY: 0,
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  grounded: true,
  collisionReady: true,
  materialValidated: true,
}));

const cameras = ['full-world', 'settlement-far', 'settlement-center', 'settlement-northwest'].map((profile) => ({
  profile,
  width: 1536,
  height: 1024,
  projection: 'orthographic',
  readable: true,
}));
const interactions = services.map(([serviceId], index) => ({
  id: `interaction-${serviceId}`,
  serviceId,
  action: 'interact',
  sequence: index + 1,
  ok: true,
}));

const acceptance = createSettlementWorldCoverageAcceptance({
  settlementId: 'canonical-settlement',
  assets,
  materials,
  manifests,
  placements,
  cameras,
  interactions,
});

assert(acceptance.status === 'green', `expected complete evidence to be green, got ${acceptance.status}`);
assert(acceptance.flags.servicesCovered, 'all canonical settlement services must be covered');
assert(acceptance.services.every((row) => row.status === 'covered'), 'manifest-linked asset evidence must cover every service');
assert(acceptance.manifests.invalidCount === 0, 'manifest material evidence must remain valid');
assert(acceptance.placements.invalidCount === 0, 'placement evidence must remain valid');
console.log(JSON.stringify({ status: acceptance.status, score: acceptance.score, fingerprint: acceptance.fingerprint }));
