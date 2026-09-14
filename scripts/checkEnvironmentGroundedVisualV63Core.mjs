import assert from 'node:assert/strict';
import {
  V63_CONTRACT,
  createGroundedVisualRuntimeV63,
  validateGroundedVisualRuntimeV63,
  compareGroundedVisualRuntimeV63,
  createTerrainBreakupFieldV63,
  createWaterOpticalResponseV63,
  createHabitatDensityV63,
  createStreamingPlanV63,
  createParityDiagnosticsV63,
  createNaturalTransformV63,
  createShorelineBandProfileV63,
  getV63ContractSummary,
} from '../src/3d/world/environmentGroundedVisualRuntimeV63.js';

const fixture = (patch = {}) => ({
  sampleId: 'core', seed: 'core-seed',
  terrain: { x: 4500, y: 116, z: 3500, height: 116, canonicalHeight: 116, colliderHeight: 116, slope: 12, moisture: 0.42, elevation01: 0.46, snowWeight: 0.08, roughness: 0.74, normal: { x: 0.1, y: 0.96, z: 0.12 }, biome: 'temperate', surface: 'grass', canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D', regionId: 'center' },
  water: { waterClass: 'land', waterDistance: 120, depth: 0, shorelineWeight: 0, wetEdgeWeight: 0, foamWeight: 0, cyanRisk: 0, moireRisk: 0, tileLike: false, rectangular: false, repeatedStripe: false, seamRisk: 0 },
  material: { role: 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.82, normalScale: 0.8, ao: 0.56, macroContrast: 0.7, microDetail: 0.68, textureRepeat: 1 },
  vegetation: [],
  camera: { profile: 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: 420, seed: 'camera', targetX: 4500, targetY: 116, targetZ: 3500 },
  renderedY: 116, colliderY: 116, postProcessed: false, editorRuntimeImported: false, primitiveGeometry: false,
  ...patch,
});

const tests = [];
function check(name, fn) { tests.push([name, fn]); }

check('contract identity', () => assert.equal(V63_CONTRACT.id, 'buzul-muhafizi-grounded-visual-runtime-v63-20260914'));
check('canonical extent', () => assert.deepEqual(V63_CONTRACT.canonicalExtent, { width: 9000, height: 7000 }));
check('acceptance camera', () => assert.deepEqual(V63_CONTRACT.acceptanceCamera, { width: 1536, height: 1024, orthographicDegrees: 90 }));
check('clean plan valid', () => assert.equal(validateGroundedVisualRuntimeV63(createGroundedVisualRuntimeV63(fixture())).valid, true));
check('clean plan frozen', () => assert.equal(Object.isFrozen(createGroundedVisualRuntimeV63(fixture())), true));
check('clean p0', () => assert.equal(Object.values(createGroundedVisualRuntimeV63(fixture()).p0).reduce((a, b) => a + b, 0), 0));
check('clean parity', () => assert.equal(createGroundedVisualRuntimeV63(fixture()).geometry.parityPass, true));
check('camera fallback', () => { const p = createGroundedVisualRuntimeV63(fixture({ camera: { profile: 'fullWorld' } })); assert.equal(p.input.camera.width, 1536); assert.equal(p.input.camera.height, 1024); assert.equal(p.input.camera.distance, 7000); });
check('camera clamp width', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ camera: { width: 32, height: 9999, profile: 'terrain-near' } })).input.camera.width, 256));
check('camera clamp height', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ camera: { width: 9999, height: 32, profile: 'terrain-near' } })).input.camera.height, 256));
check('camera clamp angle', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ camera: { orthographicDegrees: 200 } })).input.camera.orthographicDegrees, 120));
check('camera clamp distance', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ camera: { distance: -10 } })).input.camera.distance, 0.1));
check('unknown water normalized', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { waterClass: 'canal' } })).input.water.class, 'unknown'));
check('unknown biome normalized', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, biome: 'volcanic' } })).input.terrain.biome, 'unknown'));
check('unknown surface normalized', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, surface: 'moss' } })).input.terrain.surface, 'unknown'));
check('finite fallback', () => { const p = createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, height: NaN, slope: Infinity, moisture: NaN }, water: { ...fixture().water, depth: Infinity, waterDistance: NaN }, camera: { width: NaN, height: Infinity, distance: NaN } })); assert.ok(Number.isFinite(p.input.terrain.height)); assert.ok(Number.isFinite(p.input.terrain.slope)); assert.ok(Number.isFinite(p.input.water.depth)); assert.ok(Number.isFinite(p.input.camera.width)); });
check('determinism', () => { const a = createGroundedVisualRuntimeV63(fixture()); const b = createGroundedVisualRuntimeV63(fixture()); assert.equal(a.fingerprint, b.fingerprint); });
check('input order stability', () => { const base = fixture({ vegetation: [{ assetId: 'b', grounded: true, groundConfidence: 1, slope: 7, distanceToWater: 30, instanceBatch: 'f' }, { assetId: 'a', grounded: true, groundConfidence: 1, slope: 8, distanceToWater: 31, instanceBatch: 'f' }] }); const reverse = fixture({ vegetation: [...base.vegetation].reverse() }); assert.equal(compareGroundedVisualRuntimeV63(base, reverse).sameFingerprint, true); });
check('p0 rectangular water', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { ...fixture().water, waterClass: 'sea', rectangular: true } })).p0.rectangularWater, 1));
check('p0 tile water', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { ...fixture().water, waterClass: 'sea', tileLike: true } })).p0.rectangularWater, 1));
check('p0 moire', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { ...fixture().water, waterClass: 'lake', repeatedStripe: true } })).p0.moire, 1));
check('p0 cyan', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { ...fixture().water, waterClass: 'river', cyanRisk: 0.9 } })).p0.cyan, 1));
check('p0 seam', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ water: { ...fixture().water, seamRisk: 0.9 } })).p0.seam, 1));
check('p1 wall', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 80, roughness: 0.2 } })).geometry.cliffWall, 1));
check('p1 flat relief', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 1, roughness: 0.1 } })).geometry.flatRelief, 1));
check('p1 snow sheet', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 8, roughness: 0.1, snowWeight: 0.96 } })).geometry.snowSheet, 1));
check('p1 parity failure', () => assert.equal(createGroundedVisualRuntimeV63(fixture({ renderedY: 117, colliderY: 116 })).geometry.parityPass, false));
check('p1 rock exposure', () => assert.ok(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 70 } })).geometry.rockExposure > 0));
check('p1 talus', () => assert.ok(createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 70, elevation01: 0.8 } })).geometry.talus > 0));
check('p2 normalized weights', () => { const p = createGroundedVisualRuntimeV63(fixture()); const sum = Object.values(p.material.weights).reduce((a, b) => a + b, 0); assert.ok(sum > 0.99 && sum < 1.01); });
check('p2 alpine snow', () => { const p = createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, biome: 'alpine', elevation01: 0.95, snowWeight: 0.9, slope: 35 } })); assert.ok(p.material.weights.snow > 0); assert.ok(p.material.snowlineBreakup > 0); });
check('p2 steep rock', () => { const p = createGroundedVisualRuntimeV63(fixture({ terrain: { ...fixture().terrain, slope: 66, surface: 'rock' }, material: { ...fixture().material, role: 'rock' } })); assert.ok(p.material.weights.rock > p.material.weights.grass); assert.equal(p.material.triplanarEquivalent, true); });
check('p2 anti-tiling', () => assert.notEqual(createGroundedVisualRuntimeV63(fixture()).material.antiTilingPhase, undefined));
check('p3 grounded tree', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', category: 'tree', grounded: true, groundConfidence: 0.9, slope: 10, moisture: 0.6, height01: 0.45, distanceToWater: 40, roadDistance: 60, settlementDistance: 80, instanceBatch: 'oak' }] })); assert.equal(p.vegetation.eligible, 1); });
check('p3 floating reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', grounded: false, groundConfidence: 1, slope: 5 }] })); assert.equal(p.vegetation.invalid, 1); });
check('p3 low confidence reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', grounded: true, groundConfidence: 0.2, slope: 5 }] })); assert.equal(p.vegetation.invalid, 1); });
check('p3 cliff reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', grounded: true, groundConfidence: 1, slope: 50, cliff: true }] })); assert.equal(p.vegetation.invalid, 1); });
check('p3 permanent snow reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', grounded: true, groundConfidence: 1, slope: 5, permanentSnow: true }] })); assert.equal(p.vegetation.invalid, 1); });
check('p3 water reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'oak', grounded: true, groundConfidence: 1, slope: 5, distanceToWater: 0.5 }] })); assert.equal(p.vegetation.invalid, 1); });
check('p3 unknown water reject', () => { const p = createGroundedVisualRuntimeV63(fixture({ water: { waterClass: 'canal', waterDistance: 0.2 }, vegetation: [{ assetId: 'oak', grounded: true, groundConfidence: 1, slope: 5, distanceToWater: 10 }] })); assert.equal(p.vegetation.results[0].reason, 'unknown-water-class'); });
check('instancing batch', () => { const p = createGroundedVisualRuntimeV63(fixture({ vegetation: [{ assetId: 'a', grounded: true, groundConfidence: 1, slope: 5, instanceBatch: 'forest' }, { assetId: 'b', grounded: true, groundConfidence: 1, slope: 6, instanceBatch: 'forest' }] })); assert.equal(p.vegetation.batches[0].instanced, true); });
check('water sea response', () => { const w = createWaterOpticalResponseV63({ waterClass: 'sea', depth: 4, distance: 3, wetEdge: 0.8, foam: 0.5, cyanRisk: 0.3, moireRisk: 0.1 }); assert.equal(w.recognized, true); assert.ok(w.shallow > 0); assert.ok(w.shoreBand > 0); });
check('water deep response', () => { const w = createWaterOpticalResponseV63({ waterClass: 'lake', depth: 80, distance: 100, wetEdge: 0, foam: 0 }); assert.ok(w.deep > 0.8); assert.ok(w.shoreBand < 0.01); });
check('water unknown response', () => assert.equal(createWaterOpticalResponseV63({ waterClass: 'canal', depth: 3, distance: 2 }).recognized, false));
check('shore sea bands', () => assert.equal(createShorelineBandProfileV63({ waterClass: 'sea', distance: 3, depth: 2 }).bands.length, 4));
check('shore river bands', () => assert.equal(createShorelineBandProfileV63({ waterClass: 'river', distance: 3, depth: 2 }).bands.length, 4));
check('shore unknown bands', () => assert.equal(createShorelineBandProfileV63({ waterClass: 'canal', distance: 3, depth: 2 }).bands.length, 0));
check('habitat forest', () => { const h = createHabitatDensityV63({ biome: 'forest', slope: 10, moisture: 0.7, elevation01: 0.45, waterDistance: 50, roadDistance: 100, settlementDistance: 100 }); assert.ok(h.density > 0.5); assert.ok(h.canopy > 0.4); });
check('habitat desert', () => { const h = createHabitatDensityV63({ biome: 'desert', slope: 10, moisture: 0.1, elevation01: 0.4, waterDistance: 200, roadDistance: 100, settlementDistance: 100 }); assert.ok(h.density < 0.4); });
check('habitat road clearing', () => { const a = createHabitatDensityV63({ biome: 'forest', slope: 10, moisture: 0.7, elevation01: 0.45, waterDistance: 100, roadDistance: 2, settlementDistance: 100 }); const b = createHabitatDensityV63({ biome: 'forest', slope: 10, moisture: 0.7, elevation01: 0.45, waterDistance: 100, roadDistance: 100, settlementDistance: 100 }); assert.ok(a.density < b.density); assert.ok(a.clearingRadius > b.clearingRadius); });
check('streaming mobile cap', () => { const p = createStreamingPlanV63({ cameraDistance: 500, vegetationInstances: 900, textureMemoryMb: 600, mobile: true, visibleChunks: 12, residentChunks: 14 }); assert.equal(p.maxVegetationInstances, 640); assert.equal(p.maxTextureMemoryMb, 512); assert.equal(p.overBudget, true); });
check('streaming far band', () => { const p = createStreamingPlanV63({ cameraDistance: 5000, vegetationInstances: 200, textureMemoryMb: 200, visibleChunks: 10, residentChunks: 20, mobile: false }); assert.equal(p.lodBand, 'impostor'); assert.equal(p.chunkCulling, true); });
check('parity pass', () => assert.equal(createParityDiagnosticsV63({ canonicalHeight: 10, renderedHeight: 10.1, colliderHeight: 10.05, canonicalX: 0, canonicalZ: 0, renderedX: 0.05, renderedZ: 0.04, colliderX: 0.02, colliderZ: 0.01 }).sameCoordinate, true));
check('parity fail', () => assert.equal(createParityDiagnosticsV63({ canonicalHeight: 10, renderedHeight: 11, colliderHeight: 9, canonicalX: 0, canonicalZ: 0, renderedX: 3, renderedZ: 0, colliderX: 0, colliderZ: 3 }).sameCoordinate, false));
check('natural transform deterministic', () => assert.deepEqual(createNaturalTransformV63({ assetId: 'oak', x: 3, z: 7, seed: 'same' }), createNaturalTransformV63({ assetId: 'oak', x: 3, z: 7, seed: 'same' })));
check('natural transform varied', () => { const scales = new Set(); for (let i = 0; i < 24; i += 1) scales.add(createNaturalTransformV63({ assetId: `oak-${i}`, x: i * 4, z: i * 3, seed: 'varied' }).scale); assert.ok(scales.size > 8); });
check('terrain breakup deterministic', () => assert.deepEqual(createTerrainBreakupFieldV63({ centerX: 0, centerZ: 0, radius: 32, spacing: 8, seed: 'same' }), createTerrainBreakupFieldV63({ centerX: 0, centerZ: 0, radius: 32, spacing: 8, seed: 'same' })));
check('terrain breakup micro relief', () => assert.ok(createTerrainBreakupFieldV63({ radius: 24, spacing: 6, seed: 'relief' }).cells.some((cell) => Math.abs(cell.microRelief) > 0.05)));
check('contract summary shared authority', () => assert.equal(getV63ContractSummary().sharedPlacementAuthority.mergedSuccessor, 590));
check('contract summary no geometry', () => { const s = getV63ContractSummary(); assert.equal(s.createsGeometry, false); assert.equal(s.hydratesAssets, false); assert.equal(s.importsEditorUi, false); });

for (const [name, fn] of tests) { fn(); console.log(`PASS ${name}`); }
console.log(`V63 core regression: ${tests.length} tests passed`);
