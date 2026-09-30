import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tsSource = await readFile(new URL('../src/3d/gameplay/playerAnimationDirector.ts', import.meta.url), 'utf8');
const legacyShim = await readFile(new URL('../src/3d/gameplay/playerAnimationDirector.legacy.js', import.meta.url), 'utf8');
const jsEntry = await readFile(new URL('../src/3d/gameplay/playerAnimationDirector.js', import.meta.url), 'utf8');

for (const fragment of [
  'export function resolvePlayerAnimationIntent',
  'export function createPlayerAnimationDirector',
  'export function resolvePlayerAnimationPresentation',
  'export function resolvePlayerAnimationTransition',
]) {
  assert.match(tsSource, new RegExp(fragment.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')));
}

assert.match(legacyShim, /TypeScript ownership compatibility boundary\./);
assert.match(legacyShim, /from ['"]\.\/playerAnimationDirector\.ts['"]/);
assert.match(jsEntry, /TypeScript ownership compatibility boundary\./);
assert.match(jsEntry, /from ['"]\.\/playerAnimationDirector\.ts['"]/);

console.log('[checkPlayerAnimationDirector] PASS TypeScript owner exports semantic animation director and both legacy entrypoints are compatibility-only');
