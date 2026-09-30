import { clamp01, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';
import { validateEnvironmentRuntimeV67 } from './environmentRuntimeIntegrationV67.js';
import { validateReleaseGateV67 } from './environmentRuntimeReleaseV67.js';

export const QUALITY_V67=Object.freeze({
  id:'quality-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
});

export const numericRangeChecksV67=(field=[],keys=[])=>{
  const errors=[];
  for(const item of field){
    for(const key of keys){
      if(!Number.isFinite(Number(item?.[key])))errors.push(`${item?.id??'item'}:${key}:number`);
      if(Number(item?.[key])<0||Number(item?.[key])>1)errors.push(`${item?.id??'item'}:${key}:range`);
    }
  }
  return errors;
};

export const sampleQualityV67=(sample={})=>{
  const s=normalizeSampleV67(sample);
  const errors=[];
  if(!s.id)errors.push('id');
  if(s.slope<0||s.slope>1)errors.push('slope');
  if(s.moisture<0||s.moisture>1)errors.push('moisture');
  if(s.humidity<0||s.humidity>1)errors.push('humidity');
  if(s.wind<0||s.wind>1)errors.push('wind');
  if(s.visibility<0||s.visibility>1)errors.push('visibility');
  if(s.rain<0||s.rain>1)errors.push('rain');
  return{ok:errors.length===0,errors};
};

export const fieldQualityV67=(field=[],keys=[])=>{
  const errors=[...numericRangeChecksV67(field,keys)];
  return{ok:errors.length===0,errors,coverage:field.length};
};

export const digestStabilityV67=(runtimeA={},runtimeB={})=>runtimeA.digest===runtimeB.digest;

export const mutationContractV67=(runtime={})=>runtime.contract?.noWorldMutation===true;

export const authorityContractV67=(runtime={})=>runtime.contract?.placementAuthority==='WorldAssetPlacementPipeline.js'&&runtime.contract?.materialAuthority==='MaterialAssignmentCore.js';

export const telemetryHealthV67=(telemetry={})=>{
  const entries=Object.values(telemetry).filter(x=>x&&typeof x==='object');
  const valid=entries.filter(x=>x.valid===true||x.ok===true).length;
  return{entries:entries.length,valid,rate:entries.length?valid/entries.length:0};
};

export const qualityScoreV67=(runtime={})=>{
  const invariant=(mutationContractV67(runtime)?1:0)+(authorityContractV67(runtime)?1:0)+(validateEnvironmentRuntimeV67(runtime).ok?1:0);
  const health=telemetryHealthV67(runtime.telemetry);
  const digest=runtime.digest?1:0;
  return clamp01(invariant/3*.55+health.rate*.3+digest*.15);
};

export const qualityGateV67=(runtime={},release={})=>{
  const quality=qualityScoreV67(runtime);
  const releaseValid=validateReleaseGateV67(release).ok;
  return{quality,releaseValid,ready:quality>=.7&&releaseValid&&mutationContractV67(runtime)&&authorityContractV67(runtime)};
};

export const qualitySummaryV67=(runtime={})=>({
  quality:qualityScoreV67(runtime),
  telemetry:telemetryHealthV67(runtime.telemetry),
  readOnly:mutationContractV67(runtime),
  authority:authorityContractV67(runtime),
  samples:runtime.runtime?.sampleCount??0,
});

export const qualityDeltaV67=(before={},after={})=>qualityScoreV67(after)-qualityScoreV67(before);

export const invariantLedgerV67=(runtime={})=>({
  policy:QUALITY_V67.id,
  checks:[
    {id:'read-only',pass:mutationContractV67(runtime)},
    {id:'authorities',pass:authorityContractV67(runtime)},
    {id:'validated',pass:validateEnvironmentRuntimeV67(runtime).ok},
    {id:'digest',pass:Boolean(runtime.digest)},
  ],
});

export const validateQualityV67=(runtime={})=>{
  const ledger=invariantLedgerV67(runtime);
  const errors=ledger.checks.filter(x=>!x.pass).map(x=>x.id);
  return{ok:errors.length===0,errors,score:qualityScoreV67(runtime)};
};
