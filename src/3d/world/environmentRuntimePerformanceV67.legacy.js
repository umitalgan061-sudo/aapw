import { clamp01, finiteV67, meanV67 } from './environmentRuntimeV67.js';

export const PERFORMANCE_V67=Object.freeze({
  id:'performance-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
  budgetMs:4.5,
});

export const operationBudgetV67=(operation='environment',platform='desktop')=>{
  const base={environment:1.8,hydrology:.7,weather:.65,surface:.6,wildlife:.8,navigation:.55,streaming:.5,events:.45}[operation]??1;
  const factor=platform==='mobile'?1.55:platform==='tablet'?1.28:1;
  return base*factor;
};

export const estimateSampleCostV67=(sample={},platform='desktop')=>{
  const complexity=.45+finiteV67(sample.slope)/90*.22+finiteV67(sample.humanPressure)*.12+finiteV67(sample.rain)*.1+finiteV67(sample.wind)/50*.11;
  return complexity*operationBudgetV67('environment',platform);
};

export const estimateFieldCostV67=(samples=[],platform='desktop')=>samples.reduce((sum,sample)=>sum+estimateSampleCostV67(sample,platform),0);
export const batchCostV67=(sampleCount=0,platform='desktop')=>estimateFieldCostV67(Array.from({length:Math.max(0,Math.floor(sampleCount))},()=>({})),platform);
export const frameHeadroomV67=(cost=0,budget=PERFORMANCE_V67.budgetMs)=>clamp01(1-finiteV67(cost)/Math.max(.1,budget));
export const performanceBandV67=(cost=0)=>cost<1.2?'fast':cost<2.6?'normal':cost<4.2?'heavy':'over-budget';
export const buildPerformanceEnvelopeV67=(samples=[],platform='desktop')=>{
  const cost=estimateFieldCostV67(samples,platform);
  const perSample=samples.length?cost/samples.length:0;
  return{platform,samples:samples.length,cost,perSample,headroom:frameHeadroomV67(cost),band:performanceBandV67(cost)};
};
export const comparePerformanceV67=(before={},after={})=>({
  delta:finiteV67(after.cost)-finiteV67(before.cost),
  headroomDelta:finiteV67(after.headroom)-finiteV67(before.headroom),
  improved:finiteV67(after.cost)<=finiteV67(before.cost),
});
export const lodPressureV67=(field=[],platform='desktop')=>{
  const envelope=buildPerformanceEnvelopeV67(field,platform);
  return clamp01((envelope.cost-PERFORMANCE_V67.budgetMs*.35)/(PERFORMANCE_V67.budgetMs*.8));
};
export const qualityThrottleV67=(pressure=0)=>clamp01(pressure*.82);
export const recommendedTierV67=(pressure=0)=>pressure>.78?'far':pressure>.52?'mid':'near';
export const performanceSummaryV67=(samples=[],platform='desktop')=>{
  const envelope=buildPerformanceEnvelopeV67(samples,platform);
  return{...envelope,pressure:lodPressureV67(samples,platform),throttle:qualityThrottleV67(lodPressureV67(samples,platform)),recommended:recommendedTierV67(lodPressureV67(samples,platform))};
};
export const validatePerformanceV67=(envelope={})=>{
  const errors=[];
  if(!Number.isFinite(envelope.cost))errors.push('cost');
  if(!Number.isFinite(envelope.headroom))errors.push('headroom');
  if(envelope.headroom<0)errors.push('headroom-negative');
  return{ok:errors.length===0,errors};
};
export const performanceTelemetryV67=(samples=[],platform='desktop')=>({policy:PERFORMANCE_V67.id,summary:performanceSummaryV67(samples,platform),meanCost:meanV67(samples.map(s=>estimateSampleCostV67(s,platform))),valid:true});
