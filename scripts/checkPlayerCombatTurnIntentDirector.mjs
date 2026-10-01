import assert from 'node:assert/strict';
import { projectCombatTurnIntent, serializeCombatTurnIntent } from '../src/3d/gameplay/playerCombatTurnIntentDirector.js';

const a = projectCombatTurnIntent({ lockedOn: true, targetId: 'wolf-1', targetYaw: 1, playerYaw: 0, action: 'heavy' });
const b = projectCombatTurnIntent({ lockedOn: true, targetId: 'wolf-1', targetYaw: 1, playerYaw: 0, action: 'heavy' });
assert.deepEqual(a, b);
assert.equal(a.mode, 'lock-on');
assert.equal(a.committed, true);
assert.ok(Math.abs(a.signedTurnRadians) <= 0.22);
assert.equal(Object.isFrozen(a), true);
assert.equal(serializeCombatTurnIntent(a), serializeCombatTurnIntent(b));

const deadZone = projectCombatTurnIntent({ lockedOn: true, targetYaw: 0.01, playerYaw: 0, deadZoneRadians: 0.025 });
assert.equal(deadZone.withinDeadZone, true);
assert.equal(deadZone.signedTurnRadians, 0);

const free = projectCombatTurnIntent({ manualTurn: -4, action: 'invalid' });
assert.equal(free.mode, 'free');
assert.equal(free.signedTurnRadians, -0.22);
assert.equal(free.committed, false);

const malformed = projectCombatTurnIntent({ targetYaw: 'nan', playerYaw: Infinity, maxTurnRadians: 'bad' });
assert.equal(Number.isFinite(malformed.signedTurnRadians), true);
assert.equal(Number.isFinite(malformed.facingErrorRadians), true);
console.log('player combat turn intent contract: PASS');
