#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

const input = await read('src/3d/input.ts');
const inputShim = await read('src/3d/input.js');
const touch = await read('src/3d/ui/touchJoystick.ts');
const touchShim = await read('src/3d/ui/touchJoystick.js');
const game3d = await read('src/3d/game3d.ts');

assert.doesNotMatch(input, /@ts-nocheck/);
assert.doesNotMatch(touch, /@ts-nocheck/);
assert.match(input, /PLAYER_INPUT_CONTRACT_VERSION/);
assert.match(input, /class PlayerInputActionBuffer/);
assert.match(input, /class PlayerInputRecorder/);
assert.match(input, /normalizePlayerInputBindings/);
assert.match(input, /readPlayerInputDeviceSnapshot/);
assert.match(inputShim, /playerInput.tsx|input.ts/);
assert.match(touch, /PlayerInputActionBuffer/);
assert.match(touch, /getInputFrame()/);
assert.match(touch, /_queueAction('dodge')/);
assert.match(touch, /_queueAction('parry')/);
assert.match(touch, /consumeActionBuffer/);
assert.match(touchShim, /touchJoystick.ts/);
assert.match(game3d, /new KeyboardInput(window)/);
assert.match(game3d, /new TouchJoystick()/);
assert.match(game3d, /keyboardInput.getAxes()/);
assert.match(game3d, /touchJoystick?.getAxes()/);

const assetCandidates = [
  'assets/models/characters/peasant_girl.fbx',
  'assets/animations/peasant_girl/idle.fbx',
  'assets/animations/peasant_girl/walking.fbx',
  'assets/animations/peasant_girl/running.fbx',
];
for (const relative of assetCandidates) {
  const info = await stat(new URL(relative, root));
  assert.ok(info.size > 128, `asset too small: ${relative}`);
}

console.log(JSON.stringify({
  ok: true,
  version: input.match(/PLAYER_INPUT_CONTRACT_VERSION = '([^']+)'/)?.[1] ?? 'unknown',
  strictInputOwner: true,
  strictTouchOwner: true,
  actionBuffer: true,
  recorder: true,
  remapBindings: true,
  deviceSnapshot: true,
  touchDodgeParryParity: true,
  shippedPlayerAssets: assetCandidates.length,
}));
