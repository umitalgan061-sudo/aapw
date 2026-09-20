import assert from 'node:assert/strict';
import { createPlayerCombatRuntimeFrameGuard } from '../src/3d/gameplay/playerCombatRuntimeFrameGuard.js';
import { resolvePlayerLocomotionAnticipationProfile, validatePlayerLocomotionAnticipationProfile } from '../src/3d/gameplay/playerLocomotionAnticipationPolicy.js';

function locomotionSample(index = 0) {
  return {
    velocity: { x: 0, y: 1 },
    facing: { x: 0, y: 1 },
    planarSpeedMps: index === 0 ? 2.5 : 5.5,
    slopeDegrees: 4,
    turnRateDegreesPerSecond: 12,
    deltaSeconds: 0.016,
    surfaceConfidence: 0.95,
    surfaceSlip: 0.05,
  };
}

function frame(revision, timestamp, attackSerial, profile) {
  return {
    version: 1,
    revision,
    timestamp,
    attack: { serial: attackSerial, kind: 'light' },
    locomotion: profile,
  };
}

const firstProfile = resolvePlayerLocomotionAnticipationProfile(locomotionSample(0));
const secondProfile = resolvePlayerLocomotionAnticipationProfile(locomotionSample(1), firstProfile);
assert.equal(validatePlayerLocomotionAnticipationProfile(firstProfile).ok, true);
assert.equal(validatePlayerLocomotionAnticipationProfile(secondProfile).ok, true);

const guard = createPlayerCombatRuntimeFrameGuard({ maxRevisionGap: 1 });
const first = guard.inspect(frame(0, 0, 0, firstProfile));
assert.equal(first.ok, true);
assert.equal(Object.isFrozen(first.frame), true);
assert.equal(Object.isFrozen(first.frame.locomotion), true);

const second = guard.inspect(frame(1, 0.016, 1, secondProfile));
assert.equal(second.ok, true);
assert.equal(second.frame.locomotion.mode, secondProfile.mode);
assert.equal(guard.readState().accepted, 2);

const duplicate = guard.inspect(frame(1, 0.016, 1, secondProfile));
assert.equal(duplicate.ok, false);
assert.equal(duplicate.reason, 'duplicate-frame');
assert.equal(guard.readState().rejected, 1);

const stale = guard.inspect(frame(0, 0.032, 2, secondProfile));
assert.equal(stale.ok, false);
assert.equal(stale.reason, 'revision-regressed');
assert.equal(guard.readState().rejected, 2);

const disposed = guard.dispose();
assert.equal(disposed.disposed, true);
assert.equal(guard.inspect(frame(2, 0.048, 3, secondProfile)).reason, 'disposed');

console.log('KIZIL_UFUK_PLAYER_RUNTIME_FRAME_GUARD_LOCOMOTION_BRIDGE_PASS');
