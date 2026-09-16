import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { PLAYER_TRAVERSAL_PRESENTATION_SCENARIOS, PLAYER_TRAVERSAL_PRESENTATION_SEQUENCE_FIXTURES } from '../src/3d/gameplay/fixtures/playerTraversalPresentationFixtures.js';
import { PLAYER_TRAVERSAL_EXTENDED_SCENARIOS } from '../src/3d/gameplay/fixtures/playerTraversalPresentationExtendedScenarios.js';
import { evaluateTraversalThresholdCorpus, runTraversalBoundaryProbe } from '../src/3d/gameplay/playerTraversalPresentationCalibration.js';
import { createTraversalConsumerAdapter, validateTraversalConsumerAdapterOutput } from '../src/3d/gameplay/playerTraversalPresentationConsumerAdapter.js';
import { buildTraversalPresentationEventIntent } from '../src/3d/gameplay/playerTraversalPresentationEventPolicy.js';

const resolveInput=(step={})=>({traversalWeight:step.w??step.traversalWeight,traversalForwardDistance:step.d??step.traversalForwardDistance,traversalHeight:step.h??step.traversalHeight,grounded:step.g??step.grounded,landingImpactMps:step.impact??step.landingImpactMps,cancelRequested:step.c??step.cancelRequested,traversalBlocked:step.blocked??step.traversalBlocked,surfaceConfidence:step.s??step.surfaceConfidence,planarSpeedMps:step.speed??step.planarSpeedMps});

assert.ok(Array.isArray(PLAYER_TRAVERSAL_PRESENTATION_SCENARIOS));
assert.ok(Array.isArray(PLAYER_TRAVERSAL_PRESENTATION_SEQUENCE_FIXTURES));
assert.ok(Array.isArray(PLAYER_TRAVERSAL_EXTENDED_SCENARIOS));
for(const fixture of PLAYER_TRAVERSAL_EXTENDED_SCENARIOS){let previous=null;for(let i=0;i<fixture.steps.length;i+=1){const state=buildPlayerTraversalPresentationState(previous,resolveInput(fixture.steps[i]));assert.equal(state.state,fixture.states[i],`${fixture.id}:${i}`);previous=state;}}
const corpus=evaluateTraversalThresholdCorpus();assert.equal(typeof corpus.valid,'boolean');
const boundary=runTraversalBoundaryProbe();assert.ok(boundary.rows.length>0);
const adapter=createTraversalConsumerAdapter();
const presentation=buildPlayerTraversalPresentationState(null,{traversalWeight:.9,traversalForwardDistance:1.2});
const output=adapter.adapt(presentation);assert.equal(validateTraversalConsumerAdapterOutput(output).valid,true);
assert.equal(typeof buildTraversalPresentationEventIntent(presentation).priority,'number');
console.log(`extended traversal checks passed: ${PLAYER_TRAVERSAL_EXTENDED_SCENARIOS.length} scenarios`);
