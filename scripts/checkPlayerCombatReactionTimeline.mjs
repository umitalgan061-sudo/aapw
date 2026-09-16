import assert from 'node:assert/strict';
import { createPlayerCombatReactionTimeline, validatePlayerCombatReactionEvent } from '../src/3d/gameplay/playerCombatReactionTimeline.js';

const run = () => {
  const timeline = createPlayerCombatReactionTimeline({ maxEvents: 2 });
  const a = timeline.push({ reaction: 'hit-stagger', targetId: 'wolf-1', intensity: 0.8, timestamp: 120, sequence: 4 });
  assert.equal(a.accepted, true);
  assert.equal(validatePlayerCombatReactionEvent(a.event), true);
  assert.equal(a.event.window.startMs, 120);
  assert.ok(a.event.window.endMs > 120);

  const b = timeline.push({ reaction: 'parry', targetId: 'wolf-1', intensity: 0.5, timestamp: 400, sequence: 5 });
  assert.equal(b.event.animation, 'parry_react');
  const c = timeline.push({ reaction: 'defeat', targetId: 'wolf-1', intensity: 1, timestamp: 900, sequence: 6 });
  assert.equal(c.event.defeated, false);
  assert.equal(timeline.snapshot().size, 2);
  assert.equal(timeline.snapshot().history[0].reaction, 'parry');

  const replay = createPlayerCombatReactionTimeline({ maxEvents: 2 });
  const replayA = replay.push({ reaction: 'hit-stagger', targetId: 'wolf-1', intensity: 0.8, timestamp: 120, sequence: 4 });
  const replayB = replay.push({ reaction: 'parry', targetId: 'wolf-1', intensity: 0.5, timestamp: 400, sequence: 5 });
  const replayC = replay.push({ reaction: 'defeat', targetId: 'wolf-1', intensity: 1, timestamp: 900, sequence: 6 });
  assert.deepEqual([a.event, b.event, c.event], [replayA.event, replayB.event, replayC.event]);

  const rejected = timeline.push({ accepted: false, reaction: 'hit' });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'rejected');
  const disposed = timeline.dispose();
  assert.equal(disposed.disposed, true);
  assert.equal(timeline.push({ reaction: 'hit' }).reason, 'disposed');
};

run();
console.log('PLAYER_COMBAT_REACTION_TIMELINE_OK');
