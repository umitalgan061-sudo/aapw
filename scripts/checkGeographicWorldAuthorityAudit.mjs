import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const scene = read('src/3d/sceneManager.js');
const terrain = read('src/3d/world/terrain.js');
const reference = read('src/3d/world/worldReferenceMap.js');
const roads = read('src/3d/world/roads.js');
const settlements = read('src/3d/world/settlements.js');
const villages = read('src/3d/world/villages.js');
const props = read('src/3d/world/geographicSettlementProps.js');
const propQuality = read('src/3d/world/geographicSettlementPropQuality.js');
const placement = read('src/3d/world/WorldAssetPlacementPipeline.js');
const materials = read('src/3d/materials/MaterialAssignmentCore.js');

assert.match(reference, /owner-world-map-2026-08-08/);
assert.match(reference, /REFERENCE_BIOME_ZONES/);
assert.match(reference, /normalizedMapToWorldXZ/);
assert.match(terrain, /WORLD_REFERENCE_MAP|REFERENCE_BIOME_ZONES|terrainMapUvAt/);
assert.match(scene, /createHeightSampler\(WORLD_DEFAULTS\.WORLD_SEED\)/);
assert.match(scene, /createGroundCollider\(WORLD_DEFAULTS\.WORLD_SEED/);
assert.match(scene, /sampleHeightMeters: groundCollider\.getGroundHeight/);
assert.match(scene, /sampleHeightMeters: roadsResult|sampleHeightMeters: groundCollider\.getGroundHeight/);
assert.match(scene, /createGeographicSettlementPropLayer/);
assert.match(scene, /WorldAssetPlacementPipeline|geographicSettlementProps/);
assert.match(props, /REFERENCE_BIOME_ZONES/);
assert.match(props, /terrainMapUvAt/);
assert.match(props, /sampleSurface\(/);
assert.match(props, /roadDistance/);
assert.match(props, /maxSlopeDegrees/);
assert.match(props, /waterDepth/);
assert.match(propQuality, /MaterialAssignmentCore/);
assert.match(propQuality, /WorldAssetPlacementPipeline/);
assert.match(placement, /evaluateWorldSurfacePlacement/);
assert.match(placement, /auditWorldAssetPlacement/);
assert.match(materials, /validateMaterialAssignment/);
assert.match(settlements, /computeSettlementFlattenPads/);
assert.match(villages, /WorldAssetPlacementPipeline/);
assert.match(roads, /sampleHeightMeters/);

for (const source of [scene, props, propQuality, villages]) {
  assert.doesNotMatch(source, /Math\.random\(/, 'geographic world systems must remain deterministic');
  assert.doesNotMatch(source, /createHeightSampler\(/, 'consumer modules must not create a second terrain sampler');
}

assert.doesNotMatch(props, /new\s+ChunkManager/);
assert.doesNotMatch(props, /new\s+SettlementManager/);
assert.doesNotMatch(propQuality, /new\s+SettlementManager/);

const authorityClaims = {
  map: /owner-world-map-2026-08-08/,
  terrainHeight: /groundCollider\.getGroundHeight/,
  placement: /WorldAssetPlacementPipeline/,
  materials: /MaterialAssignmentCore/,
};
const authorityText = `${scene}\n${props}\n${propQuality}`;
for (const [name, pattern] of Object.entries(authorityClaims)) assert.match(authorityText, pattern, `${name} authority missing`);

console.log(JSON.stringify({
  ok: true,
  mapAuthority: 'owner-world-map-2026-08-08',
  terrainHeightAuthority: 'sceneManager -> groundCollider.getGroundHeight',
  placementAuthority: 'WorldAssetPlacementPipeline',
  materialAuthority: 'MaterialAssignmentCore',
  deterministic: true,
  secondTerrainSamplerRejected: true,
  secondSettlementManagerRejected: true,
}));
