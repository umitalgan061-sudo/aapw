import assert from 'node:assert/strict';
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  PLAYER_DIRECTIONAL_SEMANTICS,
  PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS,
  auditPlayerDirectionalLocomotionPolicy,
  classifyPlayerDirectionalQuadrant,
  classifyPlayerDirectionalSemantic,
  createPlayerDirectionalLocomotionController,
  createPlayerDirectionalScenario,
  createPlayerDirectionalLocomotionState,
  getPlayerDirectionalLocomotionLimits,
  normalizePlayerDirectionalInput,
  normalizePlayerDirectionalPhase,
  resolvePlayerDirectionalAngle,
  resolvePlayerDirectionalBlendMagnitude,
  resolvePlayerDirectionalBlendWeights,
  resolvePlayerDirectionalCadenceScale,
  resolvePlayerDirectionalCombatOverlay,
  resolvePlayerDirectionalDominantDirection,
  resolvePlayerDirectionalFacingBlend,
  resolvePlayerDirectionalFootEvent,
  resolvePlayerDirectionalFootLead,
  resolvePlayerDirectionalFootPlantWeight,
  resolvePlayerDirectionalFullPresentation,
  resolvePlayerDirectionalGroundedConfidence,
  resolvePlayerDirectionalMomentum,
  resolvePlayerDirectionalPhaseStep,
  resolvePlayerDirectionalPlaybackRate,
  resolvePlayerDirectionalPresentation,
  resolvePlayerDirectionalSector,
  resolvePlayerDirectionalSemantic,
  resolvePlayerDirectionalSlopeClass,
  resolvePlayerDirectionalSlopeScale,
  resolvePlayerDirectionalSurfacePresentation,
  resolvePlayerDirectionalSurfaceScale,
  resolvePlayerDirectionalTurnClass,
  resolvePlayerDirectionalTurnScale,
  resolvePlayerDirectionalTurnAmount,
  validatePlayerDirectionalBlendWeights,
  validatePlayerDirectionalPresentation,
  validatePlayerDirectionalState,
} from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';
import {
  advancePlayerDirectionalTelemetry,
  buildPlayerDirectionalTelemetryScenario,
  comparePlayerDirectionalTelemetry,
  createPlayerDirectionalTelemetryReadModel,
  createPlayerDirectionalTelemetryState,
  resolvePlayerDirectionalTelemetryBudget,
  resolvePlayerDirectionalTelemetryConfidenceBuckets,
  resolvePlayerDirectionalTelemetryEvent,
  resolvePlayerDirectionalTelemetryQuality,
  createPlayerDirectionalTelemetryController,
  auditPlayerDirectionalTelemetry,
} from '../src/3d/gameplay/playerDirectionalLocomotionTelemetry.js';

const assertFiniteTree = (value, path = 'root') => {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true, `${path} must be finite`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
};

function sample(overrides = {}) {
  return {
    velocity: { x: 0, y: 1 },
    facing: { x: 0, y: 1 },
    planarSpeedMps: 3.2,
    slopeDegrees: 0,
    turnRateDegreesPerSecond: 0,
    deltaSeconds: 1 / 60,
    previousPhase: 0,
    surfaceConfidence: 1,
    surfaceSlip: 0,
    ...overrides,
  };
}

assert.equal(PLAYER_DIRECTIONAL_DIRECTIONS.length, 8);
assert.equal(PLAYER_DIRECTIONAL_SEMANTICS.length, 8);
assert.equal(auditPlayerDirectionalLocomotionPolicy().blendContract, true);
assert.equal(auditPlayerDirectionalLocomotionPolicy().stateContract, true);
assert.deepEqual(getPlayerDirectionalLocomotionLimits(), PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS);

assert.equal(normalizePlayerDirectionalPhase(0), 0);
assert.equal(normalizePlayerDirectionalPhase(1), 0);
assert.equal(normalizePlayerDirectionalPhase(-0.25), 0.75);
assert.equal(normalizePlayerDirectionalPhase(2.25), 0.25);
assert.equal(normalizePlayerDirectionalPhase(Infinity), 0);

const normalized = normalizePlayerDirectionalInput({
  velocity: { x: Infinity, y: NaN },
  facing: { x: 0, y: 0 },
  planarSpeedMps: 99,
  slopeDegrees: 99,
  turnRateDegreesPerSecond: 999,
  deltaSeconds: 99,
  runIntent: 1,
  guarding: 1,
  attackKind: 'invalid',
  dodgeRemaining: NaN,
  hitStaggerRemaining: Infinity,
  surfaceConfidence: -3,
  surfaceSlip: 2,
});
assert.equal(normalized.planarSpeedMps, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSpeedMps);
assert.equal(normalized.slopeDegrees, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSlopeDegrees);
assert.equal(normalized.turnRateDegreesPerSecond, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond);
assert.equal(normalized.deltaSeconds, 1);
assert.equal(normalized.runIntent, true);
assert.equal(normalized.guarding, true);
assert.equal(normalized.attackKind, 'none');
assert.equal(normalized.surfaceConfidence, 0);
assert.equal(normalized.surfaceSlip, 1);
assertFiniteTree(normalized);

assert.equal(classifyPlayerDirectionalSemantic(sample({ planarSpeedMps: 0 })), 'idle');
assert.equal(classifyPlayerDirectionalSemantic(sample({ planarSpeedMps: 3.5 })), 'locomotion');
assert.equal(classifyPlayerDirectionalSemantic(sample({ planarSpeedMps: 6 })), 'sprint');
assert.equal(classifyPlayerDirectionalSemantic(sample({ planarSpeedMps: 6, attackKind: 'light' })), 'light-attack');
assert.equal(classifyPlayerDirectionalSemantic(sample({ planarSpeedMps: 6, attackKind: 'heavy' })), 'heavy-attack');
assert.equal(classifyPlayerDirectionalSemantic(sample({ guarding: true })), 'guard');
assert.equal(classifyPlayerDirectionalSemantic(sample({ dodgeRemaining: 0.2 })), 'dodge');
assert.equal(classifyPlayerDirectionalSemantic(sample({ hitStaggerRemaining: 0.2 })), 'hit-stagger');

assert.equal(resolvePlayerDirectionalSemantic(sample({ planarSpeedMps: 5.55 })), 'locomotion');
assert.equal(resolvePlayerDirectionalSemantic(sample({ planarSpeedMps: 5.6 })), 'sprint');
assert.equal(resolvePlayerDirectionalSemantic(sample({ planarSpeedMps: 5.25 }), 'sprint'), 'sprint');
assert.equal(resolvePlayerDirectionalSemantic(sample({ planarSpeedMps: 5.09 }), 'sprint'), 'locomotion');

assert.equal(resolvePlayerDirectionalAngle(sample()), 0);
assert.equal(resolvePlayerDirectionalAngle(sample({ velocity: { x: 1, y: 0 } })), Math.PI / 2);
assert.equal(resolvePlayerDirectionalSector(0), 'forward');
assert.equal(resolvePlayerDirectionalSector(Math.PI / 4), 'forward-right');
assert.equal(resolvePlayerDirectionalSector(Math.PI / 2), 'right');
assert.equal(resolvePlayerDirectionalSector(Math.PI), 'back');
assert.equal(resolvePlayerDirectionalSector(-Math.PI / 2), 'left');
assert.equal(classifyPlayerDirectionalQuadrant(0), 'forward');
assert.equal(classifyPlayerDirectionalQuadrant(Math.PI / 2), 'lateral');
assert.equal(classifyPlayerDirectionalQuadrant(Math.PI), 'rear');

for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
  const weights = resolvePlayerDirectionalBlendWeights({ ...sample(), velocity: { x: Math.sin(Math.atan2(
    direction === 'forward' ? 0 : direction === 'right' ? Math.PI / 2 : direction === 'back' ? Math.PI : direction === 'left' ? -Math.PI / 2 : 0,
    1,
  )), y: 1 }, facing: { x: 0, y: 1 } });
  assert.equal(validatePlayerDirectionalBlendWeights(weights), true);
  assert.equal(Object.keys(weights).length, 8);
}

const forwardWeights = resolvePlayerDirectionalBlendWeights(sample());
assert.equal(resolvePlayerDirectionalDominantDirection(forwardWeights), 'forward');
assert.equal(validatePlayerDirectionalBlendWeights(forwardWeights), true);
assert.equal(resolvePlayerDirectionalBlendMagnitude(sample({ planarSpeedMps: 6.5 })), 0.5417);
assert.equal(resolvePlayerDirectionalBlendMagnitude(sample({ planarSpeedMps: 999 })), 1);

assert.equal(resolvePlayerDirectionalTurnClass(sample()), 'neutral');
assert.equal(resolvePlayerDirectionalTurnClass(sample({ turnRateDegreesPerSecond: 45 })), 'light');
assert.equal(resolvePlayerDirectionalTurnClass(sample({ turnRateDegreesPerSecond: 180 })), 'active');
assert.equal(resolvePlayerDirectionalTurnClass(sample({ turnRateDegreesPerSecond: 400 })), 'sharp');
assert.equal(resolvePlayerDirectionalTurnScale(sample()), 0.88);
assert.equal(resolvePlayerDirectionalTurnScale(sample({ turnRateDegreesPerSecond: 400 })), 1.18);
assert.equal(resolvePlayerDirectionalTurnAmount(sample({ turnRateDegreesPerSecond: 180, deltaSeconds: 0.5 })), 90);
assert.deepEqual(resolvePlayerDirectionalFacingBlend(sample({ turnRateDegreesPerSecond: 180 })), {
  amountDegrees: 3,
  weight: 0.3333,
  class: 'active',
});

assert.equal(resolvePlayerDirectionalSlopeClass(sample()), 'flat');
assert.equal(resolvePlayerDirectionalSlopeClass(sample({ slopeDegrees: 15 })), 'rising');
assert.equal(resolvePlayerDirectionalSlopeClass(sample({ slopeDegrees: 30 })), 'steep');
assert.equal(resolvePlayerDirectionalSlopeClass(sample({ slopeDegrees: 45 })), 'extreme');
assert.equal(resolvePlayerDirectionalSlopeScale(sample()), 1);
assert.ok(resolvePlayerDirectionalSlopeScale(sample({ slopeDegrees: 30 })) < 1);
assert.ok(resolvePlayerDirectionalSurfaceScale(sample({ surfaceConfidence: 0 })) < 1);
assert.equal(resolvePlayerDirectionalSurfaceScale(sample({ surfaceConfidence: 1, surfaceSlip: 0 })), 1);
assert.ok(resolvePlayerDirectionalCadenceScale(sample({ turnRateDegreesPerSecond: 500, slopeDegrees: 40 })) <= 1.22);

const phaseStep = resolvePlayerDirectionalPhaseStep(sample({ previousPhase: 0.95, planarSpeedMps: 6.5 }));
assert.equal(phaseStep.wrapped, true);
assert.equal(phaseStep.advanced, true);
assert.ok(phaseStep.phase >= 0 && phaseStep.phase < 1);
assert.equal(resolvePlayerDirectionalPhaseStep(sample({ planarSpeedMps: 0 })).advanced, false);
assert.equal(resolvePlayerDirectionalFootLead(0.1), 'left');
assert.equal(resolvePlayerDirectionalFootLead(0.3), 'right');
assert.equal(resolvePlayerDirectionalFootLead(0.55), 'left');
assert.equal(resolvePlayerDirectionalFootLead(0.9), 'right');
const footEvent = resolvePlayerDirectionalFootEvent(sample({ previousPhase: 0.99, planarSpeedMps: 6.5 }));
assert.equal(footEvent.emitted, true);
assert.equal(footEvent.foot, 'right');

assert.ok(resolvePlayerDirectionalPlaybackRate(sample({ planarSpeedMps: 3.2 })) >= 0.72);
assert.ok(resolvePlayerDirectionalPlaybackRate(sample({ planarSpeedMps: 12 })) <= 1.35);
const momentum = resolvePlayerDirectionalMomentum(sample({ planarSpeedMps: 8, turnRateDegreesPerSecond: 200, surfaceSlip: 0.2 }));
assertFiniteTree(momentum);
assert.ok(momentum.lateral > 0);

const presentation = resolvePlayerDirectionalFullPresentation(sample({ planarSpeedMps: 6.2, slopeDegrees: 12, turnRateDegreesPerSecond: 150 }));
assert.equal(validatePlayerDirectionalPresentation(presentation).ok, true);
assert.equal(presentation.semanticState, 'sprint');
assert.ok(presentation.surface.footPlantWeight > 0);
assert.equal(presentation.combatOverlay.locomotion, 1);
assert.deepEqual(resolvePlayerDirectionalCombatOverlay(sample({ attackKind: 'heavy' })), {
  locomotion: 0,
  guard: 0,
  dodge: 0,
  lightAttack: 0,
  heavyAttack: 1,
  hitStagger: 0,
});

const initial = createPlayerDirectionalLocomotionState();
assert.equal(validatePlayerDirectionalState(initial).ok, true);
const scenario = createPlayerDirectionalScenario([
  sample({ planarSpeedMps: 0 }),
  sample({ planarSpeedMps: 3.2 }),
  sample({ planarSpeedMps: 6 }),
  sample({ planarSpeedMps: 6.2, turnRateDegreesPerSecond: 180 }),
  sample({ planarSpeedMps: 4.8, slopeDegrees: 20 }),
  sample({ planarSpeedMps: 0 }),
]);
assert.equal(scenario.valid, true);
assert.equal(scenario.count, 6);
assert.ok(scenario.fingerprint.length >= 8);
assert.equal(scenario.states.at(-1).frameCount, 6);

const controllerEvents = [];
const controller = createPlayerDirectionalLocomotionController({ onPresentation: (value) => controllerEvents.push(value.semanticState) });
controller.update(sample({ planarSpeedMps: 0 }));
controller.update(sample({ planarSpeedMps: 6.2 }));
controller.update(sample({ planarSpeedMps: 6.2 }));
assert.equal(controller.read().frameCount, 3);
assert.ok(controllerEvents.length >= 2);
controller.reset();
assert.equal(controller.read().frameCount, 0);

let telemetry = createPlayerDirectionalTelemetryState();
const telemetryInputs = [
  sample({ planarSpeedMps: 0 }),
  sample({ planarSpeedMps: 3.2, previousPhase: 0.99 }),
  sample({ planarSpeedMps: 6.2, previousPhase: 0.99, turnRateDegreesPerSecond: 180 }),
  sample({ planarSpeedMps: 6.2, previousPhase: 0.99, slopeDegrees: 30, surfaceConfidence: 0.2 }),
  sample({ planarSpeedMps: 6.2, attackKind: 'heavy' }),
];
for (let index = 0; index < telemetryInputs.length; index += 1) telemetry = advancePlayerDirectionalTelemetry(telemetry, telemetryInputs[index], index);
const readModel = createPlayerDirectionalTelemetryReadModel(telemetry);
assert.equal(readModel.counters.samples, telemetryInputs.length);
assert.ok(readModel.counters.transitions >= 1);
assert.ok(readModel.events?.length >= 1 || readModel.recentEvents.length >= 1);
assert.equal(Number.isFinite(resolvePlayerDirectionalTelemetryQuality(readModel).score), true);
assert.equal(resolvePlayerDirectionalTelemetryBudget(10, 2).withinBudget, true);
assert.equal(resolvePlayerDirectionalTelemetryBudget(241, 2).withinBudget, false);
assert.equal(Object.values(resolvePlayerDirectionalTelemetryConfidenceBuckets([0, 0.2, 0.5, 0.9])).reduce((a, b) => a + b, 0), 4);

const eventA = resolvePlayerDirectionalTelemetryEvent(
  resolvePlayerDirectionalFullPresentation(sample({ planarSpeedMps: 0 })),
  resolvePlayerDirectionalFullPresentation(sample({ planarSpeedMps: 6.2, previousPhase: 0.99 })),
  1,
);
assert.ok(eventA.some((entry) => entry.type === 'semantic-transition'));

const telemetryScenarioA = buildPlayerDirectionalTelemetryScenario(telemetryInputs);
const telemetryScenarioB = buildPlayerDirectionalTelemetryScenario(telemetryInputs);
assert.equal(comparePlayerDirectionalTelemetry(telemetryScenarioA, telemetryScenarioB).equal, true);
assert.equal(telemetryScenarioA.fingerprint, telemetryScenarioB.fingerprint);
assert.equal(auditPlayerDirectionalTelemetry().version, '2026-09-15-v1');

const telemetryController = createPlayerDirectionalTelemetryController();
telemetryController.update(sample({ planarSpeedMps: 3.2 }));
telemetryController.update(sample({ planarSpeedMps: 6.2 }));
assert.equal(telemetryController.read().counters.samples, 2);
telemetryController.reset();
assert.equal(telemetryController.read().counters.samples, 0);

console.log('PLAYER_DIRECTIONAL_LOCOMOTION_POLICY_PASS');
