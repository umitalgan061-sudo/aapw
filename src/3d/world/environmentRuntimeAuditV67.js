import { V67_POLICY } from './environmentRuntimeV67.js';
import { validateEnvironmentRuntimeV67 } from './environmentRuntimeIntegrationV67.js';
import { validateCoverageMatrixV67, coverageSummaryV67 } from './environmentRuntimeCoverageMatrixV67.js';
import { validateScenarioLedgerV67, scenarioSummaryV67 } from './environmentRuntimeScenarioLedgerV67.js';
import { validatePerformanceV67 } from './environmentRuntimePerformanceV67.js';
import { validateQualityV67 } from './environmentRuntimeQualityV67.js';

export const AUDIT_V67=Object.freeze({id:'audit-v67',version:67,deterministic:true,noWorldMutation:true});

export const buildAuditChecksV67=(runtime={},ledger={},performance={})=>[
  {id:'policy',pass:runtime.policy==='environment-runtime-integration-v67'},
  {id:'version',pass:runtime.contract?.version===67},
  {id:'deterministic',pass:runtime.contract?.deterministic===true},
  {id:'read-only',pass:runtime.contract?.noWorldMutation===true},
  {id:'placement-authority',pass:runtime.contract?.placementAuthority==='WorldAssetPlacementPipeline.js'},
  {id:'material-authority',pass:runtime.contract?.materialAuthority==='MaterialAssignmentCore.js'},
  {id:'core-runtime',pass:validateEnvironmentRuntimeV67(runtime).ok},
  {id:'coverage-matrix',pass:validateCoverageMatrixV67()},
  {id:'scenario-ledger',pass:validateScenarioLedgerV67(ledger).ok},
  {id:'performance',pass:validatePerformanceV67(performance).ok},
  {id:'quality',pass:validateQualityV67(runtime).ok},
];

export const auditScoreV67=(checks=[])=>checks.length?checks.filter(x=>x.pass).length/checks.length:0;
export const auditDecisionV67=(score=0)=>score>=.9?'pass':score>=.75?'review':'fail';
export const auditSummaryV67=(checks=[])=>({checks:checks.length,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).map(x=>x.id),score:auditScoreV67(checks),decision:auditDecisionV67(auditScoreV67(checks))});
export const buildAuditReportV67=(runtime={},ledger={},performance={})=>{const checks=buildAuditChecksV67(runtime,ledger,performance);return{policy:AUDIT_V67.id,checks,summary:auditSummaryV67(checks),coverage:coverageSummaryV67(),scenarios:scenarioSummaryV67(ledger)};};
export const validateAuditV67=(report={})=>{const errors=[];if(report.policy!==AUDIT_V67.id)errors.push('policy');if(!report.summary)errors.push('summary');if(!Array.isArray(report.checks))errors.push('checks');return{ok:errors.length===0,errors};};
export const auditTelemetryV67=(report={})=>({policy:AUDIT_V67.id,valid:validateAuditV67(report).ok,summary:report.summary});
export const p0MatrixV67=(checks=[])=>checks.filter(x=>['read-only','placement-authority','material-authority','core-runtime'].includes(x.id));
export const p0PassV67=(checks=[])=>p0MatrixV67(checks).every(x=>x.pass);
export const auditReleaseEvidenceV67=(report={})=>({p0:p0PassV67(report.checks??[]),score:report.summary?.score??0,decision:report.summary?.decision??'fail'});
export const auditPolicyV67=()=>V67_POLICY;
