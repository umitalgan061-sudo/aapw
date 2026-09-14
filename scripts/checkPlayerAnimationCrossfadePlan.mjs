import assert from 'node:assert/strict';
import { buildPlayerAnimationCrossfadePlan, validatePlayerAnimationCrossfadePlan } from '../src/3d/gameplay/playerAnimationCrossfadePlan.js';

const attack = buildPlayerAnimationCrossfadePlan({
  priority: 'attack-heavy',
  speedMps: 4,
  locomotion: { blend: 0.8 },
  combat: { attackHeavy: 1, guard: 0, parry: 0, dodge: 0, stagger: 0, guardBreak: 0 },
}, { fadeSeconds: 0.3, intensity: 0.8 });
assert.equal(attack.phase, 'attack');
assert.equal(attack.upperBodyLocked, true);
assert.equal(attack.rootMotion, 'caller-owned');
assert.equal(attack.dominantLayer, 'combat');
assert(validatePlayerAnimationCrossfadePlan(attack));
assert(Object.isFrozen(attack) && Object.isFrozen(attack.layers));

const stagger = buildPlayerAnimationCrossfadePlan({ priority: 'guard-break', speedMps: 'bad', combat: { guardBreak: 1 } });
assert.equal(stagger.phase, 'stagger');
assert.equal(stagger.speedMps, 0);
assert(stagger.fadeSeconds < 0.14);

const malformed = buildPlayerAnimationCrossfadePlan({ priority: 'unknown', speedMps: Infinity, combat: { attackHeavy: NaN } }, { fadeSeconds: Infinity });
assert.equal(malformed.phase, 'locomotion');
assert.equal(malformed.speedMps, 0);
assert(validatePlayerAnimationCrossfadePlan(malformed));

const reordered = buildPlayerAnimationCrossfadePlan({ combat: { guard: 0, attackHeavy: 1 }, locomotion: { blend: 0.2 }, priority: 'attack-heavy' });
const ordered = buildPlayerAnimationCrossfadePlan({ priority: 'attack-heavy', locomotion: { blend: 0.2 }, combat: { attackHeavy: 1, guard: 0 } });
assert.equal(JSON.stringify(reordered), JSON.stringify(ordered));

console.log('player animation crossfade plan: ok');
