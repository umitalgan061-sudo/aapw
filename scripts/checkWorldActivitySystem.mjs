import assert from 'node:assert/strict';
import { createWorldActivityContext, validateWorldActivityContext, replayWorldActivityContext } from '../src/3d/gameplay/worldActivityContext.js';
import { createWorldActivityCadence, validateWorldActivityCadence } from '../src/3d/gameplay/worldActivityCadence.js';
import { createWorldActivitySchedule, validateWorldActivitySchedule } from '../src/3d/gameplay/worldActivityScheduler.js';
import { createWorldShelterContext, validateWorldShelterContext } from '../src/3d/gameplay/worldShelterContext.js';
import { createWorldJourneyActivity, validateWorldJourneyActivity } from '../src/3d/gameplay/worldJourneyActivity.js';
import { createWorldActivityEvidence, validateWorldActivityEvidence, validateWorldActivityRules } from '../src/3d/gameplay/worldActivityEvidence.js';
import { createWorldActivityAccessibility, validateWorldActivityAccessibility } from '../src/3d/gameplay/worldActivityAccessibility.js';
import { createWorldActivityDirector, validateWorldActivityDirector, replayWorldActivityDirector } from '../src/3d/gameplay/worldActivityDirector.js';

const settlement={id:'winterfell-edge',regionId:'the-north',anchor:{x:512,y:0,z:768},entrance:{x:520,y:0,z:768},services:['gate','market','tavern','blacksmith','farm','barracks','stable','house']};
const base={settlement,player:{position:{x:548,y:0,z:768},inSettlement:false,fatigue:28,health:100},surface:{biome:'north-temperate',layer:'road',slopeDegrees:2},seed:77,hour:15,weather:{type:'clear'},roadClass:'gateway'};
const weather=['clear','cloud','fog','rain','snow','storm','wind','sleet'];
const hours=[5,7,9,12,15,18,21,23];
for(const type of weather){for(const hour of hours){for(const mobile of [false,true]){const options={...base,weather:{type},hour,mobile};const context=createWorldActivityContext(options);assert.equal(validateWorldActivityContext(context).ok,true);const cadence=createWorldActivityCadence(options);assert.equal(validateWorldActivityCadence(cadence).ok,true);const schedule=createWorldActivitySchedule(options);assert.equal(validateWorldActivitySchedule(schedule).ok,true);const shelter=createWorldShelterContext(options);assert.equal(validateWorldShelterContext(shelter).ok,true);const journey=createWorldJourneyActivity(options);assert.equal(validateWorldJourneyActivity(journey).ok,true);const evidence=createWorldActivityEvidence(options);assert.equal(validateWorldActivityEvidence(evidence).ok,true);const accessibility=createWorldActivityAccessibility(options,'high-contrast');assert.equal(validateWorldActivityAccessibility(accessibility).ok,true);const director=createWorldActivityDirector(options);assert.equal(validateWorldActivityDirector(director).ok,true);assert.ok(director.actions.length<=8);assert.ok(director.signals.length<=8);}}}
assert.equal(validateWorldActivityRules().ok,true);
assert.equal(replayWorldActivityContext(base).ok,true);
assert.equal(replayWorldActivityDirector(base).ok,true);
const storm=createWorldActivityDirector({...base,weather:{type:'storm'},hour:18});assert.ok(['caution','shelter','recover','travel'].includes(storm.state));assert.ok(storm.signals.length>0);
const tired=createWorldActivityDirector({...base,player:{...base.player,fatigue:95}});assert.ok(tired.focus.length>0);
const blocked=createWorldActivityDirector({...base,player:{...base.player,settlementOpen:false}});assert.ok(blocked.state.length>0);
const nullSafe=createWorldActivityDirector({...base,player:null,surface:null,hour:Infinity});assert.equal(validateWorldActivityDirector(nullSafe).ok,true);
assert.equal(Object.isFrozen(storm),true);assert.equal(Object.isFrozen(storm.actions),true);assert.equal(Object.isFrozen(tired.signals),true);
for(const mode of ['standard','high-contrast','low-motion','screen-reader','compact']){const a=createWorldActivityAccessibility(base,mode);assert.equal(a.mode,mode);assert.ok(a.cues.length<=8);assert.equal(validateWorldActivityAccessibility(a).ok,true);if(mode==='screen-reader')assert.equal(a.spokenCues.length,a.cues.length);}
console.log('World Activity System: PASS');
console.log(JSON.stringify({ok:true,weathers:weather.length,hours:hours.length,mobileScales:2,modeStates:[storm.state,tired.state,blocked.state],stormTop:storm.actions[0]?.type??null,stormFocus:storm.focus,fingerprint:storm.fingerprint}));
