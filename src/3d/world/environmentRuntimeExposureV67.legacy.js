import { clamp01, finiteV67, normalizeSampleV67 } from './environmentRuntimeV67.js';
import { buildAtmosphereSampleV67 } from './environmentRuntimeAtmosphereV67.js';
import { exposureRiskV67, shelterScoreV67 } from './environmentRuntimeShelterV67.js';

export const EXPOSURE_V67=Object.freeze({id:'exposure-v67',version:67,deterministic:true,noWorldMutation:true});
export const solarAngleV67=(hour=12)=>{const h=((finiteV67(hour,12)%24)+24)%24;return clamp01((Math.sin((h-6)/12*Math.PI)+.05)/1.05);};
export const solarLoadV67=(sample={},hour=12)=>{const s=normalizeSampleV67(sample);return clamp01(solarAngleV67(hour)*(.7+(1-s.canopy)*.3));};
export const thermalExposureV67=(sample={},hour=12)=>{const s=normalizeSampleV67(sample);return clamp01(solarLoadV67(s,hour)*.5+Math.abs(s.temperature-14)/28*.5);};
export const visibilityExposureV67=(sample={})=>buildAtmosphereSampleV67(sample).visibility;
export const windExposureV67=(sample={})=>clamp01(normalizeSampleV67(sample).wind*.7+exposureRiskV67(sample)*.3);
export const safeExposureMarginV67=(sample={},hour=12)=>clamp01(1-(thermalExposureV67(sample,hour)*.28+windExposureV67(sample)*.22+(1-visibilityExposureV67(sample))*.25+(1-shelterScoreV67(sample))*.25));
export const buildExposureSampleV67=(sample={},hour=12)=>{const s=normalizeSampleV67(sample);return{id:s.id,solar:solarLoadV67(s,hour),thermal:thermalExposureV67(s,hour),visibility:visibilityExposureV67(s),wind:windExposureV67(s),shelter:shelterScoreV67(s),margin:safeExposureMarginV67(s,hour)};};
export const buildExposureFieldV67=(samples=[],hour=12)=>samples.map(sample=>buildExposureSampleV67(sample,hour));
export const exposureClassV67=(margin=0)=>margin>.72?'sheltered':margin>.45?'mixed':margin>.25?'exposed':'severe';
export const exposureSummaryV67=(field=[])=>({samples:field.length,meanMargin:field.reduce((a,x)=>a+x.margin,0)/Math.max(1,field.length),severe:field.filter(x=>exposureClassV67(x.margin)==='severe').length});
export const validateExposureV67=(field=[])=>{const errors=[];if(!Array.isArray(field))errors.push('field');if(field.some(x=>x.margin<0||x.margin>1))errors.push('margin');if(field.some(x=>x.solar<0||x.solar>1))errors.push('solar');return{ok:errors.length===0,errors};};
export const exposureTelemetryV67=(field=[])=>({policy:EXPOSURE_V67.id,valid:validateExposureV67(field).ok,summary:exposureSummaryV67(field)});
export const exposureDeltaV67=(before={},after={})=>({margin:finiteV67(after.margin)-finiteV67(before.margin),thermal:finiteV67(after.thermal)-finiteV67(before.thermal)});
