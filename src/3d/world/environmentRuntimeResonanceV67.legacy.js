import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const RESONANCE_V67 = Object.freeze({
  id:'resonance-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
});

export const windMotionV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.wind*.65+(1-s.canopy)*.35);
};

export const thermalPulseV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(Math.abs(s.temperature-14)/24);
};

export const wetPulseV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.moisture*.62+(1-s.waterDistance/180)*.38);
};

export const ambientActivityV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01((1-s.humanPressure)*.5+s.canopy*.18+s.wind*.14+s.rain*.18);
};

export const resonanceStrengthV67=(sample={})=>clamp01(
  windMotionV67(sample)*.24+
  thermalPulseV67(sample)*.17+
  wetPulseV67(sample)*.2+
  ambientActivityV67(sample)*.39,
);

export const resonanceBandV67=(strength=0)=>{
  if(strength>.78)return 'surging';
  if(strength>.54)return 'active';
  if(strength>.3)return 'soft';
  return 'quiet';
};

export const buildResonanceSampleV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const strength=resonanceStrengthV67(s);
  return{
    id:s.id,
    windMotion:windMotionV67(s),
    thermal:thermalPulseV67(s),
    wet:wetPulseV67(s),
    activity:ambientActivityV67(s),
    strength,
    band:resonanceBandV67(strength),
  };
};

export const buildResonanceFieldV67=(samples=[])=>samples.map(buildResonanceSampleV67);

export const pulseContinuityV67=(field=[])=>{
  if(field.length<2)return 1;
  let total=0;
  for(let i=1;i<field.length;i++)total+=1-Math.abs(field[i].strength-field[i-1].strength);
  return clamp01(total/(field.length-1));
};

export const resonanceSummaryV67=(field=[])=>({
  samples:field.length,
  meanStrength:meanV67(field.map(x=>x.strength)),
  continuity:pulseContinuityV67(field),
  active:field.filter(x=>x.band==='active'||x.band==='surging').length,
});

export const validateResonanceV67=(field=[])=>{
  const errors=[];
  if(!Array.isArray(field))errors.push('field');
  if(field.some(x=>x.strength<0||x.strength>1))errors.push('strength');
  if(field.some(x=>!['quiet','soft','active','surging'].includes(x.band)))errors.push('band');
  return{ok:errors.length===0,errors};
};

export const resonanceTelemetryV67=(field=[])=>({
  policy:RESONANCE_V67.id,
  valid:validateResonanceV67(field).ok,
  summary:resonanceSummaryV67(field),
});

export const resonanceDeltaV67=(before={},after={})=>({
  strength:finiteV67(after.strength)-finiteV67(before.strength),
  bandChanged:before.band!==after.band,
});

export const resonanceImpulseV67=(sample={},eventEnergy=.2)=>clamp01(resonanceStrengthV67(sample)*.72+clamp01(eventEnergy)*.28);
