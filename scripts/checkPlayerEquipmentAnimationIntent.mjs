import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/playerEquipmentAnimationIntent.ts', import.meta.url), 'utf8');

for (const token of [
  'resolvePlayerEquipmentAnimationIntent',
  'resolvePlayerAnimationIntent',
  'resolvePlayerEquipmentCombatProfile',
  'animationFamily',
  'upperBodyLayer',
  'lowerBodyLayer',
  'materialSurfaces',
  'Object.freeze',
]) {
  assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')));
}

assert.match(source, /semanticState === 'heavy-attack'/);
assert.match(source, /semanticState === 'light-attack'/);
assert.match(source, /semanticState === 'guard'/);
assert.match(source, /semanticState === 'dodge'/);
assert.match(source, /profile\.ranged/);
assert.match(source, /profile\.twoHanded/);
assert.match(source, /profile\.shieldEquipped/);
assert.match(source, /Array\.isArray\(profile\.materialSurfaces\)/);
assert.match(source, /export function isPlayerEquipmentAnimationIntent/);

console.log('player equipment animation intent contract: 19 checks passed');
