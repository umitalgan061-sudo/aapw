import assert from 'node:assert/strict';
import { buildPlayerComboChainDirector, serializePlayerComboChainDirector } from '../src/3d/gameplay/playerComboChainDirector.js';

const links = [
  { from: 'light', to: 'light', windowMs: 500 },
  { from: 'light', to: 'heavy', windowMs: 700 },
  { from: 'heavy', to: 'light', windowMs: 600 },
];

const accepted = buildPlayerComboChainDirector({
  chainId: 'blade-01', phase: 'recovery', currentAction: 'light', requestedAction: 'heavy', elapsedMs: 420, queueWindowMs: 450, links,
});
assert.equal(accepted.canQueue, true);
assert.equal(accepted.queuedAction, 'heavy');
assert.equal(accepted.nextPhase, 'windup');

const expired = buildPlayerComboChainDirector({
  phase: 'recovery', currentAction: 'light', requestedAction: 'heavy', elapsedMs: 900, links,
});
assert.equal(expired.rejection, 'window-expired');

const wrongPhase = buildPlayerComboChainDirector({
  phase: 'active', currentAction: 'light', requestedAction: 'heavy', elapsedMs: 100, links,
});
assert.equal(wrongPhase.rejection, 'outside-recovery');

const malformed = buildPlayerComboChainDirector({ phase: 'recovery', currentAction: '??', requestedAction: 'heavy', elapsedMs: Infinity, links: [{ from: 'light', to: 'heavy', windowMs: NaN }] });
assert.equal(malformed.phase, 'recovery');
assert.equal(malformed.elapsedMs, 0);
assert.equal(malformed.currentAction, null);
assert.equal(malformed.links[0].windowMs, 450);

assert.equal(serializePlayerComboChainDirector(accepted), JSON.stringify(accepted));
assert(Object.isFrozen(accepted));
assert(Object.isFrozen(accepted.links));
console.log('player combo chain director: PASS');
