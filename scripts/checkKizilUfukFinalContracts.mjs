import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8'));

const player = await read('src/3d/gameplay/player.ts');
const profile = await read('src/3d/gameplay/playerEquipmentCombatProfile.ts');
const rules = await read('src/3d/gameplay/playerEquipmentCombatRules.ts');
const runtime = await read('src/3d/gameplay/playerEquipmentCombatRuntime.ts');
const animation = await read('src/3d/gameplay/playerAnimationDirector.ts');
const animationBridge = await read('src/3d/gameplay/playerAnimationDirector.legacy.js');
const game3d = await read('src/3d/game3d.ts');

for (const [name, source] of Object.entries({ player, profile, rules, runtime, animation })) {
  assert.doesNotMatch(source, /@ts-nocheck/);
  assert.doesNotMatch(source, /EditorMaterialStudio/);
}
assert.match(player, /normalizePlayerMovementInput/);
assert.match(profile, /PlayerResolvedEquipmentProfile/);
assert.match(rules, /PlayerAttackTuning/);
assert.match(runtime, /equipmentFingerprint/);
assert.match(animation, /createPlayerAnimationDirector/);
assert.match(animationBridge, /playerAnimationDirector\.ts/);
assert.match(game3d, /createPlayerEquipmentCombatRuntime/);
assert.match(game3d, /playerEquipmentCombatRuntime\?\.update\(delta\)/);
assert.match(game3d, /playerEquipmentCombatRuntime\?\.dispose\(\)/);

console.log('[Kızıl Ufuk] PASS strict owner, compatibility bridge, scene lifecycle and shared-material boundary contracts');
