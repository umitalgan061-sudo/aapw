import { clamp01, meanV67 } from './environmentRuntimeV67.js';
import { acceptanceGateV67, runtimeQualityScoreV67 } from './environmentRuntimeIntegrationV67.js';
import { validateCoverageMatrixV67 } from './environmentRuntimeCoverageMatrixV67.js';
import { V67_SCENARIOS, validateScenarioLedgerV67 } from './environmentRuntimeScenarioLedgerV67.js';

export const RELEASE_V67=Object.freeze({
  id:'release-v67',
  version:67,
  deterministic:true,
  noWorldMutation:true,
  minimumQuality:.58,
});

export const requiredEvidenceV67=(runtime={})=>({
  contract:runtime.contract?.noWorldMutation===true,
  policy:runtime.policy==='environment-runtime-integration-v67',
  digest:Boolean(runtime.digest),
  samples:(runtime.runtime?.sampleCount??0)>0,
  domains:['hydrology','weatherField','surface','atmosphere','wildlife','hazards','navigation','vegetation','climate','acoustics','resonance','continuity','shelter','visibility','coupling','geology']
    .every(key=>Array.isArray(runtime[key])),
});

export const evidenceScoreV67=(evidence={})=>{
  const values=Object.values(evidence).filter(v=>typeof v==='boolean');
  return values.length?values.filter(Boolean).length/values.length:0;
};

export const releaseBudgetV67=({platform='desktop',admitted=0,total=0}={})=>{
  const limit=platform==='mobile'?.72:platform==='tablet'?.84:1;
  const usage=total?admitted/total:0;
  return {usage,limit,headroom:limit-usage,within:usage<=limit};
};

export const buildReleaseGateV67=(runtime={},context={})=>{
  const acceptance=acceptanceGateV67(runtime);
  const evidence=requiredEvidenceV67(runtime);
  const score=runtimeQualityScoreV67(runtime);
  const stream=releaseBudgetV67(context);
  const matrixValid=validateCoverageMatrixV67();
  return {
    policy:RELEASE_V67.id,
    acceptance,
    evidence,
    evidenceScore:evidenceScoreV67(evidence),
    quality:score,
    stream,
    coverage:matrixValid,
    scenarios:V67_SCENARIOS.length,
    ready:acceptance.ok&&score>=RELEASE_V67.minimumQuality&&evidenceScoreV67(evidence)>=.92&&stream.within&&matrixValid,
  };
};

export const releaseDecisionV67=(gate={})=>gate.ready?'ship':'hold';

export const compareReleaseGatesV67=(before={},after={})=>({
  before:releaseDecisionV67(before),
  after:releaseDecisionV67(after),
  qualityDelta:(after.quality??0)-(before.quality??0),
  evidenceDelta:(after.evidenceScore??0)-(before.evidenceScore??0),
});

export const releaseSummaryV67=(gate={})=>({
  decision:releaseDecisionV67(gate),
  quality:clamp01(gate.quality),
  evidence:clamp01(gate.evidenceScore),
  streamHeadroom:gate.stream?.headroom??0,
  scenarioCoverage:gate.scenarios??0,
});

export const validateReleaseGateV67=(gate={})=>{
  const errors=[];
  if(gate.policy!==RELEASE_V67.id)errors.push('policy');
  if(typeof gate.ready!=='boolean')errors.push('ready');
  if(gate.evidenceScore<0||gate.evidenceScore>1)errors.push('evidence');
  if(gate.quality<0||gate.quality>1)errors.push('quality');
  if(typeof gate.coverage!=='boolean')errors.push('coverage');
  return{ok:errors.length===0,errors};
};

export const releaseTelemetryV67=(gate={})=>({
  policy:RELEASE_V67.id,
  valid:validateReleaseGateV67(gate).ok,
  summary:releaseSummaryV67(gate),
  averageSignals:meanV67([gate.quality??0,gate.evidenceScore??0]),
});

export const scenarioLedgerEvidenceV67=(ledger={})=>({
  present:Array.isArray(ledger.evaluations),
  valid:validateScenarioLedgerV67(ledger).ok,
  coverage:ledger.evaluations?.length??0,
});
