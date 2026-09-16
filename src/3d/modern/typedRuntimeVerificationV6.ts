import type { RuntimeHealthV4 } from './runtimeContractsV4';
import type { MigrationGateReportV6 } from './typedMigrationGateV6';
import type { LegacySurfaceRegistryV6 } from './typedLegacySurfaceV6';
import type { RuntimeFacadeSnapshotV6 } from './typedRuntimeFacadeV6';

export interface VerificationContextV6{
 readonly buildId:string;readonly health:RuntimeHealthV4;readonly snapshot:RuntimeFacadeSnapshotV6;readonly migration:MigrationGateReportV6;readonly legacy:LegacySurfaceRegistryV6;readonly typecheckPassed:boolean;readonly testsPassed:boolean;readonly deterministicPassed:boolean;readonly forbiddenPrimitiveCount:number;readonly assetFailures:number;readonly networkErrors:number;
}
export interface VerificationGateV6{readonly name:string;readonly passed:boolean;readonly blocking:boolean;readonly detail:string;}
export interface VerificationReportV6{readonly version:6;readonly buildId:string;readonly timestamp:number;readonly passed:boolean;readonly score:number;readonly gates:readonly VerificationGateV6[];readonly blockers:readonly string[];readonly recommendations:readonly string[];}
export interface VerificationConfigV6{readonly minHealth?:number;readonly minMigrationPromoted?:number;readonly maxLegacyP0Pending?:number;readonly maxForbidden?:number;readonly maxAssetFailures?:number;readonly maxNetworkErrors?:number;readonly minQuality?:number;}

const defaults:Required<VerificationConfigV6>={minHealth:80,minMigrationPromoted:0,maxLegacyP0Pending:2,maxForbidden:0,maxAssetFailures:0,maxNetworkErrors:0,minQuality:1};
const qualityRank=(q:string):number=>({minimal:0,low:1,medium:2,high:3,ultra:4}[q]??0);
const gate=(name:string,passed:boolean,detail:string,blocking=true):VerificationGateV6=>Object.freeze({name,passed,blocking,detail});

export class TypedRuntimeVerificationV6{
 readonly config:Required<VerificationConfigV6>;
 constructor(config:VerificationConfigV6={}){this.config=Object.freeze({...defaults,...config});}
 evaluate(context:VerificationContextV6):VerificationReportV6{
  const metrics=context.legacy.metrics();const gates:VerificationGateV6[]=[];
  gates.push(gate('build-id',context.buildId.trim().length>0,context.buildId.trim()?'build id present':'build id missing'));
  gates.push(gate('health',context.health.score>=this.config.minHealth&&!context.health.stalled,`health=${context.health.score.toFixed(1)} stalled=${context.health.stalled}`));
  gates.push(gate('snapshot',context.snapshot.version===6&&String(context.snapshot.runtime).length>0,`snapshot version=${context.snapshot.version}`));
  gates.push(gate('typecheck',context.typecheckPassed,context.typecheckPassed?'typecheck passed':'typecheck failed'));
  gates.push(gate('tests',context.testsPassed,context.testsPassed?'tests passed':'tests failed'));
  gates.push(gate('deterministic',context.deterministicPassed,context.deterministicPassed?'deterministic guard passed':'deterministic guard failed'));
  gates.push(gate('forbidden-primitives',context.forbiddenPrimitiveCount<=this.config.maxForbidden,`count=${context.forbiddenPrimitiveCount}`));
  gates.push(gate('asset-integrity',context.assetFailures<=this.config.maxAssetFailures,`failures=${context.assetFailures}`));
  gates.push(gate('network-protocol',context.networkErrors<=this.config.maxNetworkErrors,`errors=${context.networkErrors}`));
  gates.push(gate('quality',qualityRank(context.snapshot.metrics.quality)>=this.config.minQuality,`quality=${context.snapshot.metrics.quality}`));
  gates.push(gate('migration',context.migration.promoted>=this.config.minMigrationPromoted,`promoted=${context.migration.promoted} required=${this.config.minMigrationPromoted}`));
  gates.push(gate('legacy-p0',metrics.p0Pending<=this.config.maxLegacyP0Pending,`p0 pending=${metrics.p0Pending}`));
  const blockers=gates.filter(g=>g.blocking&&!g.passed).map(g=>`${g.name}: ${g.detail}`);const score=Math.max(0,Math.min(100,(gates.filter(g=>g.passed).length/gates.length)*100));const recs:string[]=[];
  if(metrics.p0Pending>this.config.maxLegacyP0Pending)recs.push('Reduce P0 legacy surfaces before promotion.');
  if(context.migration.pending>0)recs.push('Collect additional parity observations for pending surfaces.');
  if(qualityRank(context.snapshot.metrics.quality)<3)recs.push('Run performance tuning before enabling high quality.');
  if(context.health.renderPressure>0.7)recs.push('Inspect render pressure and lower presentation complexity before simulation budgets.');
  return Object.freeze({version:6,buildId:context.buildId,timestamp:Date.now(),passed:blockers.length===0,score,gates:Object.freeze(gates),blockers:Object.freeze(blockers),recommendations:Object.freeze(recs)});
 }
 assert(context:VerificationContextV6):VerificationReportV6{const report=this.evaluate(context);if(!report.passed)throw new Error(`Runtime verification failed: ${report.blockers.join('; ')}`);return report;}
}

export function verificationDigestV6(report:VerificationReportV6):string{const text=JSON.stringify(report);let hash=2166136261;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
export function verificationSummaryV6(report:VerificationReportV6):string{return`${report.passed?'PASS':'FAIL'} ${report.buildId} score=${report.score.toFixed(1)} gates=${report.gates.filter(g=>g.passed).length}/${report.gates.length}${report.blockers.length?` blockers=${report.blockers.length}`:''}`;}
export function mergeVerificationReportsV6(reports:readonly VerificationReportV6[]):VerificationReportV6|null{if(reports.length===0)return null;const first=reports[0]!;const gates=new Map<string,VerificationGateV6>();for(const report of reports)for(const current of report.gates){const previous=gates.get(current.name);if(!previous)gates.set(current.name,current);else gates.set(current.name,Object.freeze({ ...previous,passed:previous.passed&&current.passed,detail:previous.passed&&current.passed?previous.detail:`${previous.detail} | ${current.detail}`}));}const mergedGates=Object.freeze([...gates.values()]);const blockers=Object.freeze(mergedGates.filter(g=>g.blocking&&!g.passed).map(g=>`${g.name}: ${g.detail}`));return Object.freeze({version:6,buildId:first.buildId,timestamp:Math.max(...reports.map(r=>r.timestamp)),passed:blockers.length===0,score:(mergedGates.filter(g=>g.passed).length/Math.max(1,mergedGates.length))*100,gates:mergedGates,blockers,recommendations:Object.freeze([...new Set(reports.flatMap(r=>r.recommendations))])});}
