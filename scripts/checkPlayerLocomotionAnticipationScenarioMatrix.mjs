import assert from 'node:assert/strict';
import { resolvePlayerLocomotionAnticipationProfile, validatePlayerLocomotionAnticipationProfile } from '../src/3d/gameplay/playerLocomotionAnticipationPolicy.js';
import { resolvePlayerLocomotionAnimationRequest, validatePlayerLocomotionAnimationRequest } from '../src/3d/gameplay/playerLocomotionAnimationBridge.js';
import { resolvePlayerLocomotionTemporalWindow, resolvePlayerLocomotionTemporalSample } from '../src/3d/gameplay/playerLocomotionTemporalTuning.js';
import { resolvePlayerLocomotionTransitionEnvelope, validatePlayerLocomotionTransitionEnvelope } from '../src/3d/gameplay/playerLocomotionTransitionWindows.js';
import { resolvePlayerLocomotionFootContactPresentation, validatePlayerLocomotionFootContactPresentation } from '../src/3d/gameplay/playerLocomotionFootContactPolicy.js';
import { pushPlayerLocomotionVelocityHistory, createPlayerLocomotionVelocityHistory, resolvePlayerLocomotionHistoryPrediction, resolvePlayerLocomotionHistoryStability } from '../src/3d/gameplay/playerLocomotionVelocityHistory.js';

const semis=['none','light','heavy'];
const surfaces=[['clear',1,0],['soft',0.8,0.2],['slippery',0.65,0.7],['steep',0.75,0.3],['unstable',0.4,0.85]];
function sample(i,overrides={}){const a=(i%24)*Math.PI/12;return{velocity:{x:Math.sin(a),y:Math.cos(a)},facing:{x:0,y:1},planarSpeedMps:(i%17)*.73,slopeDegrees:(i%14)*4,turnRateDegreesPerSecond:(i%15)*36,deltaSeconds:.016+(i%3)*.01,surfaceConfidence:(i%11)/10,surfaceSlip:(i%9)/9,attackKind:semis[i%3],guarding:i%10===0,dodgeRemaining:i%29===0?.15:0,hitStaggerRemaining:i%37===0?.2:0,...overrides};}
function finiteTree(v){if(typeof v==='number')assert.equal(Number.isFinite(v),true);if(v&&typeof v==='object')for(const child of Object.values(v))finiteTree(child);}

for(let i=0;i<600;i+=1){const input=sample(i);const p=resolvePlayerLocomotionAnticipationProfile(input);assert.equal(validatePlayerLocomotionAnticipationProfile(p).ok,true);finiteTree(p);const request=resolvePlayerLocomotionAnimationRequest(input);assert.equal(validatePlayerLocomotionAnimationRequest(request).ok,true);assert.equal(Object.keys(request.channels).length,17);const foot=resolvePlayerLocomotionFootContactPresentation({phase:p.phase,speedMps:p.speedMps,playbackRate:p.playbackRate,cadenceScale:p.cadenceBias,surfaceConfidence:p.surfaceConfidence,groundedConfidence:p.contact.plant,surfaceSlip:p.surfaceSlip});assert.equal(validatePlayerLocomotionFootContactPresentation(foot).ok,true);const window=resolvePlayerLocomotionTemporalWindow('cruise',p.mode,{confidence:p.confidence,groundRisk:p.groundRisk,speedDeltaMps:p.speedDeltaMps});assert.ok(window>=.04&&window<=.46);const temporal=resolvePlayerLocomotionTemporalSample({elapsedSeconds:window*.5,windowSeconds:window,mode:p.mode,confidence:p.confidence});assert.ok(temporal.progress>=0&&temporal.progress<=1);const transition=resolvePlayerLocomotionTransitionEnvelope('cruise',p.mode,{surfaceSlip:p.surfaceSlip,groundRisk:p.groundRisk});assert.equal(validatePlayerLocomotionTransitionEnvelope(transition).ok,true);}

for(const [name,confidence,slip] of surfaces){for(let speed=0;speed<=12;speed+=.5){for(let turn=0;turn<=540;turn+=60){const p=resolvePlayerLocomotionAnticipationProfile(sample(speed+turn,{planarSpeedMps:speed,turnRateDegreesPerSecond:turn,surfaceConfidence:confidence,surfaceSlip:slip,slopeDegrees:name==='steep'||name==='unstable'?45:10}));assert.ok(p.playbackRate>=.72&&p.playbackRate<=1.35);assert.ok(p.groundRisk>=0&&p.groundRisk<=1);assert.ok(p.contact.plant>=0&&p.contact.plant<=1);}}
}

let history=createPlayerLocomotionVelocityHistory();for(let i=0;i<300;i+=1){history=pushPlayerLocomotionVelocityHistory(history,sample(i,{planarSpeedMps:i%80<12?0:i%80<25?3:7,turnRateDegreesPerSecond:i%60===0?400:20}));assert.ok(history.samples.length<=24);assert.ok(Number.isFinite(history.smoothedSpeed));assert.ok(Number.isFinite(history.smoothedAcceleration));assert.ok(Number.isFinite(history.smoothedTurnRate));const prediction=resolvePlayerLocomotionHistoryPrediction(history,.18);const stability=resolvePlayerLocomotionHistoryStability(history);assert.ok(prediction.speedMps>=0&&prediction.speedMps<=12);assert.ok(stability.score>=0&&stability.score<=1);}

const edgeInputs=[sample(1,{planarSpeedMps:0}),sample(2,{planarSpeedMps:.18}),sample(3,{planarSpeedMps:.35}),sample(4,{planarSpeedMps:1.1}),sample(5,{planarSpeedMps:5.1}),sample(6,{planarSpeedMps:5.6}),sample(7,{planarSpeedMps:12}),sample(8,{slopeDegrees:55}),sample(9,{turnRateDegreesPerSecond:540}),sample(10,{surfaceConfidence:0,surfaceSlip:1})];
for(const input of edgeInputs){const p=resolvePlayerLocomotionAnticipationProfile(input);assert.equal(validatePlayerLocomotionAnticipationProfile(p).ok,true);const request=resolvePlayerLocomotionAnimationRequest(input);assert.equal(validatePlayerLocomotionAnimationRequest(request).ok,true);}

const malformed=[{planarSpeedMps:NaN},{planarSpeedMps:Infinity},{slopeDegrees:-Infinity},{turnRateDegreesPerSecond:NaN},{deltaSeconds:Infinity},{surfaceConfidence:Infinity},{surfaceSlip:-Infinity},{velocity:{x:Infinity,y:NaN},facing:{x:NaN,y:Infinity}}];
for(const bad of malformed){const p=resolvePlayerLocomotionAnticipationProfile(sample(20,bad));finiteTree(p);assert.equal(validatePlayerLocomotionAnticipationProfile(p).ok,true);}

console.log('PLAYER_LOCOMOTION_ANTICIPATION_SCENARIO_MATRIX_PASS');
