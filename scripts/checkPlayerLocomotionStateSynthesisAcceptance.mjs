import assert from 'node:assert/strict';
import {
  PLAYER_LOCOMOTION_STATE_STATES,
  PLAYER_LOCOMOTION_STATE_EVENTS,
  PLAYER_LOCOMOTION_STATE_SCENARIOS,
  resolvePlayerLocomotionStateIntent,
  resolvePlayerLocomotionStateSource,
  validatePlayerLocomotionStateIntent,
  createPlayerLocomotionStateSynthesisController,
  summarizePlayerLocomotionStateIntents,
  comparePlayerLocomotionStateIntents,
} from '../src/3d/gameplay/playerLocomotionStateSynthesis.js';
import {
  createPlayerLocomotionStateTimelineController,
  validatePlayerLocomotionStateTimelineSample,
  summarizePlayerLocomotionTimelineSamples,
} from '../src/3d/gameplay/playerLocomotionStateTimeline.js';

function finiteTree(value, path = 'root') {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true, `${path}:finite`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
}
function sample(overrides = {}) {
  return {
    velocity:{x:0,y:1},
    facing:{x:0,y:1},
    planarSpeedMps:3.2,
    slopeDegrees:0,
    turnRateDegreesPerSecond:0,
    deltaSeconds:1 / 60,
    surfaceConfidence:1,
    surfaceSlip:0,
    grounded:true,
    airTimeSeconds:0,
    landingImpactMps:0,
    traversalWeight:0,
    traversalBlocked:false,
    ...overrides,
  };
}
assert.equal(new Set(PLAYER_LOCOMOTION_STATE_STATES).size, PLAYER_LOCOMOTION_STATE_STATES.length);
assert.equal(new Set(PLAYER_LOCOMOTION_STATE_EVENTS).size, PLAYER_LOCOMOTION_STATE_EVENTS.length);
assert.equal(PLAYER_LOCOMOTION_STATE_SCENARIOS.length >= 18, true);
for (const scenario of PLAYER_LOCOMOTION_STATE_SCENARIOS) {
  const intent = resolvePlayerLocomotionStateIntent(scenario.input);
  assert.equal(validatePlayerLocomotionStateIntent(intent).ok, true, scenario.name);
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state));
  assert.ok(PLAYER_LOCOMOTION_STATE_EVENTS.includes(intent.event.type));
  finiteTree(intent, scenario.name);
}
const speedCorpus = [];
for (let index = 0; index <= 240; index += 1) {
  const speed = index / 20;
  const input = sample({ planarSpeedMps:speed, turnRateDegreesPerSecond:(index % 19) * 29, slopeDegrees:((index % 23) - 11) * 2, surfaceSlip:(index % 17) / 20, surfaceConfidence:0.55 + (index % 10) / 20 });
  const intent = resolvePlayerLocomotionStateIntent(input);
  speedCorpus.push(intent);
  assert.equal(intent.validation.ok, true, `speed-${index}`);
  assert.ok(intent.confidence >= 0 && intent.confidence <= 1);
  assert.ok(intent.profile.speedMps >= 0 && intent.profile.speedMps <= 12);
  assert.ok(intent.direction.selected.length > 0);
}
assert.equal(speedCorpus.length, 241);
const speedSummary = summarizePlayerLocomotionStateIntents(speedCorpus);
assert.equal(speedSummary.invalidCount, 0);
assert.equal(speedSummary.count, 241);
for (let index = 0; index <= 180; index += 1) {
  const angle = -180 + index * 2;
  const radians = angle * Math.PI / 180;
  const input = sample({ velocity:{x:Math.sin(radians),y:Math.cos(radians)}, planarSpeedMps:5.5, turnRateDegreesPerSecond:(index % 13) * 40 });
  const intent = resolvePlayerLocomotionStateIntent(input);
  assert.equal(intent.validation.ok, true, `angle-${index}`);
  assert.ok(intent.blend.directions.forward >= 0);
  assert.ok(Math.abs(Object.values(intent.blend.directions).reduce((a,b)=>a+b,0)-1) < 0.002);
}
for (let index = 0; index < 180; index += 1) {
  const previous = resolvePlayerLocomotionStateIntent(sample({ planarSpeedMps:index % 12 }));
  const current = resolvePlayerLocomotionStateIntent(sample({ planarSpeedMps:(index % 12) + (index % 3 === 0 ? 1.2 : -0.4), turnRateDegreesPerSecond:(index % 8) * 60 }), previous);
  assert.equal(current.validation.ok, true, `transition-${index}`);
  assert.equal(typeof current.transition.edge, 'string');
  assert.ok(current.transition.confidence >= 0 && current.transition.confidence <= 1);
}
for (let index = 0; index < 180; index += 1) {
  const input = sample({
    planarSpeedMps:(index % 80) / 10,
    grounded:index % 17 !== 0,
    airTimeSeconds:index % 17 === 0 ? 0.2 + (index % 5) * 0.1 : 0,
    landingImpactMps:index % 23 === 0 ? 5.2 : index % 11 === 0 ? 2.1 : 0,
    surfaceSlip:index % 7 === 0 ? 0.82 : 0.12,
    surfaceConfidence:index % 13 === 0 ? 0.31 : 0.92,
    traversalWeight:index % 9 === 0 ? 0.92 : 0.15,
    traversalForwardDistance:index % 9 === 0 ? 3.2 : 1.1,
    traversalBlocked:index % 29 === 0,
  });
  const intent = resolvePlayerLocomotionStateIntent(input);
  assert.equal(intent.validation.ok, true, `context-${index}`);
  finiteTree(intent, `context-${index}`);
}
const controllerSeen = [];
const controller = createPlayerLocomotionStateSynthesisController({ onIntent:intent => controllerSeen.push(intent) });
for (let index = 0; index < 360; index += 1) {
  controller.update(sample({
    planarSpeedMps:index < 50 ? index / 20 : index < 180 ? 5.2 : 2.4,
    turnRateDegreesPerSecond:index % 15 === 0 ? 240 : 0,
    guarding:index % 47 === 0,
    attackKind:index % 53 === 0 ? 'heavy' : undefined,
    dodgeRemaining:index % 71 === 0 ? 0.18 : 0,
    hitStaggerRemaining:index % 89 === 0 ? 0.22 : 0,
  }));
}
assert.equal(controllerSeen.length, 360);
assert.equal(controller.read().state.length > 0, true);
controller.reset();
assert.equal(controller.read().state, 'idle');
const timeline = createPlayerLocomotionStateTimelineController();
const timelineSamples = [];
for (let index = 0; index < 480; index += 1) {
  const result = timeline.update(sample({
    planarSpeedMps:(index % 97) / 14,
    turnRateDegreesPerSecond:(index % 11) * 45,
    surfaceSlip:index % 16 === 0 ? 0.9 : 0.1,
    grounded:index % 37 !== 0,
    airTimeSeconds:index % 37 === 0 ? 0.25 : 0,
    landingImpactMps:index % 41 === 0 ? 5.4 : 0,
  }));
  timelineSamples.push(result.sample);
  assert.equal(validatePlayerLocomotionStateTimelineSample(result.sample).ok, true, `timeline-${index}`);
  assert.ok(result.sample.progress >= 0 && result.sample.progress <= 1);
  assert.ok(result.sample.easedProgress >= 0 && result.sample.easedProgress <= 1);
}
const timelineSummary = summarizePlayerLocomotionTimelineSamples(timelineSamples);
assert.equal(timelineSummary.invalidCount, 0);
assert.equal(timelineSummary.count, 480);
const replayA = [];
const replayB = [];
for (let index = 0; index < 220; index += 1) {
  const input = sample({ planarSpeedMps:(index % 63) / 8, turnRateDegreesPerSecond:(index % 9) * 50, surfaceSlip:(index % 12) / 14 });
  replayA.push(resolvePlayerLocomotionStateIntent(input));
  replayB.push(resolvePlayerLocomotionStateIntent(input));
}
assert.equal(comparePlayerLocomotionStateIntents(replayA, replayB).deterministic, true);
for (let index = 0; index < 64; index += 1) {
  const intent = resolvePlayerLocomotionStateIntent(sample({ gameplayOverride:'guard', planarSpeedMps:4 }));
  const source = resolvePlayerLocomotionStateSource(intent.input, intent.profile);
  assert.equal(source.source, 'override', `override-${index}`);
  assert.equal(source.state, 'guard-walk');
}
for (let index = 0; index < 64; index += 1) {
  const intent = resolvePlayerLocomotionStateIntent(sample({ grounded:false, planarSpeedMps:2.5, airTimeSeconds:index / 10 }));
  assert.ok(intent.state === 'airborne' || intent.state === 'landing-soft' || intent.state === 'landing-hard' || intent.state === 'stagger-recover' || intent.state === 'dodge-recover' || intent.state === 'recover' || intent.state === 'start' || intent.state === 'cruise' || intent.state === 'accelerate');
}
console.log('PLAYER_LOCOMOTION_STATE_SYNTHESIS_ACCEPTANCE_PASS');
