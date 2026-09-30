#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const strictOwners = [
  'src/3d/gameplay/player.ts',
  'src/3d/gameplay/health.ts',
  'src/3d/gameplay/playerEquipmentCombatProfile.ts',
  'src/3d/gameplay/playerEquipmentCombatRules.ts',
  'src/3d/gameplay/playerEquipmentCombatRuntime.ts',
  'src/3d/gameplay/playerAnimationDirector.ts',
  'src/3d/gameplay/playerAnimationAssetCatalog.ts',
];
for (const file of strictOwners) {
  const source = read(file);
  assert.doesNotMatch(source, /@ts-nocheck/, `${file} must stay strict`);
  assert.match(source, /Production TypeScript owner/, `${file} missing ownership marker`);
}

for (const file of [
  'src/3d/gameplay/playerAnimationDirector.legacy.js',
  'src/3d/gameplay/playerAnimationAssetCatalog.legacy.js',
]) {
  const source = read(file);
  assert.match(source, /compatibility boundary/i, `${file} must remain a compatibility boundary`);
  assert.match(source, /\.\/.*\.ts/, `${file} must delegate to TypeScript`);
}

const game3d = read('src/3d/game3d.ts');
assert.match(game3d, /createPlayerEquipmentCombatRuntime/);
assert.match(game3d, /playerEquipmentCombatRuntime\?\.update\(delta\)/);
assert.match(game3d, /playerEquipmentCombatRuntime\?\.dispose\(\)/);

console.log('[checkPlayerStrictOwnershipR1] PASS: Player/Health/Equipment/Animation production owners are strict TypeScript and legacy files are bridges');
