import assert from 'node:assert/strict';
import { createPlayerCombatFrameBridge } from '../src/3d/gameplay/playerCombatFrameBridge.js';

const calls = [];
const bridge = createPlayerCombatFrameBridge({
  resolveTarget: ({ intent }) => intent.targetId ? { id: intent.targetId } : null,
  resolveAnimation: ({ intent }) => ({ action: intent.action || 'idle', locomotionWeight: intent.action ? 0.25 : 1, attackWeight: intent.action === 'lightAttack' ? 1 : 0, reactionWeight: 0 }),
  applyResources: ({ intent }) => ({ accepted: intent.action !== 'heavyAttack', staminaCost: intent.action === 'lightAttack' ? 12 : 0 }),
  resolveHit: ({ intent }) => intent.action === 'lightAttack' ? { outcome: 'hit', targetId: intent.targetId, damage: 7 } : null,
});

bridge.ingestKeyboard('Mouse0', true, 10);
bridge.setMove(2, 0);
const first = bridge.step({ targetId: 'dummy', strength: 0.8 });
assert.equal(first.intent.action, 'lightAttack');
assert.equal(first.intent.source, 'keyboard');
assert.equal(first.outcome.outcome, 'hit');
assert.deepEqual(first.input.move, { x: 1, y: 0 });

bridge.ingestGamepad({ buttons: [0, 0, 1, 0, 0] }, 20);
const second = bridge.step();
assert.equal(second.intent.action, 'dodge');
assert.equal(second.intent.source, 'gamepad');
assert.equal(second.outcome, null);

bridge.ingestTouch('heavy', true, 30);
const third = bridge.step();
assert.equal(third.intent.action, 'heavyAttack');
assert.equal(third.resources.accepted, false);

const stable = JSON.stringify(bridge.snapshot());
assert.equal(stable, JSON.stringify(bridge.snapshot()));
bridge.dispose();
const disposed = bridge.step();
assert.equal(disposed.disposed, true);
assert.equal(disposed.intent.accepted, false);

calls.push('ok');
console.log('PLAYER_COMBAT_FRAME_BRIDGE_OK');
