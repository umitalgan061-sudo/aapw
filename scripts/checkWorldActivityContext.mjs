import assert from 'node:assert/strict';
import { createWorldActivityContext, validateWorldActivityContext, replayWorldActivityContext } from '../src/3d/gameplay/worldActivityContext.js';
const settlement={id:'winterfell-edge',regionId:'the-north',anchor:{x:512,y:0,z:768},entrance:{x:520,y:0,z:768},services:['gate','market','tavern','blacksmith','farm','stable','house']};
const base={settlement,player:{position:{x:548,y:0,z:768},inSettlement:false,fatigue:20},surface:{biome:'north-temperate',layer:'road',slopeDegrees:2},seed:77,hour:15,weather:{type:'clear'},roadClass:'gateway'};
const cases=[
 ['clear',15,false],['clear',22,false],['cloud',10,false],['fog',10,false],['rain',13,false],['snow',12,false],['storm',18,false],['wind',9,false],['sleet',19,false],
 ['clear',15,true],['fog',10,true],['storm',18,true],['snow',6,true],['rain',21,true],
];
for(const [weather,hour,mobile] of cases){const ctx=createWorldActivityContext({...base,hour,mobile,weather:{type:weather}});assert.equal(validateWorldActivityContext(ctx).ok,true);assert.ok(ctx.activities.length<=12);assert.ok(ctx.signals.length<=10);assert.ok(ctx.activities.every(x=>x.score>=0&&x.score<=1));assert.ok(ctx.activities.every(x=>x.distanceMeters>=0&&x.distanceMeters<=240));}
const replay=replayWorldActivityContext(base);assert.equal(replay.ok,true);assert.equal(replay.firstFingerprint,replay.secondFingerprint);
const storm=createWorldActivityContext({...base,weather:{type:'storm'},hour:18});assert.ok(storm.signals.some(x=>x.type==='weather'));assert.ok(storm.activities.some(x=>x.type==='warning'));
const snow=createWorldActivityContext({...base,weather:{type:'snow'},hour:22});assert.ok(snow.activities.some(x=>x.type==='rest'));
const malformed=createWorldActivityContext({...base,hour:Infinity,player:null,surface:null});assert.equal(validateWorldActivityContext(malformed).ok,true);
assert.equal(Object.isFrozen(malformed),true);assert.equal(malformed.ownership.noWorldMutation,true);
console.log('World Activity Context: PASS');
console.log(JSON.stringify({ok:true,cases:cases.length,replay:replay.ok,stormTop:storm.topActivity,snowTop:snow.topActivity,malformed:malformed.fingerprint}));
