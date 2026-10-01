import assert from 'node:assert/strict';
import { resolvePlayerDodgeRoll, serializePlayerDodgeRoll } from '../src/3d/gameplay/playerDodgeRollDirector.js';

const accepted = resolvePlayerDodgeRoll({ action: 'roll', mode: 'incoming', grounded: true, stamina: 80, staminaCost: 25, directionX: 3, directionZ: 4 });
assert.equal(accepted.accepted, true);
assert.equal(accepted.outcome, 'accepted');
assert.equal(accepted.staminaAfter, 55);
assert.equal(Math.hypot(accepted.direction.x, accepted.direction.z), 1);
assert.equal(accepted.interruptsAttack, true);
assert.ok(Object.isFrozen(accepted));
assert.ok(Object.isFrozen(accepted.direction));

const buffered = resolvePlayerDodgeRoll({ mode: 'recovery', grounded: true, stamina: 90, buffered: true });
assert.equal(buffered.accepted, false);
assert.equal(buffered.buffered, true);
assert.equal(buffered.reason, 'recovery');

const rejected = resolvePlayerDodgeRoll({ mode: 'neutral', grounded: true, stamina: 5, staminaCost: 20 });
assert.equal(rejected.accepted, false);
assert.equal(rejected.reason, 'insufficient-stamina');

const airborne = resolvePlayerDodgeRoll({ grounded: false, stamina: 100, action: 'invalid' });
assert.equal(airborne.action, 'dodge');
assert.equal(airborne.reason, 'not-grounded');

const malformed = resolvePlayerDodgeRoll({ stamina: 'bad', staminaCost: Infinity, invulnerabilityMs: NaN, directionX: 'bad' });
assert.equal(malformed.staminaBefore, 0);
assert.equal(malformed.staminaCost, 0);
assert.equal(malformed.accepted, false);

assert.equal(serializePlayerDodgeRoll({ stamina: 80, directionX: 1, directionZ: 0 }), serializePlayerDodgeRoll({ stamina: 80, directionX: 1, directionZ: 0 }));
console.log('playerDodgeRollDirector: PASS');
