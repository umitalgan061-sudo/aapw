import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYER_LOCOMOTION_STATE_STATES, PLAYER_LOCOMOTION_STATE_EVENTS, resolvePlayerLocomotionStateIntent } from '../src/3d/gameplay/playerLocomotionStateSynthesis.js';
import { PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES, auditPlayerLocomotionStateRuntime } from '../src/3d/gameplay/playerLocomotionStateRuntime.js';
import { auditPlayerLocomotionStateQuality } from '../src/3d/gameplay/playerLocomotionStateQuality.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const productionFiles=[
  '../src/3d/gameplay/playerLocomotionStateSynthesis.js',
  '../src/3d/gameplay/playerLocomotionStateTimeline.js',
  '../src/3d/gameplay/playerLocomotionStateTelemetry.js',
  '../src/3d/gameplay/playerLocomotionStateRuntime.js',
  '../src/3d/gameplay/playerLocomotionStateQuality.js',
];
const forbiddenPatterns=[
  {name:'three-import',pattern:/from ['\"]three[\/'\"]/},
  {name:'event-bus',pattern:/EventBus|eventBus/i},
  {name:'actor-registry',pattern:/ActorRegistry|actorRegistry/i},
  {name:'physics-write',pattern:/\.velocity\s*=|applyForce|setLinearVelocity|integrateVelocity/},
  {name:'movement-write',pattern:/movePlayer|setPlayerPosition|translatePlayer|setPosition/},
  {name:'camera-write',pattern:/setCamera|camera\.position\s*=|camera\.rotation\s*=/},
  {name:'navigation-write',pattern:/setPath|navigateTo|navMesh\.update|updateNavigation/},
  {name:'asset-load',pattern:/GLTFLoader|TextureLoader|loadAsync|AnimationMixer/},
  {name:'randomness',pattern:/Math\.random|crypto\.random/},
];
for(const relative of productionFiles){
  const file=path.join(root,relative);
  const content=fs.readFileSync(file,'utf8');
  assert.ok(content.length>100,`${relative}:content`);
  for(const rule of forbiddenPatterns)assert.equal(rule.pattern.test(content),false,`${relative}:${rule.name}`);
}
assert.equal(new Set(PLAYER_LOCOMOTION_STATE_STATES).size,PLAYER_LOCOMOTION_STATE_STATES.length);
assert.equal(new Set(PLAYER_LOCOMOTION_STATE_EVENTS).size,PLAYER_LOCOMOTION_STATE_EVENTS.length);
assert.equal(new Set(PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES).size,PLAYER_LOCOMOTION_STATE_RUNTIME_PHASES.length);

const clean={velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0,grounded:true};
const scenarios=[
  clean,
  {...clean,planarSpeedMps:0},
  {...clean,turnRateDegreesPerSecond:240},
  {...clean,grounded:false,airTimeSeconds:0.4},
  {...clean,landingImpactMps:6,airTimeSeconds:0.4},
  {...clean,surfaceSlip:0.9},
  {...clean,surfaceConfidence:0.2},
  {...clean,traversalWeight:0.9,traversalForwardDistance:3.4,traversalHeight:0.4},
  {...clean,traversalWeight:0.9,traversalBlocked:true},
  {...clean,attackKind:'heavy'},
  {...clean,guarding:true},
  {...clean,dodgeRemaining:0.2},
  {...clean,hitStaggerRemaining:0.2},
  {...clean,gameplayOverride:'pivot'},
  {...clean,gameplayOverride:'blocked'},
];
for(let index=0;index<scenarios.length;index+=1){
  const intent=resolvePlayerLocomotionStateIntent(scenarios[index]);
  assert.equal(intent.validation.ok,true,`scenario-${index}`);
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state));
  assert.ok(PLAYER_LOCOMOTION_STATE_EVENTS.includes(intent.event.type));
  assert.equal(typeof intent.rootMotionAllowed,'boolean');
  assert.equal(Object.isFrozen(intent),true);
  assert.equal(Object.isFrozen(intent.profile),true);
  assert.equal(Object.isFrozen(intent.direction),true);
}
const runtimeAudit=auditPlayerLocomotionStateRuntime();
assert.equal(runtimeAudit.ok,true);
const qualityAudit=auditPlayerLocomotionStateQuality();
assert.equal(qualityAudit.ok,true);

for(let index=0;index<240;index+=1){
  const intent=resolvePlayerLocomotionStateIntent({
    velocity:{x:Math.sin(index/17),y:Math.cos(index/23)},
    facing:{x:Math.cos(index/19),y:Math.sin(index/29)},
    planarSpeedMps:(index%121)/10,
    turnRateDegreesPerSecond:(index*31)%541,
    slopeDegrees:(index*5)%111-55,
    deltaSeconds:0.016,
    surfaceConfidence:0.3+(index%8)/10,
    surfaceSlip:(index%17)/16,
    grounded:index%23!==0,
    airTimeSeconds:index%23===0?0.2:0,
    landingImpactMps:index%29===0?5.8:0,
    traversalWeight:index%11===0?0.9:0,
    traversalForwardDistance:index%11===0?3.5:1,
    traversalHeight:index%13===0?0.6:0,
    traversalBlocked:index%37===0,
    rootMotionAllowed:index%3!==0,
  });
  assert.equal(intent.validation.ok,true,`stress-${index}`);
  for(const value of Object.values(intent.input))if(typeof value==='number')assert.equal(Number.isFinite(value),true,`stress-${index}-finite`);
}

console.log('PLAYER_LOCOMOTION_STATE_OWNERSHIP_PASS');
