import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/playerAnimationDirector.js', import.meta.url), 'utf8');

assert.match(source, /export function resolvePlayerAnimationIntent/);
assert.match(source, /export function createPlayerAnimationDirector/);
assert.match(source, /export function resolvePlayerAnimationPresentation/);
assert.match(source, /availableActions/);
assert.match(source, /guard/);
assert.match(source, /light-attack/);
assert.match(source, /heavy-attack/);
assert.match(source, /hit-stagger/);
assert.match(source, /dodgeRemaining/);
assert.match(source, /finite|Number\.isFinite/);

const exportedSymbols = [...source.matchAll(/export function ([A-Za-z0-9_]+)/g)].map((match) => match[1]);
assert.deepEqual(exportedSymbols.slice(0, 3), [
  'resolvePlayerAnimationIntent',
  'resolvePlayerAnimationPresentation',
  'createPlayerAnimationDirector',
]);

console.log('PLAYER_ANIMATION_DIRECTOR_CONTRACT_OK');
