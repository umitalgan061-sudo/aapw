import assert from 'node:assert/strict';
import { CREATURE_LOCOMOTION_STATE_FIXTURES } from '../src/3d/gameplay/fixtures/creatureLocomotionStateFixtures.js';
import { buildCreatureContactLocomotionInput } from '../src/3d/gameplay/creatureLocomotionContactPolicy.js';
import { createCreatureLocomotionRuntime, updateCreatureLocomotionRuntime } from '../src/3d/gameplay/creatureLocomotionStateRuntime.js';
import { createCreatureLocomotionPresentationBridge, consumeCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionPresentationBridge.js';
import { createCreatureLocomotionTelemetry, recordCreatureLocomotionTelemetry, finalizeCreatureLocomotionTelemetry } from '../src/3d/gameplay/creatureLocomotionStateTelemetry.js';
import { checkCreatureLocomotionState } from '../src/3d/gameplay/creatureLocomotionStateQuality.js';

const runtime = createCreatureLocomotionRuntime({ id: 'e2e' });
const bridge = createCreatureLocomotionPresentationBridge({ id: 'e2e-bridge' });
const telemetry = createCreatureLocomotionTelemetry({ id: 'e2e-telemetry' });
let previous = null;
let checked = 0;

for (const fixture of CREATURE_LOCOMOTION_STATE_FIXTURES) {
  const input = buildCreatureContactLocomotionInput(fixture.input, { grounded: fixture.input.grounded, surfaceConfidence: fixture.input.surfaceConfidence, normalConfidence: fixture.input.groundNormalConfidence, slip: fixture.input.surfaceSlip, impactMps: fixture.input.impactMps, airTimeSeconds: fixture.input.airTimeSeconds });
  const direct = updateCreatureLocomotionRuntime(runtime, input);
  const presentation = consumeCreatureLocomotionState(bridge, direct.state, direct.timestamp);
  recordCreatureLocomotionTelemetry(telemetry, direct.state, input);
  assert.deepEqual(checkCreatureLocomotionState(direct.state, input), [], fixture.id);
  assert.equal(presentation.summary.state, direct.state.state);
  assert.equal(presentation.gait.gait, direct.state.gait);
  previous = direct.state;
  checked += previous === direct.state ? 1 : 0;
}

const summary = finalizeCreatureLocomotionTelemetry(telemetry);
assert.equal(summary.sampleCount, CREATURE_LOCOMOTION_STATE_FIXTURES.length);
assert.equal(summary.invalidSamples, 0);
assert.ok(checked === CREATURE_LOCOMOTION_STATE_FIXTURES.length);
assert.ok(bridge.emitted.length > 0);
console.log(`Creature locomotion E2E checks passed: ${checked}`);
