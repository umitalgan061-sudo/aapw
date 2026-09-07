import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  autoAssignMaterials,
  analyzeMaterialSurfaces,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../src/3d/materials/MaterialAssignmentCore.js';
import { CHARACTER_SURFACE_REQUIREMENTS } from '../src/3d/world/geographicAssetDistributionContract.js';

const failures = [];
const check = (condition, message) => { try { assert.ok(condition, message); } catch (error) { failures.push(error.message); } };

function makePart(name, material = null) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material || new THREE.MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

function makeHumanFixture() {
  const root = new THREE.Group();
  root.name = 'human-fixture';
  root.add(makePart('Skin_Body'));
  root.add(makePart('Hair_Main'));
  root.add(makePart('Eyes_Both'));
  root.add(makePart('Clothing_Coat'));
  root.add(makePart('Boots_Left'));
  root.add(makePart('Gear_Belt'));
  return root;
}

function makeHorseFixture() {
  const root = new THREE.Group();
  root.name = 'horse-fixture';
  root.add(makePart('Coat_Body'));
  root.add(makePart('Mane_Main'));
  root.add(makePart('Tail_Main'));
  root.add(makePart('Hoof_FL'));
  root.add(makePart('Saddle_Leather'));
  root.add(makePart('Harness_Straps'));
  return root;
}

function makeWolfFixture() {
  const root = new THREE.Group();
  root.name = 'wolf-fixture';
  root.add(makePart('Fur_Body'));
  root.add(makePart('Eye_Left'));
  root.add(makePart('Claw_FL'));
  root.add(makePart('Tooth_Upper'));
  return root;
}

function makeDragonFixture() {
  const root = new THREE.Group();
  root.name = 'dragon-fixture';
  root.add(makePart('Scale_Body'));
  root.add(makePart('Wing_Left'));
  root.add(makePart('Eye_Left'));
  root.add(makePart('Horn_Left'));
  root.add(makePart('Claw_FL'));
  return root;
}

function auditFixture(root, family, paletteId) {
  const requirement = CHARACTER_SURFACE_REQUIREMENTS[family];
  check(requirement?.requiredSemanticSurfaces.length > 0, `${family} surface requirement missing`);
  const before = analyzeMaterialSurfaces(root);
  check(before.meshCount === requirement.requiredSemanticSurfaces.length, `${family} fixture mesh count should equal semantic surface count`);
  const assignment = autoAssignMaterials(root, {
    metadata: { id: `${family}-fixture`, name: `${family} layered proof`, category: family, src: `synthetic://${family}` },
    paletteId,
    textureSize: 256,
  });
  check(assignment.ok, `${family} auto material assignment failed`);
  check(assignment.generatedMaterialCount > 0, `${family} fallback did not generate a material layer`);
  const validation = validateMaterialAssignment(root, { requireGeneratedTexture: true });
  check(validation.ok, `${family} generated material validation failed: ${validation.errors.join(',')}`);
  check(validation.meshCount === requirement.requiredSemanticSurfaces.length, `${family} validated mesh count drifted`);
  check(validation.surfaceCount === requirement.requiredSemanticSurfaces.length, `${family} validated surface count drifted`);
  const manifest = createMaterialManifest(root, {
    metadata: { id: `${family}-fixture`, name: `${family} layered proof`, category: family, src: `synthetic://${family}` },
    placement: { mode: 'layered-fallback', geographicFamily: family, synthetic: true },
  });
  check(manifest?.validation?.ok, `${family} manifest did not record a valid assignment`);
  check(manifest?.surfaces?.length === requirement.requiredSemanticSurfaces.length, `${family} manifest surface count drifted`);
  return { family, meshCount: validation.meshCount, surfaceCount: validation.surfaceCount, generatedMaterialCount: validation.generatedMaterialCount, manifestValid: manifest.validation.ok };
}

function auditAuthoredMaterialPreservation() {
  const root = new THREE.Group();
  const texture = new THREE.Texture();
  texture.image = { width: 512, height: 512 };
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.02 });
  root.add(makePart('Clothing_Textured', material));
  const before = root.children[0].material;
  const analyzed = analyzeMaterialSurfaces(root);
  check(analyzed.surfaceCount === 1, 'authored preservation fixture should expose one material surface');
  check(analyzed.surfaces[0].material.map === texture, 'authored texture map should remain attached before validation');
  const validation = validateMaterialAssignment(root, { requireGeneratedTexture: false });
  check(validation.ok, 'authored material should pass validation without generated-texture requirement');
  check(root.children[0].material === before, 'authored material should not be replaced during validation');
}

function auditFailureSignals() {
  const missing = new THREE.Group();
  const validation = validateMaterialAssignment(missing, { requireGeneratedTexture: true });
  check(!validation.ok, 'empty fixture must fail material validation');
  check(validation.errors.length > 0, 'empty fixture failure must expose actionable errors');
}

function run() {
  const results = [
    auditFixture(makeHumanFixture(), 'human', 'peasant'),
    auditFixture(makeHorseFixture(), 'horse', 'horse-brown'),
    auditFixture(makeWolfFixture(), 'wolf', 'wolf-grey'),
    auditFixture(makeDragonFixture(), 'dragon', 'dragon-black'),
  ];
  auditAuthoredMaterialPreservation();
  auditFailureSignals();
  console.log(JSON.stringify({ checks: 41, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
