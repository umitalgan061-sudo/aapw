import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  analyzeMaterialSurfaces,
  buildAutoMaterialRecipe,
  buildRecommendedLayerRecipe,
  applyMaterialRecipe,
  autoAssignMaterials,
  validateMaterialAssignment,
  createMaterialManifest,
  restoreOriginalMaterials,
} from '../src/3d/materials/MaterialAssignmentCore.js';
import { resolvePlayerEquipmentCombatProfile, buildPlayerMaterialAssignmentMetadata } from '../src/3d/gameplay/playerEquipmentCombatProfile.js';

function finiteTree(value, path = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.equal(Number.isFinite(child), true, `${path}.${key} must be finite`);
    else if (child && typeof child === 'object') finiteTree(child, `${path}.${key}`);
  }
}

function mesh(name, materialNames) {
  const materials = materialNames.map((nameValue) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: nameValue.includes('metal') ? 0.75 : 0.05 });
    material.name = nameValue;
    return material;
  });
  const result = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), materials.length === 1 ? materials[0] : materials);
  result.name = name;
  return result;
}

const character = new THREE.Group();
character.name = 'PeasantGirl';
character.userData.assetId = 'player-peasant';
character.userData.assetCategory = 'character';
character.userData.assetSrc = 'assets/models/characters/peasant_girl.fbx';
character.add(mesh('Body', ['body-cloth', 'body-leather']));
character.add(mesh('Head', ['head-skin']));
const hair = mesh('Hair', ['hair']);
hair.userData.materialSlot = 'hair';
character.add(hair);
const weapon = mesh('RightSword', ['weapon-metal']);
weapon.userData.materialSlot = 'weapon';
character.add(weapon);
const shield = mesh('LeftShield', ['shield-metal', 'shield-wood']);
shield.userData.materialSlot = 'shield';
character.add(shield);

const analysis = analyzeMaterialSurfaces(character);
assert.equal(analysis.meshCount, 5);
assert.equal(analysis.placeholder, false);
assert.equal(analysis.surfaceCount, 7);
assert.ok(analysis.uvMeshCount >= 0);
assert.ok(analysis.namedSurfaceCount >= 1);
finiteTree(analysis);

const metadata = {
  id: 'player-peasant',
  name: 'Peasant Girl',
  category: 'character',
  src: 'assets/models/characters/peasant_girl.fbx',
};
const autoRecipe = buildAutoMaterialRecipe(character, { metadata, textureSize: 1024 });
assert.ok(autoRecipe);
assert.equal(autoRecipe.textureSize, 512);
assert.equal(autoRecipe.mode, 'auto');
assert.ok(typeof autoRecipe.basePaletteId === 'string');
finiteTree(autoRecipe);

const layerRecipe = buildRecommendedLayerRecipe(character, { metadata, textureSize: 256, targetMeshIndex: 0 });
assert.ok(layerRecipe);
assert.equal(layerRecipe.mode, 'layers');
assert.equal(layerRecipe.textureSize, 256);
assert.ok(Array.isArray(layerRecipe.layers));
assert.ok(layerRecipe.layers.length > 0);
finiteTree(layerRecipe);

const beforeMaterials = [];
character.traverse((node) => {
  if (node.isMesh) beforeMaterials.push({ node, material: node.material });
});
const applied = applyMaterialRecipe(character, autoRecipe, { metadata });
assert.equal(applied.ok, true);
assert.equal(character.userData.materialRecipe.mode, 'auto');
assert.ok(character.userData.autoTexturePaletteId);
const validation = validateMaterialAssignment(character, { requireGeneratedTexture: true });
assert.equal(validation.ok, true);
assert.equal(validation.placeholder, false);
assert.ok(validation.generatedMaterialCount > 0);
assert.ok(validation.materialSlotCount >= 5);
finiteTree(validation);

const manifest = createMaterialManifest(character, { metadata, placement: { position: { x: 1, y: 0, z: 2 }, rotation: { y: 0.5 }, scale: { x: 1, y: 1, z: 1 } } });
assert.equal(manifest.version, 1);
assert.equal(manifest.asset.id, 'player-peasant');
assert.equal(manifest.asset.src, metadata.src);
assert.equal(manifest.validation.ok, true);
assert.ok(Array.isArray(manifest.surfaces));
assert.ok(manifest.surfaces.length > 0);
assert.deepEqual(manifest.placement.position, { x: 1, y: 0, z: 2 });
finiteTree(manifest);

const restored = restoreOriginalMaterials(character);
assert.ok(restored >= 5);
for (const entry of beforeMaterials) assert.equal(entry.node.userData.originalMaterial === undefined, true);
assert.equal(character.userData.materialRecipe, undefined);
assert.equal(character.userData.autoTexturePaletteId, undefined);

const singleMesh = new THREE.Group();
singleMesh.name = 'SingleMeshHero';
singleMesh.userData.assetId = 'single-hero';
singleMesh.userData.assetCategory = 'character';
singleMesh.add(mesh('Single', ['single-untextured']));
const singleAnalysis = analyzeMaterialSurfaces(singleMesh);
assert.equal(singleAnalysis.meshCount, 1);
assert.equal(singleAnalysis.surfaceCount, 1);
const singleValidation = validateMaterialAssignment(singleMesh, { requireGeneratedTexture: false });
assert.equal(singleValidation.ok, true);
assert.ok(singleValidation.warnings.includes('single-surface-untextured-risk'));
const explicitSingleRecipe = buildAutoMaterialRecipe(singleMesh, { metadata: { id: 'single-hero', name: 'Hero', category: 'character' }, paletteId: 'steel', textureSize: 256 });
assert.ok(explicitSingleRecipe);
const singleApplied = applyMaterialRecipe(singleMesh, explicitSingleRecipe);
assert.equal(singleApplied.ok, true);
assert.equal(validateMaterialAssignment(singleMesh, { requireGeneratedTexture: true }).ok, true);
assert.equal(restoreOriginalMaterials(singleMesh), 1);

const placeholder = new THREE.Group();
placeholder.name = 'Placeholder';
placeholder.userData.isPlaceholder = true;
placeholder.add(mesh('PlaceholderMesh', ['placeholder']));
const placeholderValidation = validateMaterialAssignment(placeholder);
assert.equal(placeholderValidation.ok, false);
assert.ok(placeholderValidation.errors.includes('placeholder-model'));
const placeholderRecipe = buildAutoMaterialRecipe(placeholder, { metadata: { id: 'placeholder', category: 'character' } });
assert.ok(placeholderRecipe || placeholderRecipe === null);

const equipment = resolvePlayerEquipmentCombatProfile({ mainHand: { id: 'longsword' }, offHand: { id: 'shield' }, chest: { id: 'brigandine' } });
const equipmentMaterial = buildPlayerMaterialAssignmentMetadata({ object: character, profile: equipment, textureSize: 512 });
assert.equal(equipmentMaterial.materialContract, 'MaterialAssignmentCore');
assert.equal(equipmentMaterial.placementContract, 'WorldAssetPlacementPipeline');
assert.equal(equipmentMaterial.importedMaterialsPreferred, true);
assert.equal(equipmentMaterial.layeredFallbackAllowed, true);
assert.ok(equipmentMaterial.equipmentSurfaces.mainHand.includes('metal'));
assert.ok(equipmentMaterial.equipmentSurfaces.armor.includes('metal'));
finiteTree(equipmentMaterial);

const dressed = autoAssignMaterials(character, { metadata, paletteId: 'forest', textureSize: 256 });
assert.equal(dressed.ok, true);
assert.equal(dressed.recipe.mode, 'auto');
assert.equal(validateMaterialAssignment(character, { requireGeneratedTexture: true }).ok, true);
const dressedManifest = createMaterialManifest(character, { metadata });
assert.equal(dressedManifest.validation.ok, true);
assert.ok(dressedManifest.surfaces.length >= analysis.surfaceCount);
restoreOriginalMaterials(character);

for (const size of [1, 64, 128, 200, 256, 512, 1024, 4096, NaN, Infinity]) {
  const recipe = buildAutoMaterialRecipe(singleMesh, { metadata: { id: `size-${String(size)}`, category: 'character' }, paletteId: 'stone', textureSize: size });
  assert.ok(recipe);
  assert.ok([128, 256, 512].includes(recipe.textureSize));
}

const deterministicA = createMaterialManifest(singleMesh, { metadata: { id: 'deterministic', name: 'Hero', category: 'character', src: metadata.src } });
restoreOriginalMaterials(singleMesh);
const deterministicB = createMaterialManifest(singleMesh, { metadata: { id: 'deterministic', name: 'Hero', category: 'character', src: metadata.src } });
assert.deepEqual(deterministicA.asset, deterministicB.asset);
assert.deepEqual(deterministicA.surfaces, deterministicB.surfaces);

for (let i = 0; i < 20; i += 1) {
  const candidate = new THREE.Group();
  candidate.name = `Candidate-${i}`;
  candidate.userData.assetId = `player-${i}`;
  candidate.userData.assetCategory = 'character';
  candidate.userData.assetSrc = metadata.src;
  candidate.add(mesh(`Body-${i}`, ['cloth', 'leather']));
  candidate.add(mesh(`Head-${i}`, ['skin']));
  const recipe = buildAutoMaterialRecipe(candidate, { metadata: { id: candidate.userData.assetId, name: candidate.name, category: 'character', src: metadata.src }, paletteId: i % 2 ? 'forest' : 'steel', textureSize: 256 });
  assert.ok(recipe);
  assert.equal(applyMaterialRecipe(candidate, recipe).ok, true);
  const result = validateMaterialAssignment(candidate, { requireGeneratedTexture: true });
  assert.equal(result.ok, true);
  const output = createMaterialManifest(candidate, { metadata });
  assert.equal(output.validation.ok, true);
  finiteTree(output);
  restoreOriginalMaterials(candidate);
}

console.log('[checkPlayerEquipmentMaterialAcceptance] PASS: shared multi-surface analysis, palette/figure-kit recipe selection, layered fallback, material validation, manifest evidence, original-material restoration and equipment surface handoff');
