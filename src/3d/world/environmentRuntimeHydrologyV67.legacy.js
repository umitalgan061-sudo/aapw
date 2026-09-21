import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const HYDROLOGY_V67 = Object.freeze({ id:'hydrology-v67', deterministic:true, noWorldMutation:true });
export const runoffCoefficientV67 = (sample={}) => clamp01(0.18 + (1-clamp01(sample.canopy??0.5))*0.34 + clamp01(sample.slope/90)*0.2);
export const rainfallEnergyV67 = (rain=0, duration=1) => clamp01(clamp01(rain)*(0.55+clamp01(duration/12)*0.45));
export const infiltrationCapacityV67 = (sample={}) => {
  const s=normalizeSampleV67(sample);
  return clamp01(0.8-s.slope*0.38-s.moisture*0.44+s.canopy*0.18);
};
export const runoffDepthV67 = (sample={}) => {
  const s=normalizeSampleV67(sample);
  const rain=clamp01(sample.rain);
  return Math.max(0,rain*runoffCoefficientV67(s)*(1-infiltrationCapacityV67(s)));
};
export const dischargeV67 = (sample={}) => {
  const s=normalizeSampleV67(sample);
  const catchment=Math.max(1,finiteV67(sample.catchmentArea,80));
  const slope=0.6+clamp01(s.slope*1.4);
  return catchment*runoffDepthV67(s)*slope;
};
export const floodDepthV67 = (sample={}) => clamp01(dischargeV67(sample)/Math.max(1,finiteV67(sample.channelCapacity,90)));
export const floodClassV67 = (risk=0) => risk>=0.8?'critical':risk>=0.55?'high':risk>=0.3?'moderate':'low';
export const bankErosionRiskV67 = (sample={}) => {
  const s=normalizeSampleV67(sample);
  return clamp01(runoffDepthV67(s)*0.55+s.slope*0.3+s.moisture*0.15);
};
export const wetEdgeWeightV67 = (waterDistance=1000) => clamp01(1-Math.max(0,finiteV67(waterDistance,1000))/180);
export const flowDirectionV67 = (sample={}) => {
  const s=normalizeSampleV67(sample);
  const x=clamp01(s.slope+keyV67(s.id))-0.5;
  const y=clamp01(s.moisture+s.rain)-0.5;
  return { x,y, magnitude:Math.hypot(x,y) };
};
const keyV67=(id)=>{let h=0;for(const c of String(id))h=Math.imul(h^c.charCodeAt(0),31);return (h>>>0)/4294967295;};
export const classifyHydrologySampleV67 = (sample={}) => {
  const risk=floodDepthV67(sample);
  if(risk>0.8)return 'floodplain';
  if(risk>0.45)return 'wet-channel';
  if(wetEdgeWeightV67(sample.waterDistance)>0.65)return 'riparian';
  return 'dry-catchment';
};
export const buildHydrologyFieldV67 = (samples=[]) => samples.map((sample,i)=>{
  const s=normalizeSampleV67(sample,i);
  const risk=floodDepthV67(s);
  return {id:s.id,class:classifyHydrologySampleV67(s),runoff:runoffDepthV67(s),discharge:dischargeV67(s),floodRisk:risk,bankRisk:bankErosionRiskV67(s),wetEdge:wetEdgeWeightV67(s.waterDistance)};
});
export const hydrologySummaryV67 = (field=[]) => ({samples:field.length,meanFloodRisk:meanV67(field.map(x=>x.floodRisk)),peakFloodRisk:Math.max(0,...field.map(x=>x.floodRisk)),highRisk:field.filter(x=>x.floodRisk>=0.55).length,wetEdges:field.filter(x=>x.wetEdge>0.65).length});
export const validateHydrologyV67 = (field=[]) => {
  const errors=[];
  if(!Array.isArray(field))errors.push('field');
  if(field.some(x=>x.floodRisk<0||x.floodRisk>1))errors.push('risk-range');
  if(field.some(x=>!Number.isFinite(x.discharge)))errors.push('discharge');
  return {ok:errors.length===0,errors};
};
export const hydrologyFrameV67 = (samples=[],rain=0.2) => buildHydrologyFieldV67(samples.map(s=>({...s,rain:clamp01(rain)})));
export const hydrologyTelemetryV67 = (field=[]) => ({policy:HYDROLOGY_V67.id,summary:hydrologySummaryV67(field),valid:validateHydrologyV67(field).ok});
