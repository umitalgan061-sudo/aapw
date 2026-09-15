import assert from 'node:assert/strict';
import { createPlayerAnimationTemporalScenario } from '../src/3d/gameplay/playerAnimationTemporalPolicy.js';
import { createPlayerAnimationOneShotController } from '../src/3d/gameplay/playerAnimationOneShotPolicy.js';
import { createPlayerAnimationSignalPacket } from '../src/3d/gameplay/playerAnimationSignalSanitizer.js';

const locomotionScenario = Array.from({ length: 36 }, (_, index) => ({
  deltaSeconds: 0.05,
  input: {
    planarSpeedMps: index < 6 ? 3.2 : index < 18 ? 6.2 : 5.0,
    runIntent: index >= 6 && index < 18,
    surface: { materialKey: index % 2 ? 'grass' : 'stone', confidence: 0.9, slip: 0.1 },
  },
}));

const temporalA = createPlayerAnimationTemporalScenario(locomotionScenario);
const temporalB = createPlayerAnimationTemporalScenario(locomotionScenario);
assert.equal(temporalA.fingerprint, temporalB.fingerprint);
assert.ok(temporalA.frameCount > 0);
assert.ok(temporalA.transitionCount > 0);
assert.ok(temporalA.footstepCount >= 0);

const oneShot = createPlayerAnimationOneShotController();
const start = oneShot.update(0, { action: 'heavy-attack', windowSeconds: 0.7, priority: 8 });
assert.equal(start.started, true);
const middle = oneShot.update(0.2);
assert.equal(middle.validation.ok, true);
const end = oneShot.update(1);
assert.equal(end.validation.ok, true);

const packet = createPlayerAnimationSignalPacket([
  ...temporalA.signals,
  ...oneShot.readHistory(),
], 10);
assert.ok(packet.count <= 8);
assert.ok(packet.warningCount >= 0);
for (const signal of packet.signals) {
  assert.equal(typeof signal.type, 'string');
  assert.ok(signal.sequence >= 0);
}

console.log('PLAYER_ANIMATION_PRESENTATION_INTEGRATION_ACCEPTANCE_PASS');
