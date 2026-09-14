import assert from 'node:assert/strict';
import { createEnvironmentDressingRuntimeV64, createV64AcceptanceProfiles } from '../src/3d/world/environmentDressingRuntimeV64.js';
import { createV64VisualQualityLedger, createV64SceneEvidence, validateV64PlacementManifest } from '../src/3d/world/environmentDressingEvidenceV64.js';
import { createV64RenderBudget, createV64VisualColliderParity } from '../src/3d/world/environmentRenderBudgetV64.js';
import { createAtmosphereWeatherPlanV64, createGroundDecalPlanV64 } from '../src/3d/world/environmentDressingAtmosphereV64.js';
import { createV64QuerySnapshot } from '../src/3d/world/environmentDressingGroundQueryV64.js';
import { createMultiscaleSurfaceMaterialResponseV64 } from '../src/3d/world/environmentSurfaceMaterialResponseV64.js';

const make = (profile, distance) => ({
  sampleId: profile,
  seed: `acceptance-${profile}`,
  terrain: {
    x: profile === 'terrain-near-northwest' ? 1400 : 4500,
    y: profile === 'full-world' ? 90 : 116,
    z: profile === 'terrain-near-northwest' ? 1200 : 3500,
    height: 116,
    canonicalHeight: 116,
    colliderHeight: 116,
    slope: profile === 'terrain-near-northwest' ? 27 : 12,
    moisture: profile === 'full-world' ? 0.42 : 0.56,
    elevation01: profile === 'terrain-near-northwest' ? 0.78 : 0.44,
    snowWeight: profile === 'terrain-near-northwest' ? 0.46 : 0.06,
    relief: profile === 'full-world' ? 0.58 : 0.69,
    curvature: 0.12,
    biome: profile === 'terrain-near-northwest' ? 'taiga' : 'forest',
    surface: profile === 'terrain-near-northwest' ? 'scree' : 'grass',
    canonicalSource: 'canonical-owner-map',
    terrainBackend: 'Terrain3D',
  },
  water: profile.includes('shore')
    ? { waterClass: 'lake', waterDistance: 3, depth: 6, shorelineWeight: 0.86, wetEdgeWeight: 0.78, foamWeight: 0.25, cyanRisk: 0, moireRisk: 0, rectangular: false, repeatedStripe: false, seamRisk: 0 }
    : { waterClass: 'land', waterDistance: 180, depth: 0, shorelineWeight: 0, wetEdgeWeight: 0, foamWeight: 0, cyanRisk: 0, moireRisk: 0, rectangular: false, repeatedStripe: false, seamRisk: 0 },
  material: { role: profile === 'terrain-near-northwest' ? 'scree' : 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.8, macroContrast: 0.73, microDetail: 0.71 },
  vegetation: [{ assetId: 'tree-a', category: 'tree', x: 4506, y: 116, z: 3510, grounded: true, groundConfidence: 0.95, slope: 9, moisture: 0.6, height01: 0.42, distanceToWater: 80, roadDistance: 45, settlementDistance: 120, instanceBatch: 'acceptance-forest' }],
  camera: { profile, width: 1536, height: 1024, orthographicDegrees: 90, distance, targetX: 4500, targetY: 116, targetZ: 3500, seed: `camera-${profile}` },
  renderedY: 116,
  colliderY: 116,
  postProcessed: false,
  editorRuntimeImported: false,
  primitiveGeometry: false,
});

function runProfile(profile, distance) {
  const plan = createEnvironmentDressingRuntimeV64(make(profile, distance));
  const ledger = createV64VisualQualityLedger(plan);
  const scene = createV64SceneEvidence(plan);
  assert.equal(plan.p1.parity.pass, true);
  assert.equal(plan.p0.seam, 0);
  assert.equal(plan.p0.rectangularWater, 0);
  assert.equal(plan.p0.moire, 0);
  assert.equal(plan.p0.cyan, 0);
  assert.equal(plan.quality.placeholder, 0);
  assert.equal(plan.quality.missingMaterial, 0);
  assert.equal(plan.quality.primitiveGeometry, 0);
  assert.equal(scene.acceptance.parity, true);
  assert.equal(validateV64PlacementManifest(scene.placement).valid, true);
  assert.equal(ledger.pass, true);
  return plan;
}

const profiles = createV64AcceptanceProfiles('acceptance');
assert.equal(profiles.length, 4);
for (const profile of profiles) runProfile(profile.sampleId, profile.distance);

const nearPlan = runProfile('terrain-near-center', 420);
const northwest = runProfile('terrain-near-northwest', 360);
const material = createMultiscaleSurfaceMaterialResponseV64({
  terrain: northwest.terrain,
  water: northwest.water,
  material: northwest.material,
  cameraDistance: 360,
  seed: 'acceptance-material',
});
assert.equal(material.antiTilingPass, true);
assert.ok(material.microDetail > 0);

const atmosphere = createAtmosphereWeatherPlanV64({
  camera: nearPlan.p5,
  terrain: northwest.terrain,
  weather: { phase: 'day', visibilityMeters: 3200, backgroundLuminance: 0.14, wind: 0.4, precipitation: 0.1 },
});
assert.equal(atmosphere.sky.blackSky, 0);
assert.equal(atmosphere.fog.ordered, true);

const decals = createGroundDecalPlanV64({ terrain: northwest.terrain, water: northwest.water, cameraDistance: 360, seed: 'acceptance-decals' });
assert.equal(decals.regularGrid, false);

const query = createV64QuerySnapshot({ ...make('terrain-near-center', 420).terrain, ...make('terrain-near-center', 420).water });
assert.equal(query.contract, 'buzul-muhafizi-ground-query-v64-20260914');

const parity = createV64VisualColliderParity({ terrain: nearPlan.terrain, renderedY: 116.08, colliderY: 116.04 });
assert.equal(parity.pass, true);
const budget = createV64RenderBudget({ fps: 56, drawCalls: 88, triangles: 820000, textureMemoryMb: 520, mobile: true, cameraDistance: 420 });
assert.equal(budget.overBudget, false);

console.log(JSON.stringify({ ok: true, profiles: profiles.length, contract: nearPlan.contract }, null, 2));
