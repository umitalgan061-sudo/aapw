import assert from 'node:assert/strict';

const source = await import('../src/3d/gameplay/playerAnimationBlendController.ts');
const { resolvePlayerAnimationBlendFrame, createPlayerAnimationBlendController } = source;

const idle = resolvePlayerAnimationBlendFrame({ planarSpeedMps: 0, previousSemanticState: 'idle' });
assert.equal(idle.transitionState, 'idle');
assert.equal(idle.semanticState, 'idle');
assert.ok(idle.action);
assert.ok(idle.footPlantWeight >= 0 && idle.footPlantWeight <= 1);

const sprint = resolvePlayerAnimationBlendFrame({ planarSpeedMps: 6.2, previousSemanticState: 'locomotion', runIntent: true });
assert.equal(sprint.transitionState, 'sprint');
assert.equal(sprint.semanticState, 'sprint');
assert.ok(sprint.timeScale >= 0.9 && sprint.timeScale <= 1.35);

const hysteresis = resolvePlayerAnimationBlendFrame({ planarSpeedMps: 5.2, previousSemanticState: 'sprint', runIntent: false });
assert.equal(hysteresis.transitionState, 'sprint');

const attack = resolvePlayerAnimationBlendFrame({ planarSpeedMps: 2, attackKind: 'heavy', previousSemanticState: 'locomotion' });
assert.equal(attack.transitionState, 'heavy-attack');
assert.equal(attack.semanticState, 'heavy-attack');

const controller = createPlayerAnimationBlendController();
const first = controller.update({ planarSpeedMps: 6.1, runIntent: true });
assert.equal(first.transitionState, 'sprint');
assert.equal(controller.semanticState, 'sprint');
controller.reset();
assert.equal(controller.semanticState, 'idle');

console.log('PASS player animation blend controller contract');
