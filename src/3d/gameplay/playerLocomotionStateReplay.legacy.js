/**
 * Deterministic replay helpers for locomotion state intent sequences.
 * Replay consumes recorded presentation inputs and never writes gameplay authority.
 */
import { resolvePlayerLocomotionStateIntent } from './playerLocomotionStateSynthesis.js';
import { resolvePlayerLocomotionStateTimelineSample } from './playerLocomotionStateTimeline.js';
import { buildPlayerLocomotionStateTelemetrySample } from './playerLocomotionStateTelemetry.js';
import { resolvePlayerLocomotionStateQualityReport } from './playerLocomotionStateQuality.js';

export const PLAYER_LOCOMOTION_STATE_REPLAY_VERSION='2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_REPLAY_MODES=Object.freeze(['fresh','resume','branch','compare']);

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function clamp01(value){return clamp(finite(value),0,1);}
function round(value,digits=4){const f=10**digits;const n=Math.round(finite(value)*f)/f;return Object.is(n,-0)?0:n;}
function freeze(value){return Object.freeze(value);}
function text(value,fallback=''){return typeof value==='string'&&value?value:fallback;}

export function createPlayerLocomotionStateReplayState(){return freeze({version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,frame:0,previousIntent:null,intents:[],timeline:[],telemetry:[],quality:[]});}

export function normalizePlayerLocomotionReplayInput(input={}){return freeze({
  velocity:input.velocity,
  facing:input.facing,
  planarSpeedMps:Math.max(0,finite(input.planarSpeedMps)),
  turnRateDegreesPerSecond:Math.max(0,finite(input.turnRateDegreesPerSecond)),
  slopeDegrees:finite(input.slopeDegrees),
  deltaSeconds:clamp(Math.max(0.001,finite(input.deltaSeconds,1/60)),0.001,0.2),
  surfaceConfidence:clamp01(input.surfaceConfidence),
  surfaceSlip:clamp01(input.surfaceSlip),
  grounded:input.grounded!==false,
  airTimeSeconds:Math.max(0,finite(input.airTimeSeconds)),
  landingImpactMps:Math.max(0,finite(input.landingImpactMps)),
  traversalWeight:clamp01(input.traversalWeight),
  traversalForwardDistance:Math.max(0,finite(input.traversalForwardDistance)),
  traversalHeight:finite(input.traversalHeight),
  traversalBlocked:Boolean(input.traversalBlocked),
  gameplayOverride:text(input.gameplayOverride,''),
  rootMotionAllowed:input.rootMotionAllowed!==false,
  guarding:Boolean(input.guarding),
  attackKind:text(input.attackKind,''),
  dodgeRemaining:Math.max(0,finite(input.dodgeRemaining)),
  hitStaggerRemaining:Math.max(0,finite(input.hitStaggerRemaining)),
  footPlantConfidence:clamp01(input.footPlantConfidence),
  footContactPhase:clamp01(input.footContactPhase),
});}

export function recordPlayerLocomotionStateReplayStep(state=createPlayerLocomotionStateReplayState(),input={},mode='fresh'){
  const normalized=normalizePlayerLocomotionReplayInput(input);
  const intent=resolvePlayerLocomotionStateIntent(normalized,state.previousIntent);
  const timeline=resolvePlayerLocomotionStateTimelineSample(intent,{},state.previousIntent);
  const telemetry=buildPlayerLocomotionStateTelemetrySample(intent,timeline,state.previousIntent,state.frame+1);
  const quality=resolvePlayerLocomotionStateQualityReport(intent,timeline,state.previousIntent,true);
  const next=freeze({
    version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,
    frame:state.frame+1,
    previousIntent:intent,
    intents:[...state.intents,intent],
    timeline:[...state.timeline,timeline],
    telemetry:[...state.telemetry,telemetry.sample],
    quality:[...state.quality,quality],
  });
  return freeze({mode:PLAYER_LOCOMOTION_STATE_REPLAY_MODES.includes(mode)?mode:'fresh',state:next,intent,timeline,telemetry,quality});
}

export function replayPlayerLocomotionStateInputs(inputs=[],options={}){
  let state=createPlayerLocomotionStateReplayState();
  const results=[];
  const safe=Array.isArray(inputs)?inputs:[];
  const mode=text(options.mode,'fresh');
  const start=Math.max(0,Math.floor(finite(options.startFrame,0)));
  for(let index=0;index<safe.length;index+=1){
    if(index<start)continue;
    const result=recordPlayerLocomotionStateReplayStep(state,safe[index],mode);
    state=result.state;
    results.push(result);
  }
  return freeze({version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,state,results:freeze(results)});
}

export function diffPlayerLocomotionStateReplayResults(first=[],second=[]){
  const left=Array.isArray(first)?first:[];
  const right=Array.isArray(second)?second:[];
  const count=Math.max(left.length,right.length);
  let stateMismatches=0;
  let eventMismatches=0;
  let directionMismatches=0;
  let timelineDrift=0;
  let qualityDrift=0;
  for(let index=0;index<count;index+=1){
    const a=left[index]??{};const b=right[index]??{};
    if(text(a.intent?.state,'idle')!==text(b.intent?.state,'idle'))stateMismatches+=1;
    if(text(a.intent?.event?.type,'none')!==text(b.intent?.event?.type,'none'))eventMismatches+=1;
    if(text(a.intent?.direction?.selected,'forward')!==text(b.intent?.direction?.selected,'forward'))directionMismatches+=1;
    timelineDrift+=Math.abs(clamp01(a.timeline?.progress)-clamp01(b.timeline?.progress));
    qualityDrift+=Math.abs(clamp01(a.quality?.score)-clamp01(b.quality?.score));
  }
  return freeze({version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,count,stateMismatches,eventMismatches,directionMismatches,timelineDrift:round(timelineDrift,6),qualityDrift:round(qualityDrift,6),deterministic:stateMismatches===0&&eventMismatches===0&&directionMismatches===0&&timelineDrift<0.000001&&qualityDrift<0.000001});
}

export function branchPlayerLocomotionStateReplay(state=createPlayerLocomotionStateReplayState(),frame=0){
  const index=Math.max(0,Math.min(state.intents.length,Math.floor(finite(frame))));
  return freeze({
    ...state,
    frame:index,
    previousIntent:index?state.intents[index-1]:null,
    intents:state.intents.slice(0,index),
    timeline:state.timeline.slice(0,index),
    telemetry:state.telemetry.slice(0,index),
    quality:state.quality.slice(0,index),
  });
}

export function summarizePlayerLocomotionStateReplay(state=createPlayerLocomotionStateReplayState()){
  const intents=state.intents??[];
  const qualities=state.quality??[];
  const averageConfidence=intents.length?intents.reduce((sum,item)=>sum+clamp01(item.confidence),0)/intents.length:0;
  const averageQuality=qualities.length?qualities.reduce((sum,item)=>sum+clamp01(item.score),0)/qualities.length:0;
  const transitions=intents.filter(item=>item.transition?.changed).length;
  const events=intents.filter(item=>item.event?.type&&item.event.type!=='none').length;
  return freeze({version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,frame:state.frame,count:intents.length,transitions,events,averageConfidence:round(averageConfidence),averageQuality:round(averageQuality)});
}

export function validatePlayerLocomotionStateReplay(state=createPlayerLocomotionStateReplayState()){
  const errors=[];
  if(state.version!==PLAYER_LOCOMOTION_STATE_REPLAY_VERSION)errors.push('version');
  if(!Number.isFinite(state.frame)||state.frame<0)errors.push('frame');
  if(!Array.isArray(state.intents)||!Array.isArray(state.timeline)||!Array.isArray(state.telemetry)||!Array.isArray(state.quality))errors.push('collections');
  if(state.intents.length!==state.timeline.length)errors.push('timeline-length');
  if(state.intents.length!==state.telemetry.length)errors.push('telemetry-length');
  if(state.intents.length!==state.quality.length)errors.push('quality-length');
  return freeze({ok:errors.length===0,errors:freeze(errors)});
}

export function createPlayerLocomotionStateReplayController(){
  let state=createPlayerLocomotionStateReplayState();
  return freeze({
    update(input={},mode='fresh'){const result=recordPlayerLocomotionStateReplayStep(state,input,mode);state=result.state;return result;},
    read(){return summarizePlayerLocomotionStateReplay(state);},
    snapshot(){return state;},
    branch(frame=0){state=branchPlayerLocomotionStateReplay(state,frame);return state;},
    reset(){state=createPlayerLocomotionStateReplayState();},
  });
}

export function auditPlayerLocomotionStateReplay(){
  const inputs=[];
  for(let index=0;index<220;index+=1)inputs.push({
    velocity:{x:Math.sin(index/13),y:Math.cos(index/17)},
    facing:{x:Math.cos(index/19),y:Math.sin(index/23)},
    planarSpeedMps:(index%97)/10,
    turnRateDegreesPerSecond:(index*43)%541,
    slopeDegrees:(index*7)%111-55,
    surfaceConfidence:index%13===0?0.25:0.94,
    surfaceSlip:index%11===0?0.82:0.1,
    grounded:index%17!==0,
    airTimeSeconds:index%17===0?0.25:0,
    landingImpactMps:index%23===0?5.5:0,
    traversalWeight:index%9===0?0.9:0,
    traversalForwardDistance:index%9===0?3.4:1,
    traversalBlocked:index%31===0,
    guarding:index%37===0,
    attackKind:index%41===0?'heavy':'',
    dodgeRemaining:index%47===0?0.2:0,
    hitStaggerRemaining:index%53===0?0.2:0,
  });
  const a=replayPlayerLocomotionStateInputs(inputs);
  const b=replayPlayerLocomotionStateInputs(inputs);
  const diff=diffPlayerLocomotionStateReplayResults(a.results,b.results);
  return freeze({version:PLAYER_LOCOMOTION_STATE_REPLAY_VERSION,ok:validatePlayerLocomotionStateReplay(a.state).ok&&diff.deterministic&&a.results.length===220,summary:summarizePlayerLocomotionStateReplay(a.state),diff});
}
