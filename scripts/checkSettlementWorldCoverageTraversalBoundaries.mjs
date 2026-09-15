import assert from 'node:assert/strict';
import { createSettlementWorldCoverageTraversalCoordinator } from '../src/3d/gameplay/settlementWorldCoverageTraversalCoordinator.js';
import { createSettlementWorldCoverageTraversalRoute } from '../src/3d/gameplay/settlementWorldCoverageTraversalRoute.js';
import { createSettlementWorldCoverageTraversalRisk } from '../src/3d/gameplay/settlementWorldCoverageTraversalRisk.js';
import { createSettlementWorldCoverageTraversalMilestones } from '../src/3d/gameplay/settlementWorldCoverageTraversalMilestones.js';
import { createSettlementWorldCoverageTraversalReplay } from '../src/3d/gameplay/settlementWorldCoverageTraversalReplay.js';
const settlement={id:'boundary-test',regionId:'the-north',anchor:{x:512,y:0,z:768},entrance:{x:518,y:0,z:768},services:['gate','market','tavern','house']};
const base={settlement,player:{position:{x:512,y:0,z:768},inSettlement:false,fatigue:0,health:100},surface:{biome:'north-temperate',layer:'road',slopeDegrees:0},seed:19,hour:12,weather:{type:'clear',intensity:0,visibility:1},roadClass:'gateway'};
const positions=[
{x:512,z:768},{x:548,z:768},{x:662,z:768},{x:362,z:768},{x:512,z:918},{x:512,z:618},
{x:476,z:768},{x:548,z:804},{x:620,z:840},{x:700,z:900},
];
for(const [index,position] of positions.entries()){
  const result=createSettlementWorldCoverageTraversalCoordinator({...base,player:{...base.player,position}});
  assert.ok(result.confidence>=0);
  assert.ok(result.confidence<=1);
  assert.ok(result.risk.score>=0);
  assert.ok(result.risk.score<=1);
  assert.equal(result.ownership.readOnly,true);
  assert.equal(result.ownership.noActorSpawn,true);
  assert.equal(typeof result.fingerprint,'string');
  assert.ok(result.signals.length<=4);
  assert.ok(result.stage);
  assert.ok(result.state);
  assert.ok(index>=0);
}
const modes=['safe','direct','service','return','explore'];
for(const mode of modes){
  const route=createSettlementWorldCoverageTraversalRoute({...base,routeMode:mode},mode);
  assert.equal(route.mode,mode);
  assert.ok(route.alternatives.length<=5);
  assert.ok(route.risk.score>=0);
  assert.ok(route.risk.score<=1);
  assert.equal(route.ownership.readOnly,true);
}
const risks=[
  {surface:{slopeDegrees:0},weather:{type:'clear',intensity:0,visibility:1}},
  {surface:{slopeDegrees:10},weather:{type:'rain',intensity:.4,visibility:.7}},
  {surface:{slopeDegrees:20},weather:{type:'fog',intensity:.7,visibility:.45}},
  {surface:{slopeDegrees:30},weather:{type:'snow',intensity:.7,visibility:.4}},
  {surface:{slopeDegrees:40,isWater:true,layer:'shore'},weather:{type:'storm',intensity:.95,visibility:.2}},
];
for(const sample of risks){
  const risk=createSettlementWorldCoverageTraversalRisk({...base,surface:{...base.surface,...sample.surface},weather:sample.weather});
  assert.ok(risk.risk>=0);
  assert.ok(risk.risk<=1);
  assert.ok(['normal','warning','critical'].includes(risk.severity));
}
const milestones=createSettlementWorldCoverageTraversalMilestones(base);
assert.equal(milestones.markers.length,10);
assert.equal(milestones.recoverable.length<=4,true);
assert.equal(milestones.ownership.readOnly,true);
const replay=createSettlementWorldCoverageTraversalReplay(base,[
  {index:0,stage:'far',phase:'orient',lane:'gateway',risk:.2,milestone:'world-seen',pacing:'steady',primarySignals:['navigate'],readiness:.4},
  {index:1,stage:'approach',phase:'commit',lane:'gateway',risk:.25,milestone:'approach-start',pacing:'steady',primarySignals:['navigate'],readiness:.6},
]);
assert.equal(replay.frameCount,3);
assert.equal(replay.frames.at(-1).stage,'threshold');
assert.equal(replay.ownership.readOnly,true);
const malformedInputs=[
  {player:null},
  {settlement:null},
  {surface:null},
  {hour:Number.NaN},
  {hour:Number.POSITIVE_INFINITY},
  {seed:Number.NaN},
  {player:{position:null}},
  {player:{fatigue:Number.POSITIVE_INFINITY}},
  {player:{health:Number.NaN}},
  {routeMode:null},
];
for(const malformed of malformedInputs){
  const result=createSettlementWorldCoverageTraversalCoordinator({...base,...malformed});
  assert.ok(result.confidence>=0&&result.confidence<=1);
  assert.ok(result.risk.score>=0&&result.risk.score<=1);
  assert.equal(result.ownership.readOnly,true);
}
for(const count of [0,1,2,4,8,10,12,16,24]){
  const result=createSettlementWorldCoverageTraversalCoordinator({...base,player:{...base.player,position:{x:512+count,z:768}}});
  assert.ok(result.signals.length<=4);
  assert.ok(result.confidence>=0&&result.confidence<=1);
}
const mobile=createSettlementWorldCoverageTraversalCoordinator({...base,mobile:true});
const desktop=createSettlementWorldCoverageTraversalCoordinator({...base,mobile:false});
assert.equal(mobile.mobile,true);
assert.equal(desktop.mobile,false);
assert.ok(mobile.confidence>=0&&mobile.confidence<=1);
assert.ok(desktop.confidence>=0&&desktop.confidence<=1);
assert.equal(createSettlementWorldCoverageTraversalCoordinator(base).fingerprint,createSettlementWorldCoverageTraversalCoordinator(JSON.parse(JSON.stringify(base))).fingerprint);
console.log('Settlement World Coverage Traversal Boundaries: PASS');
