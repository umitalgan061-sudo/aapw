import assert from 'node:assert/strict';
import { PLAYER_FULL_PIPELINE_SCENARIOS } from '../src/3d/gameplay/fixtures/playerPresentationFullPipelineScenarios.js';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';

const convert=(step)=>({planarSpeedMps:step.speed,traversalWeight:step.w,traversalForwardDistance:step.d,traversalHeight:step.h,grounded:step.g,landingImpactMps:step.impact,elapsedSeconds:step.elapsed,cancelRequested:step.c,traversalBlocked:step.blocked,surfaceConfidence:step.s,directionShiftDegrees:step.shift,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}});
for(const fixture of PLAYER_FULL_PIPELINE_SCENARIOS){let previous=null;for(let i=0;i<fixture.steps.length;i+=1){const state=buildPlayerMotionPresentationState(previous,convert(fixture.steps[i]));assert.equal(state.traversal.state,fixture.states[i],`${fixture.id}:${i}`);previous=state;}}
console.log(`full presentation scenarios passed: ${PLAYER_FULL_PIPELINE_SCENARIOS.length}`);
