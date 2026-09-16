import assert from 'node:assert/strict';
import { createPlayerMotionPresentationIntegration, validatePlayerMotionPresentationIntegration, summarizePlayerMotionPresentationIntegration } from '../src/3d/gameplay/playerMotionPresentationIntegration.js';
const inputs=[
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,traversalWeight:.4,traversalForwardDistance:4,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,traversalWeight:.8,traversalForwardDistance:2.2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,deltaSeconds:1/60},
];
const integration=createPlayerMotionPresentationIntegration();
for(const input of inputs){const result=integration.update(input);assert.equal(validatePlayerMotionPresentationIntegration(integration.snapshot()).valid,true);assert.equal(result.contract.domain,result.state.domain);assert.ok(result.health.score>=0&&result.health.score<=1);}
const snapshot=integration.snapshot();assert.equal(snapshot.tickIndex,inputs.length);assert.equal(summarizePlayerMotionPresentationIntegration(snapshot).samples,inputs.length);integration.reset();assert.equal(integration.snapshot().tickIndex,0);
console.log('unified player motion presentation integration passed');
