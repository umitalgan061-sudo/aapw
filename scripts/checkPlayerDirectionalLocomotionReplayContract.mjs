import assert from 'node:assert/strict';
import {
  PLAYER_DIRECTIONAL_REPLAY_LIMITS,
  PLAYER_DIRECTIONAL_REPLAY_VERSION,
  auditPlayerDirectionalReplay,
  comparePlayerDirectionalReplayRuns,
  createPlayerDirectionalReplayTape,
  replayPlayerDirectionalSamples,
  replayPlayerDirectionalTape,
  validatePlayerDirectionalReplayTape,
} from '../src/3d/gameplay/playerDirectionalLocomotionReplay.js';

function input(index) {
  const angle = (index % 8) * Math.PI / 4;
  return {
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: 2 + (index % 7),
    slopeDegrees: index % 4 === 0 ? 35 : index % 9,
    turnRateDegreesPerSecond: (index * 45) % 360,
    previousPhase: (index * 0.13) % 1,
    deltaSeconds: 1 / 60,
  };
}

assert.equal(PLAYER_DIRECTIONAL_REPLAY_VERSION, '2026-09-15-v1');
assert.equal(PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames, 600);
assert.equal(auditPlayerDirectionalReplay().valid, true);

const samples = Array.from({ length: 24 }, (_, index) => input(index));
const tape = createPlayerDirectionalReplayTape(samples, { name: 'contract', seed: '7' });
assert.equal(validatePlayerDirectionalReplayTape(tape).ok, true);
assert.equal(tape.sampleCount, 24);
assert.equal(tape.metadata.name, 'contract');
assert.equal(tape.metadata.seed, '7');
assert.ok(tape.fingerprint.length >= 8);
assert.equal(Object.isFrozen(tape), true);
assert.equal(Object.isFrozen(tape.samples), true);

const replay = replayPlayerDirectionalTape(tape);
assert.equal(replay.valid, true);
assert.equal(replay.sampleCount, 24);
assert.equal(replay.frames.length, 24);
assert.equal(replay.finalState.frameCount, 24);
assert.equal(Object.isFrozen(replay.frames), true);
assert.ok(replay.fingerprint.length >= 8);

const replayAgain = replayPlayerDirectionalTape(tape);
assert.equal(comparePlayerDirectionalReplayRuns(replay, replayAgain).equal, true);
assert.equal(replay.fingerprint, replayAgain.fingerprint);

const copy = samples.map((value) => ({ ...value, velocity: { ...value.velocity }, facing: { ...value.facing } }));
const copiedReplay = replayPlayerDirectionalSamples(copy, { name: 'contract', seed: '7' });
assert.equal(copiedReplay.fingerprint, replay.fingerprint);

const changed = samples.slice();
changed[12] = { ...changed[12], slopeDegrees: 54, turnRateDegreesPerSecond: 500 };
const changedReplay = replayPlayerDirectionalSamples(changed, { name: 'contract', seed: '7' });
const diff = comparePlayerDirectionalReplayRuns(replay, changedReplay);
assert.equal(diff.equal, false);
assert.ok(diff.differences.length > 0);
assert.ok(diff.differences.includes(12));

const capInput = Array.from({ length: PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames + 40 }, (_, index) => input(index));
const cappedTape = createPlayerDirectionalReplayTape(capInput, { name: 'cap' });
assert.equal(cappedTape.sampleCount, PLAYER_DIRECTIONAL_REPLAY_LIMITS.maxFrames);
assert.equal(validatePlayerDirectionalReplayTape(cappedTape).bounded, true);

const malformedTape = { ...tape, samples: null };
assert.equal(validatePlayerDirectionalReplayTape(malformedTape).ok, false);

const wrongVersion = { ...tape, version: 'old' };
assert.equal(validatePlayerDirectionalReplayTape(wrongVersion).ok, false);

const empty = replayPlayerDirectionalSamples([]);
assert.equal(empty.valid, true);
assert.equal(empty.sampleCount, 0);
assert.equal(empty.frames.length, 0);

const semanticSamples = [
  { ...input(1), planarSpeedMps: 0 },
  { ...input(2), planarSpeedMps: 6 },
  { ...input(3), attackKind: 'heavy', planarSpeedMps: 7 },
  { ...input(4), dodgeRemaining: 0.2, planarSpeedMps: 7 },
  { ...input(5), hitStaggerRemaining: 0.2, planarSpeedMps: 7 },
];
const semanticReplay = replayPlayerDirectionalSamples(semanticSamples);
assert.ok(semanticReplay.frames.every((frame) => typeof frame.presentation.semanticState === 'string'));

for (const frame of semanticReplay.frames) {
  assert.equal(Number.isFinite(frame.presentation.speedMps), true);
  assert.equal(Number.isFinite(frame.presentation.playbackRate), true);
  assert.equal(Number.isFinite(frame.presentation.phase.phase), true);
}

const frozenFrame = semanticReplay.frames[0];
assert.equal(Object.isFrozen(frozenFrame), true);
assert.equal(Object.isFrozen(frozenFrame.state), true);
assert.equal(Object.isFrozen(frozenFrame.presentation), true);

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_REPLAY_CONTRACT_PASS');
