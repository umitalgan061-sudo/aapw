import assert from 'node:assert/strict';
import { createPlayerFrameOrchestrator } from '../src/3d/gameplay/playerFrameOrchestrator.js';

const make = () => createPlayerFrameOrchestrator({
  readInput: ({ input }) => ({ action: input.action ?? 'idle', device: input.device ?? 'keyboard' }),
  resolveMovement: ({ input }) => ({ grounded: input.grounded !== false, speed: Math.min(1, Math.max(0, Number(input.speed ?? 0))) }),
  resolveCombat: ({ intent, input }) => ({ action: intent.action, outcome: input.outcome ?? 'miss', targetId: input.targetId ?? null }),
  resolveAnimation: ({ movement, combat }) => ({ locomotion: movement.speed > 0.5 ? 'run' : 'idle', combat: combat.action }),
  resolveEquipment: ({ input }) => ({ weapon: input.weapon ?? 'unarmed', armor: input.armor ?? 'unarmored' }),
  resolvePresentation: ({ combat }) => ({ feedback: combat.outcome === 'miss' ? 'none' : 'impact' }),
});

const run = () => {
  const director = make();
  const first = director.step({ action: 'lightAttack', speed: 0.7, weapon: 'arming-sword', outcome: 'hit', targetId: 'wolf-1' });
  const second = director.step({ action: 'dodge', speed: 0.1, outcome: 'dodged', targetId: 'wolf-1' });
  assert.equal(first.stages.animation.locomotion, 'run');
  assert.equal(second.stages.presentation.feedback, 'impact');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.stages), true);
  const digest = director.replayDigest();
  const replay = make();
  replay.step({ action: 'lightAttack', speed: 0.7, weapon: 'arming-sword', outcome: 'hit', targetId: 'wolf-1' });
  replay.step({ action: 'dodge', speed: 0.1, outcome: 'dodged', targetId: 'wolf-1' });
  assert.equal(replay.replayDigest(), digest);
  director.dispose();
  assert.deepEqual(director.step({ action: 'heavyAttack' }), { disposed: true, frame: 0, sequence: 0, stages: {} });
  console.log(JSON.stringify({ ok: true, digest, historySize: director.snapshot().historySize }));
};

run();
