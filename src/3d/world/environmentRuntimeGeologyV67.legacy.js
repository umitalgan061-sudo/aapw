import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const GEOLOGY_V67 = Object.freeze({
  id:'geology-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
});

const ROCK_TYPES=Object.freeze({
  granite:{hardness:.9,erosion:.18,fracture:.34},
  limestone:{hardness:.64,erosion:.46,fracture:.66},
  shale:{hardness:.4,erosion:.78,fracture:.82},
  sandstone:{hardness:.56,erosion:.59,fracture:.58},
  basalt:{hardness:.86,erosion:.22,fracture:.41},
});

export const classifyRockV67=(sample={})=>{
  const key=String(sample.rockType??'granite').toLowerCase();
  return ROCK_TYPES[key]?key:'granite';
};

export const rockHardnessV67=(sample={})=>ROCK_TYPES[classifyRockV67(sample)].hardness;
export const rockErosionRateV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const rock=ROCK_TYPES[classifyRockV67(sample)];
  return clamp01(rock.erosion*(.7+s.moisture*.4)+s.slope*.22);
};
export const fractureRiskV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const rock=ROCK_TYPES[classifyRockV67(sample)];
  return clamp01(rock.fracture*.62+s.slope*.24+s.snow*.14);
};
export const talusPotentialV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return clamp01(s.slope*.48+fractureRiskV67(s)*.32+rockErosionRateV67(s)*.2);
};
export const rockFaceResponseV67=(sample={})=>{
  const hardness=rockHardnessV67(sample);
  const fracture=fractureRiskV67(sample);
  return {
    hardness,
    fracture,
    weathering:rockErosionRateV67(sample),
    faceContrast:clamp01(.28+hardness*.5-fracture*.18),
  };
};
export const buildGeologySampleV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  return {
    id:s.id,
    rockType:classifyRockV67(sample),
    talus:talusPotentialV67(s),
    face:rockFaceResponseV67(s),
  };
};
export const buildGeologyFieldV67=(samples=[])=>samples.map(buildGeologySampleV67);
export const geologySummaryV67=(field=[])=>({
  samples:field.length,
  meanTalus:meanV67(field.map(x=>x.talus)),
  highFracture:field.filter(x=>x.face.fracture>.62).length,
  rockTypes:field.reduce((a,x)=>(a[x.rockType]=(a[x.rockType]??0)+1,a),{}),
});
export const validateGeologyV67=(field=[])=>{
  const errors=[];
  if(!Array.isArray(field))errors.push('field');
  if(field.some(x=>x.talus<0||x.talus>1))errors.push('talus');
  if(field.some(x=>x.face.hardness<0||x.face.hardness>1))errors.push('hardness');
  return{ok:errors.length===0,errors};
};
export const geologyTelemetryV67=(field=[])=>({policy:GEOLOGY_V67.id,valid:validateGeologyV67(field).ok,summary:geologySummaryV67(field)});
export const boulderScaleV67=(sample={})=>Math.round(1+talusPotentialV67(sample)*8);
export const outcropDensityV67=(sample={})=>clamp01(talusPotentialV67(sample)*.7+rockHardnessV67(sample)*.3);
export const geologyTraversalModifierV67=(sample={})=>1+fractureRiskV67(sample)*1.8;
