import assert from 'node:assert/strict';
import { resolvePlayerLocomotionStateIntent, PLAYER_LOCOMOTION_STATE_STATES } from '../src/3d/gameplay/playerLocomotionStateSynthesis.js';

function check(name,input,expected) {
  const intent=resolvePlayerLocomotionStateIntent({velocity:{x:0,y:1},facing:{x:0,y:1},deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0,grounded:true,...input});
  assert.equal(intent.validation.ok,true,`${name}:validation`);
  assert.ok(PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state),`${name}:state`);
  if (expected) assert.equal(intent.state,expected,`${name}:expected`);
  return intent;
}

check('case-000',{planarSpeedMps:0},'idle');
check('case-001',{planarSpeedMps:0.1},'idle');
check('case-002',{planarSpeedMps:0.4},'start');
check('case-003',{planarSpeedMps:0.8},'start');
check('case-004',{planarSpeedMps:1.6},'accelerate');
check('case-005',{planarSpeedMps:3.2},'accelerate');
check('case-006',{planarSpeedMps:5.2},'accelerate');
check('case-007',{planarSpeedMps:6.2},'cruise');
check('case-008',{planarSpeedMps:0,turnRateDegreesPerSecond:90},'turn-in-place');
check('case-009',{planarSpeedMps:0,turnRateDegreesPerSecond:180},'turn-in-place');
check('case-010',{planarSpeedMps:4.2,velocity:{x:1,y:0},turnRateDegreesPerSecond:180});
check('case-011',{planarSpeedMps:4.2,velocity:{x:-1,y:0},turnRateDegreesPerSecond:180});
check('case-012',{planarSpeedMps:4.2,velocity:{x:0,y:-1}} ,'reverse');
check('case-013',{planarSpeedMps:3.5,guarding:true},'guard-walk');
check('case-014',{planarSpeedMps:3.5,dodgeRemaining:0.2},'dodge-recover');
check('case-015',{planarSpeedMps:3.5,hitStaggerRemaining:0.2},'stagger-recover');
check('case-016',{planarSpeedMps:3.5,attackKind:'light'},'combat-advance');
check('case-017',{planarSpeedMps:1.2,attackKind:'light'},'recover');
check('case-018',{planarSpeedMps:4.8,attackKind:'heavy'},'combat-advance');
check('case-019',{planarSpeedMps:4,grounded:false,airTimeSeconds:0.2},'airborne');
check('case-020',{planarSpeedMps:2,grounded:true,airTimeSeconds:0.2,landingImpactMps:2},'landing-soft');
check('case-021',{planarSpeedMps:2,grounded:true,airTimeSeconds:0.4,landingImpactMps:6},'landing-hard');
check('case-022',{planarSpeedMps:2,surfaceSlip:0.8},'slippery-step');
check('case-023',{planarSpeedMps:2,surfaceConfidence:0.2},'contact-recover');
check('case-024',{planarSpeedMps:2,traversalWeight:0.9,traversalForwardDistance:3,traversalHeight:0.3},'traversal-prepare');
check('case-025',{planarSpeedMps:2,traversalWeight:0.9,traversalForwardDistance:1,traversalHeight:0.3},'traversal-clear');
check('case-026',{planarSpeedMps:2,traversalWeight:0.9,traversalBlocked:true},'traversal-blocked');
check('case-027',{planarSpeedMps:1,gameplayOverride:'pivot'},'pivot');
check('case-028',{planarSpeedMps:1,gameplayOverride:'guard'},'guard-walk');
check('case-029',{planarSpeedMps:1,gameplayOverride:'dodge'},'dodge-recover');
check('case-030',{planarSpeedMps:1,gameplayOverride:'stagger'},'stagger-recover');
check('case-031',{planarSpeedMps:1,gameplayOverride:'air'},'airborne');
check('case-032',{planarSpeedMps:1,gameplayOverride:'land'},'landing-soft');
check('case-033',{planarSpeedMps:1,gameplayOverride:'traverse'},'traversal-prepare');
check('case-034',{planarSpeedMps:1,gameplayOverride:'blocked'},'traversal-blocked');

const generated=[];
for(let speedIndex=0;speedIndex<60;speedIndex+=1){
  const speed=speedIndex/10;
  generated.push(check(`speed-${speedIndex}`,{planarSpeedMps:speed,turnRateDegreesPerSecond:(speedIndex%12)*45,slopeDegrees:(speedIndex%11)*5-25,surfaceSlip:(speedIndex%9)/10,surfaceConfidence:0.4+(speedIndex%7)/10}));
}
for(let angleIndex=0;angleIndex<64;angleIndex+=1){
  const angle=-Math.PI+angleIndex*Math.PI/32;
  generated.push(check(`angle-${angleIndex}`,{planarSpeedMps:2+angleIndex/16,velocity:{x:Math.sin(angle),y:Math.cos(angle)},facing:{x:Math.cos(angle),y:Math.sin(angle)},turnRateDegreesPerSecond:(angleIndex%9)*60}));
}
for(let slopeIndex=0;slopeIndex<56;slopeIndex+=1){
  generated.push(check(`slope-${slopeIndex}`,{planarSpeedMps:1+slopeIndex/10,slopeDegrees:slopeIndex-28,surfaceConfidence:0.6+(slopeIndex%5)/10}));
}
for(let slipIndex=0;slipIndex<48;slipIndex+=1){
  generated.push(check(`slip-${slipIndex}`,{planarSpeedMps:1.2+slipIndex/12,surfaceSlip:slipIndex/47,surfaceConfidence:1-slipIndex/94}));
}
for(let traversalIndex=0;traversalIndex<60;traversalIndex+=1){
  generated.push(check(`traversal-${traversalIndex}`,{planarSpeedMps:1+traversalIndex/20,traversalWeight:(traversalIndex%11)/10,traversalForwardDistance:(traversalIndex%9)/2,traversalHeight:(traversalIndex%13)/4-1.5,traversalBlocked:traversalIndex%13===0}));
}
for(let landingIndex=0;landingIndex<48;landingIndex+=1){
  generated.push(check(`landing-${landingIndex}`,{planarSpeedMps:1+landingIndex/30,grounded:true,airTimeSeconds:landingIndex/20,landingImpactMps:landingIndex/8}));
}
for(let semanticIndex=0;semanticIndex<72;semanticIndex+=1){
  const semantic=semanticIndex%6;
  const input=semantic===0?{planarSpeedMps:2,guarding:true}:semantic===1?{planarSpeedMps:2,dodgeRemaining:0.2}:semantic===2?{planarSpeedMps:2,attackKind:'light'}:semantic===3?{planarSpeedMps:5,attackKind:'heavy'}:semantic===4?{planarSpeedMps:2,hitStaggerRemaining:0.2}:{planarSpeedMps:0};
  generated.push(check(`semantic-${semanticIndex}`,input));
}
for(let overrideIndex=0;overrideIndex<72;overrideIndex+=1){
  const overrides=['idle','start','accelerate','cruise','brake','stop','strafe','reverse','pivot','recover','turn-in-place','combat-advance','combat-retreat','guard-walk','dodge-recover','stagger-recover'];
  generated.push(check(`override-${overrideIndex}`,{planarSpeedMps:3,gameplayOverride:overrides[overrideIndex%overrides.length]}));
}

for(let corpusIndex=0;corpusIndex<200;corpusIndex+=1){
  const input={
    planarSpeedMps:(corpusIndex%121)/10,
    turnRateDegreesPerSecond:(corpusIndex*47)%541,
    slopeDegrees:(corpusIndex*13)%111-55,
    surfaceSlip:(corpusIndex%23)/22,
    surfaceConfidence:0.3+(corpusIndex%8)/10,
    grounded:corpusIndex%19!==0,
    airTimeSeconds:corpusIndex%19===0?(corpusIndex%10)/10:0,
    landingImpactMps:corpusIndex%17===0?(corpusIndex%9):0,
    traversalWeight:(corpusIndex%7)/6,
    traversalForwardDistance:(corpusIndex%15)/2,
    traversalHeight:(corpusIndex%11)/3-1.6,
    traversalBlocked:corpusIndex%29===0,
    footPlantConfidence:(corpusIndex%10)/10,
    footContactPhase:(corpusIndex%20)/19,
    rootMotionAllowed:corpusIndex%3!==0,
  };
  generated.push(check(`corpus-${corpusIndex}`,input));
}

assert.ok(generated.length>600);
assert.ok(generated.every(item=>PLAYER_LOCOMOTION_STATE_STATES.includes(item.state)));
console.log(`PLAYER_LOCOMOTION_STATE_SYNTHESIS_SCENARIO_MATRIX_PASS:${generated.length}`);
