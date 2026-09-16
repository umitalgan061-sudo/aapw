import assert from 'node:assert/strict';
import { auditFaunaAmbientLifePlan, planFaunaAmbientLife } from '../src/3d/gameplay/livingWorldFaunaAmbientLifePolicy.js';
const input={seed:'ambient-proof',world:{tick:42,hour:19,weatherPressure:0.22},playerPosition:{x:0,z:0},actors:[
{id:'wolf-2',species:'wolf',role:'predator',position:{x:38,z:4},threatLevel:0.7,groundValid:true,navReachable:true},
{id:'deer-1',species:'deer',role:'grazer',position:{x:96,z:10},nearWater:true,groundValid:true,navReachable:true},
{id:'hawk-1',species:'hawk',role:'avian',position:{x:160,z:-12},groundValid:true,navReachable:true},
{id:'cliff-goat',species:'goat',role:'grazer',position:{x:20,z:1},groundValid:false,navReachable:true}]};
const left=planFaunaAmbientLife(input); const right=planFaunaAmbientLife({...input,actors:[...input.actors].reverse()});
assert.deepEqual(left,right); assert.equal(left.accepted,true); assert.equal(left.intents.length,3);
assert.deepEqual(left.intents.map((x)=>x.actorId),['deer-1','hawk-1','wolf-2']);
assert(left.intents.every((x)=>x.assetFirst===true));
assert(left.intents.every((x)=>x.placement.materialContract.endsWith('MaterialAssignmentCore.js')));
assert(left.intents.every((x)=>x.placement.placementContract.endsWith('WorldAssetPlacementPipeline.js')));
assert.equal(auditFaunaAmbientLifePlan(left).ok,true);
assert.equal(left.intents.find((x)=>x.actorId==='wolf-2').activity,'howl');
assert.equal(left.intents.find((x)=>x.actorId==='deer-1').activity,'drink');
const far=planFaunaAmbientLife({seed:'ambient-proof',world:{tick:42,hour:12},playerPosition:{x:0,z:0},actors:[{id:'far-fox',species:'fox',position:{x:999,z:999}}]});
assert.equal(far.intents.length,0);
console.log('SAFAK_KARTALI_FAUNA_AMBIENT_LIFE_OK');
