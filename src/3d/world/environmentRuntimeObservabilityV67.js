import { clamp01, hashV67, meanV67 } from './environmentRuntimeV67.js';
import { runtimeSummaryEnvelopeV67, runtimeQualityScoreV67 } from './environmentRuntimeIntegrationV67.js';
import { scenarioSummaryV67 } from './environmentRuntimeScenarioLedgerV67.js';
import { coverageSummaryV67 } from './environmentRuntimeCoverageMatrixV67.js';
import { releaseSummaryV67 } from './environmentRuntimeReleaseV67.js';

export const OBSERVABILITY_V67=Object.freeze({id:'observability-v67',version:67,deterministic:true,noWorldMutation:true});

export const domainHealthV67=(telemetry={})=>{
  const entries=Object.values(telemetry).filter(x=>x&&typeof x==='object');
  const valid=entries.filter(x=>x.valid===true||x.ok===true).length;
  return{entries:entries.length,valid,rate:entries.length?valid/entries.length:0};
};

export const domainFailureListV67=(telemetry={})=>Object.entries(telemetry).filter(([,value])=>!(value?.valid===true||value?.ok===true)).map(([key])=>key);

export const domainLatencyProxyV67=(telemetry={})=>{
  const counts=Object.values(telemetry).map(x=>Number(x?.summary?.samples??x?.summary?.links??0)).filter(Number.isFinite);
  return meanV67(counts);
};

export const confidenceV67=(runtime={},telemetry={})=>{
  const health=domainHealthV67(telemetry).rate;
  const quality=runtimeQualityScoreV67(runtime);
  const digest=runtime?.digest?1:0;
  return clamp01(health*.44+quality*.44+digest*.12);
};

export const buildEvidenceItemV67=(id,pass,detail='')=>({id,pass:Boolean(pass),detail});

export const buildObservabilityLedgerV67=(runtime={},ledger={})=>{
  const telemetry=runtime.telemetry??{};
  const summary=runtimeSummaryEnvelopeV67(runtime);
  const checks=[
    buildEvidenceItemV67('runtime',Boolean(runtime.policy),'integration policy present'),
    buildEvidenceItemV67('read-only',runtime.contract?.noWorldMutation===true,'mutation boundary'),
    buildEvidenceItemV67('placement',runtime.contract?.placementAuthority==='WorldAssetPlacementPipeline.js','placement authority'),
    buildEvidenceItemV67('material',runtime.contract?.materialAuthority==='MaterialAssignmentCore.js','material authority'),
    buildEvidenceItemV67('digest',Boolean(runtime.digest),'stable digest'),
    buildEvidenceItemV67('telemetry',domainHealthV67(telemetry).rate>=.9,'domain telemetry health'),
    buildEvidenceItemV67('scenarios',Boolean(ledger?.evaluations?.length),'scenario ledger'),
  ];
  return{
    policy:OBSERVABILITY_V67.id,
    checks,
    health:domainHealthV67(telemetry),
    failures:domainFailureListV67(telemetry),
    confidence:confidenceV67(runtime,telemetry),
    latencyProxy:domainLatencyProxyV67(telemetry),
    runtime:summary,
    scenario:scenarioSummaryV67(ledger),
    coverage:coverageSummaryV67(),
  };
};

export const observabilityScoreV67=(ledger={})=>clamp01(
  (ledger.checks??[]).filter(x=>x.pass).length/Math.max(1,(ledger.checks??[]).length)*.62+
  (ledger.health?.rate??0)*.23+
  (ledger.confidence??0)*.15,
);

export const observabilityDecisionV67=(score=0)=>score>=.88?'healthy':score>=.7?'degraded':'blocked';

export const buildReleaseEvidenceLedgerV67=(runtime={},release={},scenarioLedger={})=>{
  const observability=buildObservabilityLedgerV67(runtime,scenarioLedger);
  return{
    policy:OBSERVABILITY_V67.id,
    score:observabilityScoreV67(observability),
    decision:observabilityDecisionV67(observabilityScoreV67(observability)),
    observability,
    release:releaseSummaryV67(release),
    scenarios:scenarioSummaryV67(scenarioLedger),
    fingerprint:hashV67(JSON.stringify({runtime:runtime.digest,release:release.ready,scenario:scenarioLedger.evaluations?.length})),
  };
};

export const validateObservabilityV67=(ledger={})=>{
  const errors=[];
  if(ledger.policy!==OBSERVABILITY_V67.id)errors.push('policy');
  if(!ledger.observability)errors.push('observability');
  if(!Number.isFinite(ledger.score))errors.push('score');
  if(!['healthy','degraded','blocked'].includes(ledger.decision))errors.push('decision');
  if(!ledger.fingerprint)errors.push('fingerprint');
  return{ok:errors.length===0,errors};
};

export const observabilityTelemetryV67=(ledger={})=>({
  policy:OBSERVABILITY_V67.id,
  valid:validateObservabilityV67(ledger).ok,
  score:ledger.score??0,
  decision:ledger.decision??'blocked',
  failures:ledger.observability?.failures??[],
});

export const observabilityDeltaV67=(before={},after={})=>({
  score:(after.score??0)-(before.score??0),
  confidence:(after.observability?.confidence??0)-(before.observability?.confidence??0),
  failuresDelta:(after.observability?.failures?.length??0)-(before.observability?.failures?.length??0),
});

export const evidencePriorityV67=(item={})=>item.pass?clamp01(.8+(item.id==='read-only'?.15:0)):0;
export const unresolvedEvidenceV67=(ledger={})=>(ledger.checks??[]).filter(x=>!x.pass).map(x=>x.id);
export const evidenceCoverageV67=(ledger={})=>clamp01((ledger.checks??[]).filter(x=>x.pass).length/Math.max(1,(ledger.checks??[]).length));
export const observabilityReadyV67=(ledger={})=>observabilityDecisionV67(observabilityScoreV67(ledger))==='healthy';
