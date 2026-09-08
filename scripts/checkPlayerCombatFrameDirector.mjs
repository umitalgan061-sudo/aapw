import assert from 'node:assert/strict';
import { createPlayerCombatFrameDirector } from '../src/3d/gameplay/playerCombatFrameDirector.js';

const calls = [];
const director = createPlayerCombatFrameDirector({
  readInput: ({ frame }) => ({ action: frame === 1 ? 'lightAttack' : 'block', strength: 2, sequence: frame }),
  resolveTarget: ({ intent }) => intent.action === 'lightAttack' ? { id: 'wolf-1', distance: 2.5 } : null,
  resolveAnimation: ({ intent }) => ({ action: intent.action === 'lightAttack' ? 'light' : 'guard', attackWeight: intent.action === 'lightAttack' ? 1 : 0 }),
  resolveEquipment: ({ target }) => ({ socket: 'mainHand', targetId: target?.id ?? null }),
  applyResources: ({ intent }) => ({ stamina: intent.action === 'lightAttack' ? -12 : 0 }),
  resolveHit: ({ intent, target }) => intent.action === 'lightAttack' && target ? { outcome: 'hit', targetId: target.id, damage: 12, timestamp: 1 } : null,
});

const first = director.step({ source: 'keyboard' });
assert.equal(first.intent.accepted, true);
assert.equal(first.intent.strength, 1);
assert.equal(first.target.id, 'wolf-1');
assert.equal(first.animation.action, 'light');
assert.equal(first.outcome.outcome, 'hit');
assert.equal(first.outcome.damage, 12);

const second = director.step({ source: 'gamepad' });
assert.equal(second.intent.action, 'block');
assert.equal(second.outcome, null);
assert.equal(second.equipment.targetId, null);

const snapshotA = director.snapshot();
const snapshotB = director.snapshot();
assert.deepEqual(snapshotA, snapshotB);
assert.equal(snapshotA.intentCount, 2);
assert.equal(snapshotA.outcomeCount, 1);

director.reset();
assert.equal(director.snapshot().intentCount, 0);
assert.equal(director.snapshot().outcomeCount, 0);

director.dispose();
const disposed = director.step({});
assert.equal(disposed.disposed, true);
assert.equal(disposed.frame, 0);

calls.push('ok');
assert.deepEqual(calls, ['ok']);
console.log('PLAYER_COMBAT_FRAME_DIRECTOR_OK');
