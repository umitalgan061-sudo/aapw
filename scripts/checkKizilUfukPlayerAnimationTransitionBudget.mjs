import assert from 'node:assert/strict';
import { createPlayerAnimationTransitionBudget } from '../src/3d/gameplay/playerAnimationTransitionBudget.js';

const run = () => {
  const budget = createPlayerAnimationTransitionBudget({ now: () => 0 });
  const first = budget.request('walking', { timestamp: 0 });
  assert.equal(first.accepted, true);
  assert.equal(first.category, 'locomotion');
  assert.equal(first.blendSeconds, 0.18);
  const hysteresis = budget.request('running', { timestamp: 20 });
  assert.equal(hysteresis.accepted, false);
  assert.equal(hysteresis.reason, 'hysteresis');
  const combat = budget.request('light', { timestamp: 100 });
  assert.equal(combat.accepted, true);
  assert.equal(combat.category, 'combat');
  assert.equal(combat.blendSeconds, 0.08);
  const blocked = budget.request('running', { timestamp: 200, interruptible: false });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'non-interruptible');
  const same = budget.request('light', { timestamp: 300 });
  assert.equal(same.accepted, false);
  assert.equal(same.reason, 'same-state');
  const snapshot = budget.snapshot();
  assert.equal(snapshot.current, 'light');
  assert.equal(Object.isFrozen(snapshot), true);
  budget.dispose();
  const disposed = budget.request('idle', { timestamp: 400 });
  assert.equal(disposed.accepted, false);
  assert.equal(disposed.reason, 'disposed');
};

run();
console.log('KIZIL_UFUK_PLAYER_ANIMATION_TRANSITION_BUDGET_PASS');
