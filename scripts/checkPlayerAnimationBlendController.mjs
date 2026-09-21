import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/playerAnimationBlendController.ts', import.meta.url), 'utf8');
const director = await readFile(new URL('../src/3d/gameplay/playerAnimationDirector.ts', import.meta.url), 'utf8');

assert.match(source, /resolvePlayerAnimationPresentation/);
assert.match(source, /resolvePlayerAnimationTransition/);
assert.match(source, /createPlayerAnimationBlendController/);
assert.match(source, /previousSemanticState/);
assert.match(source, /footPlantWeight/);
assert.match(source, /stepConfidence/);
assert.match(source, /environmentValid/);
assert.match(director, /export \* from '\.\/playerAnimationDirector\.legacy\.js'/);

const requiredStates = ['idle', 'locomotion', 'sprint', 'guard', 'dodge', 'light-attack', 'heavy-attack', 'hit-stagger'];
for (const state of requiredStates) assert.match(source, new RegExp(`'${state}'`));

console.log('PASS player animation blend controller contract');
