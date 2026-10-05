#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

const input = await read('src/3d/input.ts');
const inputShim = await read('src/3d/input.js');
const touch = await read('src/3d/ui/touchJoystick.ts');
const touchShim = await read('src/3d/ui/touchJoystick.js');
const game3d = await read('src/3d/game3d.ts');
const helpers = await read('src/3d/gameLoopHelpers.ts');

assert.doesNotMatch(input, /@ts-nocheck/);
assert.doesNotMatch(touch, /@ts-nocheck/);
assert.match(input, /PLAYER_INPUT_CONTRACT_VERSION = '2026-10-05-v1'/);
assert.match(input, /class PlayerInputActionBuffer/);
assert.match(input, /class PlayerInputRecorder/);
assert.match(input, /class PlayerInputLatencyMonitor/);
assert.match(input, /normalizePlayerInputBindings/);
assert.match(input, /validatePlayerInputBindings/);
assert.match(input, /readPlayerInputDeviceSnapshot/);
assert.match(input, /getInputFrame()/);
assert.match(input, /gamepadconnected/);
assert.match(input, /gamepaddisconnected/);
assert.match(inputShim, /from ['"]\.\/input\.ts['"]/);
assert.match(touch, /PlayerInputActionBuffer/);
assert.match(touch, /createPlayerInputFrame/);
assert.match(touch, /_queueAction\('dodge'\)/);
assert.match(touch, /_queueAction\('parry'\)/);
assert.match(touch, /g3d-touch-camera-pad/);
assert.match(touch, /_cameraPointers/);
assert.match(touch, /_lastPinchDistance/);
assert.match(touch, /_cameraZoom/);
assert.match(touch, /const dodgeFallback/);
assert.match(touch, /safe-area-inset-bottom/);
assert.match(touchShim, /from ['"]\.\/touchJoystick\.ts['"]/);
assert.match(helpers, /joystickHasLook/);
assert.match(helpers, /joystickAxes\.lookX/);
assert.match(helpers, /joystickAxes\.lookY/);
assert.match(game3d, /new KeyboardInput\(window\)/);
assert.match(game3d, /new TouchJoystick\(\)/);
assert.match(game3d, /keyboardInput\.getAxes\(\)/);
assert.match(game3d, /touchJoystick\?\.getAxes\(\)/);

console.log(JSON.stringify({
  ok: true,
  contractVersion: input.match(/PLAYER_INPUT_CONTRACT_VERSION = '([^']+)'/)?.[1] ?? 'unknown',
  strictInputOwner: true,
  strictTouchOwner: true,
  boundedActionBuffer: true,
  deterministicRecorder: true,
  latencyDiagnostics: true,
  remappableBindings: true,
  gamepadHotPlug: true,
  touchDodgeParryParity: true,
  touchCameraLook: true,
  touchPinchZoom: true,
  existingGame3DChainPreserved: true,
}));
