/**
 * Presentation quality diagnostics for the synthesized locomotion state.
 * Scores continuity, contact confidence, direction stability, transition coherence and authored overrides.
 */
import { PLAYER_DIRECTIONAL_DIRECTIONS } from './playerDirectionalLocomotionPolicy.js';
import { PLAYER_LOCOMOTION_STATE_EVENTS, PLAYER_LOCOMOTION_STATE_STATES } from './playerLocomotionStateSynthesis.js';

export const PLAYER_LOCOMOTION_STATE_QUALITY_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_STATE_QUALITY_AXES = Object.freeze([
  'state-validity','transition-coherence','direction-continuity','contact-quality','surface-quality','timeline-quality','semantic-priority','determinism',
]);
export const PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS = Object.freeze({
  warning:0.72,
  acceptable:0.84,
  strong:0.93,
  excellent:0.98,
});

function finite(value, fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function clamp01(value){return clamp(finite(value),0,1);}
function round(value,digits=4){const f=10**digits;const n=Math.round(finite(value)*f)/f;return Object.is(n,-0)?0:n;}
function freeze(value){return Object.freeze(value);}
function text(value,fallback=''){return typeof value==='string'&&value?value:fallback;}

export function scorePlayerLocomotionStateValidity(intent={}){
  const state=PLAYER_LOCOMOTION_STATE_STATES.includes(intent.state)?1:0;
  const event=PLAYER_LOCOMOTION_STATE_EVENTS.includes(intent.event?.type)?1:0;
  const direction=PLAYER_DIRECTIONAL_DIRECTIONS.includes(intent.direction?.selected)?1:0;
  const validation=intent.validation?.ok===true?1:0;
  return round((state*0.3+event*0.2+direction*0.2+validation*0.3));
}

export function scorePlayerLocomotionTransitionCoherence(intent={},previous=null){
  const from=text(previous?.state,'idle');
  const to=text(intent.state,'idle');
  const changed=from!==to;
  const transitionChanged=Boolean(intent.transition?.changed);
  if(changed!==transitionChanged)return 0.2;
  if(!changed)return 1;
  const confidence=clamp01(intent.transition?.confidence);
  const edge=text(intent.transition?.edge,'');
  return round(clamp01(confidence*(edge.includes('->')?1:0.35)));
}

export function scorePlayerLocomotionDirectionContinuity(intent={},previous=null){
  const current=text(intent.direction?.selected,'forward');
  const prior=text(previous?.direction?.selected ?? previous?.anticipatedDirection,'forward');
  if(current===prior)return 1;
  const shift=Math.abs(finite(intent.direction?.shiftDegrees));
  if(shift>=90)return round(clamp01(0.78-intent.direction.anticipationStrength*0.18));
  if(shift>=45)return round(clamp01(0.88-intent.direction.anticipationStrength*0.12));
  return 0.94;
}

export function scorePlayerLocomotionContactQuality(intent={}){
  const contact=clamp01(intent.weights?.contact);
  const landing=clamp01(intent.weights?.landing);
  const plant=clamp01(intent.profile?.contact?.plant);
  const slip=clamp01(intent.profile?.surfaceSlip);
  const surface=clamp01(intent.profile?.surfaceConfidence);
  const corrective=clamp01(intent.profile?.contact?.correctiveStep);
  const raw=plant*0.34+contact*0.26+surface*0.18+(1-slip)*0.12+(1-corrective)*0.10-(landing>0.75?0.04:0);
  return round(clamp01(raw));
}

export function scorePlayerLocomotionSurfaceQuality(intent={}){
  const confidence=clamp01(intent.profile?.surfaceConfidence);
  const slip=clamp01(intent.profile?.surfaceSlip);
  const slopeRisk=clamp01(Math.abs(finite(intent.profile?.slopeDegrees))/55);
  return round(clamp01(confidence*0.58+(1-slip)*0.27+(1-slopeRisk)*0.15));
}

export function scorePlayerLocomotionTimelineQuality(timeline={}){
  const progress=clamp01(timeline.progress);
  const eased=clamp01(timeline.easedProgress);
  const duration=finite(timeline.durationSeconds,0.16);
  const durationQuality=clamp01(1-Math.abs(duration-0.16)/0.65);
  const cueCount=Array.isArray(timeline.cues)?timeline.cues.length:0;
  const cueQuality=clamp01(cueCount/4);
  return round(clamp01(0.3*(1-Math.abs(progress-eased))+0.35*durationQuality+0.35*cueQuality));
}

export function scorePlayerLocomotionSemanticPriority(intent={}){
  const semantic=text(intent.semanticState,'idle');
  const state=text(intent.state,'idle');
  const recovery=semantic.includes('stagger')?state==='stagger-recover':semantic.includes('dodge')?state==='dodge-recover':semantic==='guard'?state==='guard-walk':true;
  const override=intent.source?.source==='override';
  return recovery?round(override?1:0.97):round(override?0.99:0.94);
}

export function resolvePlayerLocomotionStateQualityAxes(intent={},timeline={},previous=null,deterministic=true){
  return freeze({
    'state-validity':scorePlayerLocomotionStateValidity(intent),
    'transition-coherence':scorePlayerLocomotionTransitionCoherence(intent,previous),
    'direction-continuity':scorePlayerLocomotionDirectionContinuity(intent,previous),
    'contact-quality':scorePlayerLocomotionContactQuality(intent),
    'surface-quality':scorePlayerLocomotionSurfaceQuality(intent),
    'timeline-quality':scorePlayerLocomotionTimelineQuality(timeline),
    'semantic-priority':scorePlayerLocomotionSemanticPriority(intent),
    determinism:deterministic?1:0,
  });
}

export function resolvePlayerLocomotionStateQualityScore(axes={}){
  const weights={
    'state-validity':0.18,'transition-coherence':0.15,'direction-continuity':0.13,'contact-quality':0.15,'surface-quality':0.12,'timeline-quality':0.10,'semantic-priority':0.10,determinism:0.07,
  };
  let score=0;
  for(const axis of PLAYER_LOCOMOTION_STATE_QUALITY_AXES)score+=clamp01(axes[axis])*weights[axis];
  return round(clamp01(score));
}

export function classifyPlayerLocomotionStateQuality(score=0){
  const value=clamp01(score);
  if(value>=PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS.excellent)return'excellent';
  if(value>=PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS.strong)return'strong';
  if(value>=PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS.acceptable)return'acceptable';
  if(value>=PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS.warning)return'warning';
  return'weak';
}

export function resolvePlayerLocomotionStateQualityFlags(axes={},intent={}){
  const flags=[];
  for(const axis of PLAYER_LOCOMOTION_STATE_QUALITY_AXES){
    const value=clamp01(axes[axis]);
    if(value<0.6)flags.push(`${axis}:critical`);
    else if(value<PLAYER_LOCOMOTION_STATE_QUALITY_THRESHOLDS.warning)flags.push(`${axis}:warning`);
  }
  if(intent.event?.type==='traversal-blocked')flags.push('traversal-blocked');
  if(intent.event?.type==='surface-slip')flags.push('surface-slip');
  if(intent.input?.grounded===false)flags.push('airborne');
  return freeze(flags);
}

export function resolvePlayerLocomotionStateQualityReport(intent={},timeline={},previous=null,deterministic=true){
  const axes=resolvePlayerLocomotionStateQualityAxes(intent,timeline,previous,deterministic);
  const score=resolvePlayerLocomotionStateQualityScore(axes);
  return freeze({version:PLAYER_LOCOMOTION_STATE_QUALITY_VERSION,axes,score,grade:classifyPlayerLocomotionStateQuality(score),flags:resolvePlayerLocomotionStateQualityFlags(axes,intent)});
}

export function summarizePlayerLocomotionStateQualityReports(reports=[]){
  const safe=Array.isArray(reports)?reports:[];
  const average=safe.length?safe.reduce((sum,item)=>sum+clamp01(item?.score),0)/safe.length:0;
  const grades={weak:0,warning:0,acceptable:0,strong:0,excellent:0};
  for(const report of safe){const grade=classifyPlayerLocomotionStateQuality(report?.score);grades[grade]=(grades[grade]??0)+1;}
  return freeze({count:safe.length,averageScore:round(average),minimumScore:safe.length?round(Math.min(...safe.map(item=>clamp01(item?.score)))):0,maximumScore:safe.length?round(Math.max(...safe.map(item=>clamp01(item?.score)))):0,gradeCounts:freeze(grades),flaggedCount:safe.filter(item=>Array.isArray(item?.flags)&&item.flags.length>0).length});
}

export function comparePlayerLocomotionStateQualityRuns(first=[],second=[]){
  const left=Array.isArray(first)?first:[];
  const right=Array.isArray(second)?second:[];
  const count=Math.max(left.length,right.length);
  let scoreDrift=0;
  let gradeMismatches=0;
  let flagMismatches=0;
  for(let index=0;index<count;index+=1){
    const a=left[index]??{};
    const b=right[index]??{};
    scoreDrift+=Math.abs(clamp01(a.score)-clamp01(b.score));
    if(text(a.grade,'weak')!==text(b.grade,'weak'))gradeMismatches+=1;
    const af=JSON.stringify(a.flags??[]);
    const bf=JSON.stringify(b.flags??[]);
    if(af!==bf)flagMismatches+=1;
  }
  return freeze({count,scoreDrift:round(scoreDrift,6),gradeMismatches,flagMismatches,deterministic:scoreDrift<0.000001&&gradeMismatches===0&&flagMismatches===0});
}

export function createPlayerLocomotionStateQualityController({onReport=null}={}){
  let previous=null;
  return freeze({
    evaluate(intent,timeline={},deterministic=true){
      const report=resolvePlayerLocomotionStateQualityReport(intent,timeline,previous,deterministic);
      previous=intent;
      if(typeof onReport==='function')onReport(report);
      return report;
    },
    reset(){previous=null;},
  });
}

export function auditPlayerLocomotionStateQuality(){
  const controller=createPlayerLocomotionStateQualityController();
  const reports=[];
  const states=['idle','start','cruise','pivot','brake','recover','airborne','landing-soft','landing-hard','slippery-step','traversal-prepare','traversal-blocked'];
  for(let index=0;index<states.length;index+=1){
    const report=controller.evaluate({state:states[index],semanticState:states[index].includes('recover')?'dodge':'idle',direction:{selected:PLAYER_DIRECTIONAL_DIRECTIONS[index%8],shiftDegrees:index*7,anticipationStrength:0.5},confidence:0.9,profile:{surfaceConfidence:0.9,surfaceSlip:index/20,slopeDegrees:index*3,groundRisk:index/20,contact:{plant:0.9,correctiveStep:index/20}},weights:{contact:0.8,landing:index>7?0.4:0,anticipation:0.5,traversal:index>9?0.8:0},validation:{ok:true},transition:{changed:index>0,confidence:0.9,edge:index>0?`${states[index-1]}->${states[index]}`:'steady'},event:{type:index%4===0?'speed-up':'none'},input:{grounded:index!==6}} ,{progress:(index%10)/10,easedProgress:(index%10)/10,durationSeconds:0.16,cues:[{type:'event',weight:0.4}]});
    reports.push(report);
  }
  const summary=summarizePlayerLocomotionStateQualityReports(reports);
  const clone=reports.map(report=>({...report,axes:{...report.axes},flags:[...report.flags]}));
  const compare=comparePlayerLocomotionStateQualityRuns(reports,clone);
  return freeze({version:PLAYER_LOCOMOTION_STATE_QUALITY_VERSION,ok:summary.count===states.length&&summary.minimumScore>=0&&compare.deterministic,summary,compare});
}
