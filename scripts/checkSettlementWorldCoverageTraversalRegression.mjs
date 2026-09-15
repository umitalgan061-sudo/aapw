import assert from 'node:assert/strict';
import { createSettlementWorldCoverageTraversalCoordinator } from '../src/3d/gameplay/settlementWorldCoverageTraversalCoordinator.js';
import { createSettlementWorldCoverageTraversalRoute } from '../src/3d/gameplay/settlementWorldCoverageTraversalRoute.js';
import { createSettlementWorldCoverageTraversalRisk } from '../src/3d/gameplay/settlementWorldCoverageTraversalRisk.js';
import { createSettlementWorldCoverageTraversalPacing } from '../src/3d/gameplay/settlementWorldCoverageTraversalPacing.js';
import { createSettlementWorldCoverageTraversalSignals } from '../src/3d/gameplay/settlementWorldCoverageTraversalSignals.js';
import { createSettlementWorldCoverageTraversalReplay } from '../src/3d/gameplay/settlementWorldCoverageTraversalReplay.js';
import { createSettlementWorldCoverageTraversalAccessibility } from '../src/3d/gameplay/settlementWorldCoverageTraversalAccessibility.js';

const settlement={id:'winterfell-edge',regionId:'the-north',anchor:{x:512,y:0,z:768},entrance:{x:518,y:0,z:768},services:['gate','market','tavern','blacksmith','stable','house']};
const base={settlement,player:{position:{x:545,y:0,z:768},inSettlement:false,fatigue:15,health:100},surface:{biome:'north-temperate',layer:'road',slopeDegrees:2},seed:77,hour:15,weather:{type:'clear',intensity:.1,visibility:.95},roadClass:'gateway'};

const normal=createSettlementWorldCoverageTraversalCoordinator(base);
const fog=createSettlementWorldCoverageTraversalCoordinator({...base,weather:{type:'fog',intensity:.9,visibility:.2}});
const fatigue=createSettlementWorldCoverageTraversalPacing({...base,player:{...base.player,fatigue:92}});
const safe=createSettlementWorldCoverageTraversalRoute(base,'safe');
const direct=createSettlementWorldCoverageTraversalRoute(base,'direct');
const service=createSettlementWorldCoverageTraversalRoute({...base,player:{...base.player,inSettlement:true},routeMode:'service'},'service');
const risk=createSettlementWorldCoverageTraversalRisk({...base,surface:{...base.surface,slopeDegrees:35}});
const signals=createSettlementWorldCoverageTraversalSignals({...base,weather:{type:'storm',intensity:.95,visibility:.3}});
const replay=createSettlementWorldCoverageTraversalReplay(base);
const a11y=createSettlementWorldCoverageTraversalAccessibility(base,'low-motion');

assert.equal(normal.ownership.readOnly,true);
assert.ok(normal.confidence>=0&&normal.confidence<=1);
assert.ok(fog.confidence<normal.confidence || fog.risk.score>=normal.risk.score);
assert.equal(fatigue.state,'recover');
assert.ok(safe.risk.score>=0&&safe.risk.score<=1);
assert.ok(direct.alternatives.length<=5);
assert.ok(service.destination!==null);
assert.ok(risk.risk>0);
assert.ok(signals.primary.length<=4);
assert.ok(signals.signals.length<=12);
assert.ok(replay.frameCount===1);
assert.equal(replay.latest.stage,normal.stage);
assert.equal(a11y.ui.animate,false);

const modes=['safe','direct','service','return','explore'];
for(const mode of modes){
  const route=createSettlementWorldCoverageTraversalRoute(base,mode);
  assert.ok(route.chosenLane===null||typeof route.chosenLane==='string');
  assert.ok(route.alternatives.length<=5);
  assert.ok(route.risk.score>=0&&route.risk.score<=1);
}

for(const weather of ['clear','cloud','fog','rain','snow','storm','wind','sleet']){
  const result=createSettlementWorldCoverageTraversalCoordinator({...base,weather:{type:weather,intensity:.5,visibility:.65}});
  assert.ok(result.risk.score>=0);
  assert.ok(result.risk.score<=1);
  assert.ok(result.confidence>=0);
  assert.ok(result.confidence<=1);
}

for(const slopeDegrees of [0,2,5,10,20,30,40]){
  const result=createSettlementWorldCoverageTraversalRisk({...base,surface:{...base.surface,slopeDegrees}});
  assert.ok(result.risk>=0&&result.risk<=1);
}

for(const fatigueValue of [0,25,50,75,100]){
  const result=createSettlementWorldCoverageTraversalPacing({...base,player:{...base.player,fatigue:fatigueValue}});
  assert.ok(result.rate>=0&&result.rate<=1);
  assert.ok(result.fatigue>=0&&result.fatigue<=1);
}

for(const mode of ['standard','high-contrast','low-motion','screen-reader','compact']){
  const result=createSettlementWorldCoverageTraversalAccessibility(base,mode);
  assert.ok(result.ui.maxVisibleSignals>=1&&result.ui.maxVisibleSignals<=12);
  assert.ok(typeof result.fingerprint==='string');
}

const mobile=createSettlementWorldCoverageTraversalCoordinator({...base,mobile:true});
assert.equal(mobile.mobile,true);
assert.ok(mobile.signals.length<=4);

const inside=createSettlementWorldCoverageTraversalCoordinator({...base,player:{...base.player,position:{x:512,z:768},inSettlement:true}});
assert.equal(inside.stage,'inside');
assert.ok(['interact','arrive','recover','traverse','depart','commit','orient','prepare'].includes(inside.state));

const blocked=createSettlementWorldCoverageTraversalCoordinator({...base,player:{...base.player,settlementOpen:false}});
assert.ok(['observe','navigate','pause','return','service','enter'].includes(blocked.action));

const defeated=createSettlementWorldCoverageTraversalCoordinator({...base,player:{...base.player,health:0,inSettlement:true}});
assert.equal(defeated.ownership.readOnly,true);

const clone=JSON.parse(JSON.stringify(base));
assert.equal(createSettlementWorldCoverageTraversalCoordinator(base).fingerprint,createSettlementWorldCoverageTraversalCoordinator(clone).fingerprint);
assert.equal(createSettlementWorldCoverageTraversalReplay(base).fingerprint,createSettlementWorldCoverageTraversalReplay(clone).fingerprint);

let mutationBlocked=false;
try{normal.action='mutate';}catch{mutationBlocked=true;}
assert.equal(mutationBlocked||normal.action!=='mutate',true);

console.log('Settlement World Coverage Traversal Regression: PASS');
console.log(JSON.stringify({ok:true,stage:normal.stage,state:normal.state,action:normal.action,topLane:normal.lane,risk:normal.risk.score,signals:normal.signals.length,replay:replay.fingerprint}));
