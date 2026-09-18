#!/usr/bin/env node
import assert from 'node:assert/strict';
import { PLAYER_CONFIG, playerAnimationUrl, playerSpawnMapPosition, validatePlayerConfig } from '../src/3d/gameplay/playerConfig.ts';
import { readFile } from 'node:fs/promises';

validatePlayerConfig();
assert.equal(Object.isFrozen(PLAYER_CONFIG), true);
assert.equal(Object.isFrozen(PLAYER_CONFIG.ANIMATION_URLS), true);
assert.equal(Object.isFrozen(PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS), true);
assert.match(PLAYER_CONFIG.MODEL_URL, /^assets\/models\/characters\/.+\.fbx$/);
assert.deepEqual(Object.keys(PLAYER_CONFIG.ANIMATION_URLS).sort(), ['idle', 'running', 'walking']);
assert.match(playerAnimationUrl('idle'), /^assets\/animations\/peasant_girl\/.+\.fbx$/);
assert.deepEqual(playerSpawnMapPosition(), { x: 3885, y: 5404 });

const typedSource = await readFile(new URL('../src/3d/gameplay/playerConfig.ts', import.meta.url), 'utf8');
const legacySource = await readFile(new URL('../src/3d/gameplay/playerConfig.js', import.meta.url), 'utf8');
assert.equal(/Math\.random\s*\(/.test(typedSource), false);
assert.equal(/EditorMaterialStudio\.js/.test(typedSource), false);
assert.match(legacySource, /from '\.\/playerConfig\.ts';/);

console.log(JSON.stringify({
  ok: true,
  model: PLAYER_CONFIG.MODEL_URL,
  animations: Object.keys(PLAYER_CONFIG.ANIMATION_URLS),
  spawn: playerSpawnMapPosition(),
  cameraDistance: [PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS, PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS],
}, null, 2));
