import assert from 'node:assert/strict';
import {
  auditPlayerLocomotionProfiles,
  listPlayerLocomotionAnticipationProfiles,
  resolvePlayerLocomotionAnticipationProfileConfig,
  mergePlayerLocomotionAnticipationProfileConfig,
  applyPlayerLocomotionAnticipationProfile,
  resolvePlayerLocomotionProfileBlend,
  resolvePlayerLocomotionBlendedConfig,
  resolvePlayerLocomotionContextProfile,
  resolvePlayerLocomotionProfileMetadata,
  validatePlayerLocomotionProfileConfig,
} from '../src/3d/gameplay/playerLocomotionAnticipationProfiles.js';

function finiteTree(value){if(typeof value==='number')assert.equal(Number.isFinite(value),true);if(value&&typeof value==='object')for(const child of Object.values(value))finiteTree(child);}
function sample(index=0){const a=index*Math.PI/8;return{velocity:{x:Math.sin(a),y:Math.cos(a)},facing:{x:0,y:1},planarSpeedMps:0.5+(index%10)*0.63,slopeDegrees:index%12*4,turnRateDegreesPerSecond:index%11*47,deltaSeconds:1/60,surfaceConfidence:(index%10)/10,surfaceSlip:(index%6)/6};}

const audit=auditPlayerLocomotionProfiles();
assert.equal(audit.valid,true);assert.equal(audit.immutable,true);assert.equal(audit.count,8);
const names=listPlayerLocomotionAnticipationProfiles();
assert.deepEqual(names,['default','agile','heavy','scout','armored','slippery','cautious','evasive']);
for(const name of names){const config=resolvePlayerLocomotionAnticipationProfileConfig(name);assert.equal(config.key,name);assert.equal(validatePlayerLocomotionProfileConfig(config).ok,true);assert.equal(Object.isFrozen(config),true);const metadata=resolvePlayerLocomotionProfileMetadata(name);assert.equal(metadata.key,name);assert.equal(metadata.version,'2026-09-15-v1');}

const override=mergePlayerLocomotionAnticipationProfileConfig('agile',{accelerationBias:99,brakeBias:-2,pivotBias:NaN,contactBias:0.8,lookAheadBias:1.4,confidenceBias:1});
assert.ok(override.accelerationBias<=1.4);assert.ok(override.brakeBias>=0.6);assert.ok(override.pivotBias>=0.6);assert.equal(validatePlayerLocomotionProfileConfig(override).ok,true);

for(let index=0;index<360;index+=1){for(const name of names){const result=applyPlayerLocomotionAnticipationProfile(sample(index),name);assert.equal(result.profileKey,name);assert.ok(result.startWeight>=0&&result.startWeight<=1);assert.ok(result.brakeWeight>=0&&result.brakeWeight<=1);assert.ok(result.pivotWeight>=0&&result.pivotWeight<=1);assert.ok(result.lookAheadSeconds>=0.05&&result.lookAheadSeconds<=0.35);assert.ok(result.confidence>=0&&result.confidence<=1);assert.ok(result.contact.plant>=0&&result.contact.plant<=1);finiteTree(result);}}

for(let index=0;index<100;index+=1){const weights={agile:(index%7)+1,heavy:(100-index)+1,scout:index%3,cautious:index%5};const blend=resolvePlayerLocomotionProfileBlend(weights);const sum=Object.values(blend).reduce((a,b)=>a+b,0);assert.ok(Math.abs(sum-1)<0.001);assert.ok(Object.keys(blend).every((key)=>names.includes(key)));const config=resolvePlayerLocomotionBlendedConfig(blend);assert.ok(config.accelerationBias>=0.6&&config.accelerationBias<=1.4);assert.ok(config.brakeBias>=0.6&&config.brakeBias<=1.5);assert.ok(config.pivotBias>=0.6&&config.pivotBias<=1.5);assert.ok(config.contactBias>=0.6&&config.contactBias<=1.3);}

assert.deepEqual(resolvePlayerLocomotionProfileBlend({}),{default:1});
for(const context of [
 {archetype:'agile',surfaceRisk:0,combatPressure:0,staminaPressure:0},
 {archetype:'heavy',surfaceRisk:1,combatPressure:1,staminaPressure:1},
 {archetype:'missing',surfaceRisk:Infinity,combatPressure:-1,staminaPressure:NaN},
]){const result=resolvePlayerLocomotionContextProfile(context);assert.equal(Object.values(result.blend).reduce((a,b)=>a+b,0),1);assert.ok(result.surfaceRisk>=0&&result.surfaceRisk<=1);assert.ok(result.combatPressure>=0&&result.combatPressure<=1);assert.ok(result.staminaPressure>=0&&result.staminaPressure<=1);finiteTree(result);}

const repeatA=Array.from({length:100},(_,i)=>applyPlayerLocomotionAnticipationProfile(sample(i),'scout'));
const repeatB=Array.from({length:100},(_,i)=>applyPlayerLocomotionAnticipationProfile(sample(i),'scout'));
assert.deepEqual(repeatA,repeatB);
console.log('PLAYER_LOCOMOTION_ANTICIPATION_PROFILES_PASS');
