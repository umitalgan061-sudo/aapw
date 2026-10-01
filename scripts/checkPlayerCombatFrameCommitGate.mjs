import assert from 'node:assert/strict';
import { createPlayerCombatFrameCommitGate } from '../src/3d/gameplay/playerCombatFrameCommitGate.js';

const gate = createPlayerCombatFrameCommitGate({ maxReceipts: 2 });
const first = gate.commit({ frame: 1, sequence: 1, channels: [
  { name: 'animation', version: 1 },
  { name: 'equipment', version: 1, accepted: false, reason: 'missing-socket' },
] });
assert.equal(first.status, 'committed');
assert.deepEqual(first.channels.map((channel) => channel.name), ['animation']);
assert.equal(gate.commit({ frame: 1, sequence: 1, channels: [] }).reason, 'duplicate-sequence');
assert.equal(gate.commit({ frame: 0, sequence: 2, channels: [] }).reason, 'stale-frame');
const second = gate.commit({ frame: 2, sequence: 2, channels: [
  { name: 'feedback', version: 2 },
  { name: 'resources', version: 2 },
] });
assert.equal(second.status, 'committed');
assert.equal(gate.snapshot().receipts.length, 2);
assert.throws(() => { second.channels.push({ name: 'target' }); }, TypeError);
const replay = createPlayerCombatFrameCommitGate();
assert.deepEqual(replay.commit({ frame: 1, sequence: 1, channels: [{ name: 'target', version: 1 }] }), gate.snapshot().receipts[0]);
gate.dispose();
assert.equal(gate.commit({ frame: 3, sequence: 3 }).reason, 'disposed');
console.log('PLAYER_COMBAT_FRAME_COMMIT_GATE_OK');
