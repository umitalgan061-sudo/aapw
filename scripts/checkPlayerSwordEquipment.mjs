import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const equipment = await readFile(new URL('../src/3d/gameplay/playerEquipment.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/3d/gameplay/player.js', import.meta.url), 'utf8');
const materialCore = await readFile(new URL('../src/3d/materials/MaterialAssignmentCore.js', import.meta.url), 'utf8');

for (const fragment of [
  "modelUrl: 'assets/models/props/sword_narsil_style.fbx'",
  "textureUrl: 'assets/models/props/sword_narsil_style_texture.png'",
  'findRightHandSocket',
  "normalized.includes('righthand')",
  'validateMaterialAssignment(sword)',
  'createMaterialManifest(sword',
  "placement: { mode: 'skeleton-socket', socket: hand.name }",
  'normalizeSwordScale',
  'targetLengthMeters: 1.08',
  'texture.colorSpace = THREE.SRGBColorSpace',
]) assert.ok(equipment.includes(fragment), `missing equipment contract: ${fragment}`);

assert.ok(player.includes("import { equipPlayerSword } from './playerEquipment.js'"));
assert.ok(player.includes('await equipPlayerSword({ assetLoader, playerRoot: model })'));
assert.ok(player.includes('equippedWeapon: model.userData.playerEquipment?.assetId ?? null'));
assert.ok(player.includes('swordEquipment.dispose()'));
assert.ok(materialCore.includes('export function validateMaterialAssignment'));
assert.ok(materialCore.includes('export function createMaterialManifest'));
assert.ok(!equipment.includes('EditorMaterialStudio'));
assert.ok(!equipment.includes('BoxGeometry'));
assert.ok(!equipment.includes('CapsuleGeometry'));

console.log(JSON.stringify({
  ok: true,
  contract: 'player-sword-equipment-socket',
  model: 'sword_narsil_style.fbx',
  texture: 'sword_narsil_style_texture.png',
  targetLengthMeters: 1.08,
  materialCore: 'MaterialAssignmentCore',
  placement: 'Mixamo right-hand skeleton socket',
}, null, 2));
