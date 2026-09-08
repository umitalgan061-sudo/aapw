import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { PLAYER_CONFIG } from '../src/3d/gameplay/playerConfig.js';
import {
  analyzeMaterialSurfaces,
  validateMaterialAssignment,
  createMaterialManifest,
} from '../src/3d/materials/MaterialAssignmentCore.js';
import {
  PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT,
  createPlayerEquipmentCombatRuntime,
} from '../src/3d/gameplay/playerEquipmentCombatRuntime.js';
import {
  resolvePlayerEquipmentCombatProfile,
  buildPlayerEquipmentSocketPlan,
  buildPlayerMaterialAssignmentMetadata,
  resolvePlayerAttackTuning,
  resolvePlayerAnimationPlan,
} from '../src/3d/gameplay/playerEquipmentCombatProfile.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..');
const file = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const pointer = (relative) => file(relative).trim();
const assertFiniteTree = (value, label = 'value') => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert.equal(Number.isFinite(child), true, `${label}.${key} non-finite`);
    else if (child && typeof child === 'object') assertFiniteTree(child, `${label}.${key}`);
  }
};
const makeTarget = () => {
  const events = [];
  const listeners = new Map();
  return {
    events,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    addEventListener(type, handler) { const set = listeners.get(type) || new Set(); set.add(handler); listeners.set(type, set); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatchEvent(event) { events.push(event); for (const handler of listeners.get(event.type) || []) handler(event); return true; },
  };
};

assert.equal(PLAYER_CONFIG.MODEL_URL, 'assets/models/characters/peasant_girl.fbx');
assert.equal(PLAYER_CONFIG.ANIMATION_URLS.idle, 'assets/animations/peasant_girl/idle.fbx');
assert.equal(PLAYER_CONFIG.ANIMATION_URLS.walking, 'assets/animations/peasant_girl/walking.fbx');
assert.equal(PLAYER_CONFIG.ANIMATION_URLS.running, 'assets/animations/peasant_girl/running.fbx');
assert.equal(typeof PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS.x, 'number');
assert.equal(PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS, 1.5);
assert.ok(PLAYER_CONFIG.MAX_HEALTH > 0);

const playerSource = file('src/3d/gameplay/player.js');
assert.match(playerSource, /loadFBXModel\(PLAYER_CONFIG\.MODEL_URL/);
assert.match(playerSource, /AssetLoader\.correctMixamoFbxScale/);
assert.match(playerSource, /groundCollider\.getGroundHeight/);
assert.match(playerSource, /playerCollider\.resolveXZ/);
assert.match(playerSource, /aapw:player-attack-window/);
assert.match(playerSource, /aapw:player-combat-feedback/);
assert.match(playerSource, /stageDamageResolution/);
assert.match(playerSource, /PARRY_WINDOW_SECONDS/);
assert.match(playerSource, /ATTACK_COMBO_MAX_STEPS/);
assert.match(playerSource, /DODGE_IFRAME_START_SECONDS/);

for (const assetPath of [PLAYER_CONFIG.MODEL_URL, ...Object.values(PLAYER_CONFIG.ANIMATION_URLS)]) {
  const content = pointer(assetPath);
  assert.match(content, /^version https:\/\/git-lfs\.github\.com\/spec\/v1/m, `${assetPath} must remain LFS pointer`);
  assert.match(content, /oid sha256:[0-9a-f]{64}/, `${assetPath} missing valid LFS oid`);
  const sizeMatch = content.match(/size (\d+)/);
  assert.ok(sizeMatch, `${assetPath} missing LFS size`);
  assert.ok(Number(sizeMatch[1]) > 100000, `${assetPath} source asset size unexpectedly tiny`);
}

const materialCore = file('src/3d/materials/MaterialAssignmentCore.js');
const placementCore = file('src/3d/world/WorldAssetPlacementPipeline.js');
assert.match(materialCore, /export function validateMaterialAssignment/);
assert.match(materialCore, /export function createMaterialManifest/);
assert.match(placementCore, /MaterialAssignmentCore\.js/);
assert.match(placementCore, /export function prepareWorldAssetForPlacement/);
assert.doesNotMatch(playerSource, /EditorMaterialStudio\.js/);
assert.doesNotMatch(playerSource, /EditorMaterialStudio/);

const playerModel = new THREE.Group();
playerModel.name = 'PeasantGirl';
const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.36), new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }));
body.name = 'Body';
const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
head.name = 'Head';
const rightHand = new THREE.Object3D();
rightHand.name = 'RightHand';
const leftHand = new THREE.Object3D();
leftHand.name = 'LeftHand';
const chest = new THREE.Object3D();
chest.name = 'Chest';
const back = new THREE.Object3D();
back.name = 'Back';
playerModel.add(body, head, rightHand, leftHand, chest, back);

const surfaceAnalysis = analyzeMaterialSurfaces(playerModel);
assert.equal(surfaceAnalysis.meshCount, 2);
assert.equal(surfaceAnalysis.placeholder, false);
assert.ok(surfaceAnalysis.surfaceCount >= 2);
const validationBefore = validateMaterialAssignment(playerModel);
assert.equal(validationBefore.ok, true);
assert.ok(validationBefore.meshCount === 2);
const materialManifest = createMaterialManifest(playerModel, { metadata: { id: 'player-peasant-girl', category: 'character', src: PLAYER_CONFIG.MODEL_URL } });
assert.equal(materialManifest.asset.src, PLAYER_CONFIG.MODEL_URL);
assert.equal(materialManifest.validation.ok, true);
assert.ok(Array.isArray(materialManifest.surfaces));

const equipment = resolvePlayerEquipmentCombatProfile({
  mainHand: { id: 'arming-sword', name: 'Starter Sword' },
  offHand: { id: 'buckler', name: 'Starter Buckler' },
  chest: { id: 'leather', name: 'Ranger Leather' },
  head: { id: 'cloth', name: 'Hood' },
  back: { id: 'bow', name: 'Training Bow' },
});
assert.equal(equipment.mainHand.id, 'arming-sword');
assert.equal(equipment.offHand.id, 'buckler');
assert.equal(equipment.shieldEquipped, true);
assert.equal(equipment.armor.id, 'leather');
assert.equal(equipment.twoHanded, false);
assert.equal(equipment.ranged, false);
assertFiniteTree(equipment);

const socketPlan = buildPlayerEquipmentSocketPlan(playerModel, equipment);
assert.equal(socketPlan.bindings.mainHand.socket, 'RightHand');
assert.equal(socketPlan.bindings.offHand.socket, 'LeftHand');
assert.equal(socketPlan.bindings.chest.socket, 'Chest');
assert.equal(socketPlan.bindings.head.socket, 'Head');
assert.equal(socketPlan.bindings.back.socket, 'Back');

const materialMetadata = buildPlayerMaterialAssignmentMetadata({ object: playerModel, profile: equipment });
assert.equal(materialMetadata.materialContract, 'MaterialAssignmentCore');
assert.equal(materialMetadata.placementContract, 'WorldAssetPlacementPipeline');
assert.equal(materialMetadata.importedMaterialsPreferred, true);
assert.equal(materialMetadata.layeredFallbackAllowed, true);
assert.equal(materialMetadata.editorUiImportForbidden, true);
assert.equal(materialMetadata.src, PLAYER_CONFIG.MODEL_URL);
assertFiniteTree(materialMetadata);

const target = makeTarget();
const player = {
  object3D: playerModel,
  getMotionState() {
    return {
      state: 'idle', stamina: 100, staminaRatio: 1, poise: 100, poiseRatio: 1,
      isGrounded: true, speedMps: 0, attackKind: 'none', attackActive: false,
      attackComboStep: 0, defenseResult: 'none', guarding: false,
    };
  },
};
let providerState = {
  mainHand: { id: 'longsword' },
  offHand: { id: 'shield' },
  chest: { id: 'chain' },
};
const runtime = createPlayerEquipmentCombatRuntime({
  player,
  target,
  equipmentProvider: () => providerState,
  now: () => 100,
  onFrame(frame) { assertFiniteTree(frame); },
});

let frame = runtime.read();
assert.equal(frame.equipment.mainHandId, 'longsword');
assert.equal(frame.equipment.offHandId, 'shield');
assert.equal(frame.equipment.chestId, 'chain');
assert.ok(frame.audit.ok);
assert.ok(frame.material.src.endsWith('peasant_girl.fbx'));

const sequence = [
  { type: 'motion', detail: { state: 'move', speedMps: 2.2, staminaRatio: 0.92, poiseRatio: 1, isGrounded: true, guarding: false } },
  { type: 'attack', detail: { kind: 'light', phase: 'start', active: false, comboStep: 1, serial: 1 } },
  { type: 'attack', detail: { kind: 'light', phase: 'active', active: true, comboStep: 1, serial: 1 } },
  { type: 'feedback', detail: { outcome: 'hit', serial: 1, rawAmount: 12, appliedAmount: 12, blockedAmount: 0 } },
  { type: 'attack', detail: { kind: 'light', phase: 'finish', active: false, comboStep: 1, serial: 1 } },
  { type: 'attack', detail: { kind: 'heavy', phase: 'start', active: false, comboStep: 2, serial: 2 } },
  { type: 'attack', detail: { kind: 'heavy', phase: 'active', active: true, comboStep: 2, serial: 2 } },
  { type: 'feedback', detail: { outcome: 'blocked', serial: 2, rawAmount: 24, appliedAmount: 8.64, blockedAmount: 15.36 } },
  { type: 'motion', detail: { state: 'dodge', speedMps: 10.5, staminaRatio: 0.55, poiseRatio: 0.92, isGrounded: true, guarding: false } },
  { type: 'feedback', detail: { outcome: 'dodge', serial: 3, rawAmount: 20, appliedAmount: 0, blockedAmount: 20 } },
  { type: 'motion', detail: { state: 'hit-stagger', speedMps: 0, staminaRatio: 0.4, poiseRatio: 0.1, isGrounded: true, guarding: false, defenseResult: 'hit-stagger' } },
];
for (const event of sequence) {
  if (event.type === 'motion') target.dispatchEvent(new target.CustomEvent('aapw:player-motion', { detail: event.detail }));
  else if (event.type === 'attack') target.dispatchEvent(new target.CustomEvent('aapw:player-attack-window', { detail: event.detail }));
  else target.dispatchEvent(new target.CustomEvent('aapw:player-combat-feedback', { detail: event.detail }));
  frame = runtime.read();
  assertFiniteTree(frame);
  assert.ok(frame.audit.ok);
}
assert.ok(target.events.some((event) => event.type === PLAYER_EQUIPMENT_COMBAT_FRAME_EVENT));
assert.ok(runtime.readHistory().length >= 5);

providerState = {
  mainHand: { id: 'bow' },
  chest: { id: 'ranger' },
};
frame = runtime.refreshEquipment(250);
assert.equal(frame.equipment.mainHandId, 'bow');
assert.equal(frame.equipment.chestId, 'ranger');
assert.equal(frame.attack.ranged, true);
assert.equal(frame.equipment.twoHanded, true);
assert.equal(frame.animation.family, 'archery');
assert.ok(frame.revision >= 1);

const tuningMatrix = [
  ['light', 'unarmed'], ['light', 'dagger'], ['light', 'arming-sword'], ['light', 'longsword'], ['light', 'greatsword'],
  ['light', 'spear'], ['light', 'battle-axe'], ['light', 'mace'], ['light', 'staff'], ['light', 'bow'], ['light', 'crossbow'],
  ['light', 'shield'], ['light', 'buckler'], ['heavy', 'unarmed'], ['heavy', 'dagger'], ['heavy', 'arming-sword'],
  ['heavy', 'longsword'], ['heavy', 'greatsword'], ['heavy', 'spear'], ['heavy', 'battle-axe'], ['heavy', 'mace'], ['heavy', 'staff'],
  ['heavy', 'bow'], ['heavy', 'crossbow'], ['heavy', 'shield'], ['heavy', 'buckler'],
];
const heavyBase = { staminaCost: 24, duration: 0.72, activeStart: 0.28, activeEnd: 0.46, reach: 2.05, damageScale: 1.65, commitMeters: 0.9 };
const lightBase = { staminaCost: 12, duration: 0.44, activeStart: 0.14, activeEnd: 0.26, reach: 1.65, damageScale: 1, commitMeters: 0.58 };
for (const [kind, weaponId] of tuningMatrix) {
  const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: weaponId } });
  const tuning = resolvePlayerAttackTuning(kind === 'heavy' ? heavyBase : lightBase, profile, kind);
  assert.ok(tuning.activeStart < tuning.activeEnd);
  assert.ok(tuning.activeEnd <= tuning.duration);
  assert.ok(tuning.cost >= 2 && tuning.cost <= 80);
  assert.ok(tuning.reach >= 0.35 && tuning.reach <= 12);
  assert.ok(tuning.damageScale >= 0.1 && tuning.damageScale <= 6);
  assertFiniteTree(tuning, `${kind}:${weaponId}`);
}

const animationStates = ['idle', 'move', 'guard', 'parry', 'dodge', 'hit-stagger', 'guard-break'];
const animationProfiles = ['unarmed', 'dagger', 'arming-sword', 'longsword', 'greatsword', 'spear', 'axe', 'mace', 'staff', 'archery', 'crossbow', 'shield-bash', 'buckler'];
for (const family of animationProfiles) {
  const profile = resolvePlayerEquipmentCombatProfile({ mainHand: { id: family === 'arming-sword' ? 'arming-sword' : family === 'axe' ? 'battle-axe' : family === 'shield-bash' ? 'shield' : family } });
  for (const state of animationStates) {
    const plan = resolvePlayerAnimationPlan(profile, { movementState: state, attackKind: 'none', speedMps: state === 'move' ? 4 : 0, grounded: state !== 'dodge' || true });
    assert.ok(typeof plan.action === 'string');
    assert.ok(plan.weight >= 0 && plan.weight <= 1);
    assert.ok(plan.timeScale > 0);
  }
}

runtime.dispose();
const historyBeforeDispose = runtime.readHistory();
assert.ok(Array.isArray(historyBeforeDispose));
assert.equal(runtime.readHistory().length, historyBeforeDispose.length);

console.log('[checkPlayerEquipmentCombatSceneContract] PASS shipped player asset contract, LFS source metadata, shared material boundary, socket resolution, live combat event composition, equipment revision and exhaustive tuning matrix');
