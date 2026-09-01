#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  VALYRIA_BARREN_ECOLOGY_POLICY,
  VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS,
  createValyriaBarrenEcologyPlacementProbe,
  isOrdinaryEcologyAllowedAtWorldXZ,
  valyriaEcologyPlacementDensityAtWorldXZ,
  valyriaEcologyProfileAtWorldXZ,
} from '../src/3d/world/valyriaEcology.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';

const SYSTEM = VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS;
const POLICY = VALYRIA_BARREN_ECOLOGY_POLICY;

function worldFromNormalized(nx, ny) {
  const bounds = WORLD_SCALE.MAP_BOUNDS;
  const mapX = bounds.minX + nx * (bounds.maxX - bounds.minX);
  const mapY = bounds.minY + ny * (bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  return {
    x: (mapX - centerX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
    z: (mapY - centerY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
    nx,
    ny,
  };
}

const core = worldFromNormalized(
  VALYRIA_GEOLOGY_POLICY.coreCenter.nx,
  VALYRIA_GEOLOGY_POLICY.coreCenter.ny,
);
const outside = worldFromNormalized(0.20, 0.28);

for (const ecologySystem of Object.values(SYSTEM)) {
  assert.equal(
    isOrdinaryEcologyAllowedAtWorldXZ(core.x, core.z, ecologySystem),
    false,
    `${ecologySystem} must be absent from the hard Doom core`,
  );
  assert.equal(
    isOrdinaryEcologyAllowedAtWorldXZ(outside.x, outside.z, ecologySystem),
    true,
    `${ecologySystem} must remain unchanged outside Valyria`,
  );
  assert.equal(valyriaEcologyPlacementDensityAtWorldXZ(core.x, core.z, ecologySystem), 0);
  assert.equal(valyriaEcologyPlacementDensityAtWorldXZ(outside.x, outside.z, ecologySystem), 1);
}
assert.throws(
  () => valyriaEcologyPlacementDensityAtWorldXZ(core.x, core.z, 'dragon-garden'),
  /Unknown Valyria ecology placement system/,
);

let sampled = 0;
let transitionSamples = 0;
let grassAllowed = 0;
let vegetationAllowed = 0;
let villageAllowed = 0;
let grassOnly = 0;
let vegetationWithoutVillage = 0;
let grassOnlyPoint = null;
let vegetationWithoutVillagePoint = null;

for (let iy = 0; iy <= 128; iy += 1) {
  const ny = 0.59 + (iy / 128) * 0.27;
  for (let ix = 0; ix <= 128; ix += 1) {
    const nx = 0.32 + (ix / 128) * 0.25;
    const point = worldFromNormalized(nx, ny);
    const profile = valyriaEcologyProfileAtWorldXZ(point.x, point.z);
    const grassDensity = valyriaEcologyPlacementDensityAtWorldXZ(point.x, point.z, SYSTEM.GRASS);
    const vegetationDensity = valyriaEcologyPlacementDensityAtWorldXZ(point.x, point.z, SYSTEM.VEGETATION);
    const villageDensity = valyriaEcologyPlacementDensityAtWorldXZ(point.x, point.z, SYSTEM.VILLAGE);

    assert(villageDensity <= vegetationDensity + 1e-12, 'village density exceeded vegetation density');
    assert(vegetationDensity <= grassDensity + 1e-12, 'vegetation density exceeded grass density');
    if (!profile.proceduralVillageAllowed) assert.equal(villageDensity, 0);

    const grass = isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z, SYSTEM.GRASS);
    const vegetation = isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z, SYSTEM.VEGETATION);
    const village = isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z, SYSTEM.VILLAGE);
    assert(!village || vegetation, 'village mask must be a spatial subset of vegetation');
    assert(!vegetation || grass, 'vegetation mask must be a spatial subset of grass');

    sampled += 1;
    if (grassDensity > 0 && grassDensity < 1) transitionSamples += 1;
    if (grass) grassAllowed += 1;
    if (vegetation) vegetationAllowed += 1;
    if (village) villageAllowed += 1;
    if (grass && !vegetation) {
      grassOnly += 1;
      grassOnlyPoint ??= point;
    }
    if (vegetation && !village) {
      vegetationWithoutVillage += 1;
      vegetationWithoutVillagePoint ??= point;
    }
  }
}

assert(transitionSamples > 100, `Valyria transition sampling was too small: ${transitionSamples}`);
assert(grassAllowed > vegetationAllowed, 'grass must survive more transition cells than ordinary trees');
assert(vegetationAllowed > villageAllowed, 'ordinary trees must survive more transition cells than villages');
assert(grassOnly > 10, `expected visible grass-only refugia, got ${grassOnly}`);
assert(vegetationWithoutVillage > 10, `expected tree-without-village refugia, got ${vegetationWithoutVillage}`);
assert(grassOnlyPoint, 'missing representative grass-only point');
assert(vegetationWithoutVillagePoint, 'missing representative tree-without-village point');

let canonicalCalls = 0;
const canonicalSampler = (x, z) => {
  canonicalCalls += 1;
  return 72 + x * 0.00001 - z * 0.00001;
};
const makeProbe = (ecologySystem) => createValyriaBarrenEcologyPlacementProbe({
  sampleHeightMeters: canonicalSampler,
  seaLevelMeters: 6,
  ecologySystem,
});
const grassProbe = makeProbe(SYSTEM.GRASS);
const vegetationProbe = makeProbe(SYSTEM.VEGETATION);
const villageProbe = makeProbe(SYSTEM.VILLAGE);

const callsBeforeGrassOnly = canonicalCalls;
const grassHeight = grassProbe.sampleHeightMeters(grassOnlyPoint.x, grassOnlyPoint.z);
const vegetationRejectedHeight = vegetationProbe.sampleHeightMeters(grassOnlyPoint.x, grassOnlyPoint.z);
const villageRejectedHeight = villageProbe.sampleHeightMeters(grassOnlyPoint.x, grassOnlyPoint.z);
assert(Number.isFinite(grassHeight));
assert.equal(vegetationRejectedHeight, vegetationProbe.rejectionHeightMeters);
assert.equal(villageRejectedHeight, villageProbe.rejectionHeightMeters);
assert.equal(canonicalCalls - callsBeforeGrassOnly, 1, 'only surviving grass should delegate at grass-only refugia');

const callsBeforeTreeOnly = canonicalCalls;
const grassAtTreePoint = grassProbe.sampleHeightMeters(vegetationWithoutVillagePoint.x, vegetationWithoutVillagePoint.z);
const vegetationAtTreePoint = vegetationProbe.sampleHeightMeters(vegetationWithoutVillagePoint.x, vegetationWithoutVillagePoint.z);
const villageAtTreePoint = villageProbe.sampleHeightMeters(vegetationWithoutVillagePoint.x, vegetationWithoutVillagePoint.z);
assert(Number.isFinite(grassAtTreePoint));
assert(Number.isFinite(vegetationAtTreePoint));
assert.equal(villageAtTreePoint, villageProbe.rejectionHeightMeters);
assert.equal(canonicalCalls - callsBeforeTreeOnly, 2, 'grass and trees should delegate while village stays rejected');

const sceneSource = fs.readFileSync(new URL('../src/3d/sceneManager.js', import.meta.url), 'utf8');
assert(sceneSource.includes('VALYRIA_ECOLOGY_PLACEMENT_SYSTEMS'));
assert(sceneSource.includes('valyriaVegetationPlacement.sampleHeightMeters'));
assert(sceneSource.includes('valyriaVillagePlacement.sampleHeightMeters'));
assert(sceneSource.includes('state.valyriaEcologyPlacement.sampleHeightMeters'));
assert(!sceneSource.includes('EditorMaterialStudio'));

for (const point of [core, outside, grassOnlyPoint, vegetationWithoutVillagePoint]) {
  for (const ecologySystem of Object.values(SYSTEM)) {
    assert.equal(
      isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z, ecologySystem),
      isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z, ecologySystem),
    );
  }
}

console.log('VALYRIA_ECOLOGY_SYSTEM_DISTRIBUTION_PASS', JSON.stringify({
  policyId: POLICY.id,
  sampled,
  transitionSamples,
  grassAllowed,
  vegetationAllowed,
  villageAllowed,
  grassOnly,
  vegetationWithoutVillage,
  canonicalCalls,
  grassOnlyPoint,
  vegetationWithoutVillagePoint,
}, null, 2));
