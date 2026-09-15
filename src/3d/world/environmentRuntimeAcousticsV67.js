import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const ACOUSTICS_V67 = Object.freeze({
  id:'acoustics-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
});

export const terrainReflectivityV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const rock=clamp01(sample.rockExposure??s.slope);
  const vegetation=clamp01(s.canopy);
  return clamp01(.42+rock*.42-vegetation*.2);
};

export const windNoiseV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.wind*.72+s.slope*.18+(1-s.canopy)*.1);
};

export const waterNoiseV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const edge=clamp01(1-s.waterDistance/160);
  return clamp01(edge*.7+s.moisture*.3);
};

export const rainfallNoiseV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.rain*.75+s.humidity*.25);
};

export const wildlifeNoiseV67=(sample={})=>
  clamp01((1-normalizeSampleV67(sample).humanPressure)*.55+normalizeSampleV67(sample).canopy*.45);

export const acousticAbsorptionV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.canopy*.58+s.moisture*.22+(1-s.slope)*.2);
};

export const acousticReachV67=(sample={})=>{
  const reflection=terrainReflectivityV67(sample);
  const absorption=acousticAbsorptionV67(sample);
  return clamp01(.48+reflection*.34-absorption*.25);
};

export const buildAcousticSampleV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return {
    id:s.id,
    reflection:terrainReflectivityV67(s),
    absorption:acousticAbsorptionV67(s),
    windNoise:windNoiseV67(s),
    waterNoise:waterNoiseV67(s),
    rainNoise:rainfallNoiseV67(s),
    wildlifeNoise:wildlifeNoiseV67(s),
    reach:acousticReachV67(s),
  };
};

export const buildAcousticFieldV67=(samples=[])=>samples.map(buildAcousticSampleV67);

export const ambientNoiseV67=(sample={})=>{
  const s=buildAcousticSampleV67(sample);
  return clamp01(s.windNoise*.24+s.waterNoise*.2+s.rainNoise*.24+s.wildlifeNoise*.18+s.reflection*.14);
};

export const soundOcclusionV67=(source={},listener={})=>{
  const a=normalizeSampleV67(source);
  const b=normalizeSampleV67(listener);
  const slopeDelta=Math.abs(a.slope-b.slope);
  const vegetation=(a.canopy+b.canopy)/2;
  return clamp01(slopeDelta*.45+vegetation*.35+(1-Math.min(1,1/(1+Math.abs(a.waterDistance-b.waterDistance)/80)))*.2);
};

export const directionalNoiseV67=(sample={},heading=0)=>{
  const s=normalizeSampleV67(sample);
  const directional=(Math.cos(finiteV67(heading,0))*0.5+0.5)*s.wind;
  return clamp01(directional*.7+ambientNoiseV67(s)*.3);
};

export const acousticSummaryV67=(field=[])=>({
  samples:field.length,
  meanReach:meanV67(field.map(x=>x.reach)),
  meanAbsorption:meanV67(field.map(x=>x.absorption)),
  noisy:field.filter(x=>x.windNoise>.7||x.rainNoise>.72).length,
});

export const validateAcousticsV67=(field=[])=>{
  const errors=[];
  if(!Array.isArray(field))errors.push('field');
  if(field.some(x=>x.reach<0||x.reach>1))errors.push('reach');
  if(field.some(x=>x.absorption<0||x.absorption>1))errors.push('absorption');
  return{ok:errors.length===0,errors};
};

export const acousticsTelemetryV67=(field=[])=>({
  policy:ACOUSTICS_V67.id,
  valid:validateAcousticsV67(field).ok,
  summary:acousticSummaryV67(field),
});

export const environmentAudioMixV67=(sample={})=>({
  wind:clamp01(windNoiseV67(sample)*.8),
  water:clamp01(waterNoiseV67(sample)*.9),
  rain:clamp01(rainfallNoiseV67(sample)),
  fauna:clamp01(wildlifeNoiseV67(sample)*.72),
  occlusion:soundOcclusionV67(sample,sample),
});

export const audioPriorityV67=(sample={})=>{
  const mix=environmentAudioMixV67(sample);
  return clamp01(Math.max(mix.wind,mix.water,mix.rain,mix.fauna)*.74+acousticReachV67(sample)*.26);
};
