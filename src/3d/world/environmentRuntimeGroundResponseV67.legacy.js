import { clamp01, normalizeSampleV67 } from './environmentRuntimeV67.js';
import { wetEdgeV67, tractionV67, materialStateV67 } from './environmentRuntimeSurfaceV67.js';
import { bankErosionRiskV67 } from './environmentRuntimeHydrologyV67.js';
import { rockErosionRateV67, fractureRiskV67 } from './environmentRuntimeGeologyV67.js';

export const GROUND_RESPONSE_V67=Object.freeze({id:'ground-response-v67',version:67,deterministic:true,noWorldMutation:true});
export const groundWearV67=(sample={})=>{const s=normalizeSampleV67(sample);return clamp01(s.humanPressure*.45+bankErosionRiskV67(s)*.3+rockErosionRateV67(s)*.25);};
export const sedimentDepositV67=(sample={})=>{const s=normalizeSampleV67(sample);return clamp01(bankErosionRiskV67(s)*.58+(1-s.slope)*.22+s.moisture*.2);};
export const rockExposureV67=(sample={})=>{const s=normalizeSampleV67(sample);return clamp01(s.slope*.52+fractureRiskV67(s)*.28+(1-s.canopy)*.2);};
export const snowMeltMarkV67=(sample={})=>{const s=normalizeSampleV67(sample);return clamp01(s.snow*(s.temperature>0?1:s.temperature>-4?.4:0));};
export const groundRoleV67=(sample={})=>{const state=materialStateV67(sample);if(state==='rock')return'outcrop';if(state==='mud')return'depositional';if(state==='snow')return'snowfield';return'soil';};
export const buildGroundResponseV67=(sample={})=>{const s=normalizeSampleV67(sample);return{id:s.id,role:groundRoleV67(s),wear:groundWearV67(s),sediment:sedimentDepositV67(s),rockExposure:rockExposureV67(s),snowMelt:snowMeltMarkV67(s),traction:tractionV67(s),wetEdge:wetEdgeV67(s.waterDistance)};};
export const buildGroundFieldV67=(samples=[])=>samples.map(buildGroundResponseV67);
export const groundMaterialIntentV67=(response={})=>({role:response.role,roughness:clamp01(.42+response.wear*.3+response.rockExposure*.2),normalStrength:clamp01(.3+response.rockExposure*.5),wetness:clamp01(response.wetEdge*.6+response.sediment*.4)});
export const groundSummaryV67=(field=[])=>({samples:field.length,wet:field.filter(x=>x.wetEdge>.62).length,rock:field.filter(x=>x.role==='outcrop').length,mud:field.filter(x=>x.role==='depositional').length,snow:field.filter(x=>x.role==='snowfield').length});
export const validateGroundV67=(field=[])=>{const errors=[];if(!Array.isArray(field))errors.push('field');if(field.some(x=>x.wear<0||x.wear>1))errors.push('wear');if(field.some(x=>x.traction<0||x.traction>1))errors.push('traction');return{ok:errors.length===0,errors};};
export const groundTelemetryV67=(field=[])=>({policy:GROUND_RESPONSE_V67.id,valid:validateGroundV67(field).ok,summary:groundSummaryV67(field)});
export const groundRiskModifierV67=(response={})=>clamp01(response.sediment*.35+response.rockExposure*.35+(1-response.traction)*.3);
export const groundScenarioV67=(sample={},modifiers={})=>buildGroundResponseV67({...sample,moisture:clamp01((sample.moisture??.5)+(modifiers.moisture??0)),snow:clamp01((sample.snow??0)+(modifiers.snow??0))});
