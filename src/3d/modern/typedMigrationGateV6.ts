import type { RuntimeId } from './runtimeContractsV4';
import type { MigrationSurfaceV4 } from './migrationV4';
import { type MigrationRegistryV4 } from './migrationV4';

export type MigrationPhaseV6='inventory'|'shadow'|'parity'|'promoted'|'blocked';
export interface MigrationSurfacePolicyV6{readonly surface:MigrationSurfaceV4;readonly owner:string;readonly risk:'low'|'medium'|'high'|'critical';readonly requiredSamples:number;readonly maxMismatchRate:number;readonly enabled:boolean;}
export interface MigrationObservationV6{readonly surface:MigrationSurfaceV4;readonly tick:number;readonly legacyDigest:string;readonly modernDigest:string;readonly matched:boolean;readonly latencyMs:number;readonly timestamp:number;}
export interface MigrationGateResultV6{readonly surface:MigrationSurfaceV4;readonly phase:MigrationPhaseV6;readonly ready:boolean;readonly samples:number;readonly mismatches:number;readonly mismatchRate:number;readonly averageLatencyMs:number;readonly reasons:readonly string[];}
export interface MigrationGateReportV6{readonly runtime:RuntimeId;readonly generatedAt:number;readonly ready:boolean;readonly promoted:number;readonly blocked:number;readonly pending:number;readonly results:readonly MigrationGateResultV6[];}

const SURFACES:readonly MigrationSurfaceV4[]=['input','movement','camera','world','render','audio','assets','save','network','telemetry'];
const DEFAULT_POLICY:Omit<MigrationSurfacePolicyV6,'surface'>=Object.freeze({owner:'engine',risk:'high',requiredSamples:60,maxMismatchRate:0,enabled:true});
const key=(surface:MigrationSurfaceV4)=>surface;
const digest=(value:unknown):string=>{const text=JSON.stringify(value);let hash=2166136261;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};

export class TypedMigrationGateV6{
 readonly runtime:RuntimeId;readonly registry:MigrationRegistryV4;#policies=new Map<MigrationSurfaceV4,MigrationSurfacePolicyV6>();#observations=new Map<MigrationSurfaceV4,MigrationObservationV6[]>();
 constructor(runtime:RuntimeId,registry?:MigrationRegistryV4){this.runtime=runtime;this.registry=registry??new MigrationRegistryV4(runtime);for(const surface of SURFACES){this.#policies.set(surface,Object.freeze({surface,...DEFAULT_POLICY}));this.#observations.set(surface,[]);}}
 policy(surface:MigrationSurfaceV4):MigrationSurfacePolicyV6{return this.#policies.get(surface)!;}
 configure(policy:MigrationSurfacePolicyV6):void{if(!SURFACES.includes(policy.surface))throw new Error('Unknown migration surface');this.#policies.set(policy.surface,Object.freeze({...policy,requiredSamples:Math.max(1,Math.trunc(policy.requiredSamples)),maxMismatchRate:Math.max(0,Math.min(1,policy.maxMismatchRate))}));}
 observe(surface:MigrationSurfaceV4,legacy:unknown,modern:unknown,tick:number,latencyMs=0,timestamp=Date.now()):MigrationObservationV6{const observation:Object&MigrationObservationV6=Object.freeze({surface,tick:Math.max(0,Math.trunc(tick)),legacyDigest:digest(legacy),modernDigest:digest(modern),matched:digest(legacy)===digest(modern),latencyMs:Math.max(0,Number.isFinite(latencyMs)?latencyMs:0),timestamp});const list=this.#observations.get(surface)!;list.push(observation);if(list.length>512)list.splice(0,list.length-512);this.#observations.set(surface,list);this.registry.record(surface,legacy,modern,'system',timestamp);return observation;}
 observations(surface:MigrationSurfaceV4):readonly MigrationObservationV6[]{return Object.freeze(this.#observations.get(surface)!.slice());}
 evaluate(surface:MigrationSurfaceV4):MigrationGateResultV6{const policy=this.policy(surface);const samples=this.observations(surface);const mismatches=samples.filter(o=>!o.matched).length;const mismatchRate=samples.length?mismatches/samples.length:0;const averageLatency=samples.length?samples.reduce((sum,o)=>sum+o.latencyMs,0)/samples.length:0;const reasons:string[]=[];let phase:MigrationPhaseV6='inventory';if(!policy.enabled){reasons.push('surface disabled');phase='blocked';}else if(mismatches>0&&mismatchRate>policy.maxMismatchRate){reasons.push(`mismatch rate ${mismatchRate.toFixed(4)} exceeds ${policy.maxMismatchRate.toFixed(4)}`);phase='blocked';}else if(samples.length<policy.requiredSamples){reasons.push(`samples ${samples.length}/${policy.requiredSamples}`);phase='shadow';}else{phase='parity';}const registryStatus=this.registry.status(surface);if(registryStatus==='promoted')phase='promoted';if(registryStatus==='blocked')phase='blocked';const ready=phase==='promoted'||phase==='parity';if(phase==='parity')reasons.push('parity evidence satisfies sample gate');return Object.freeze({surface,phase,ready,samples:samples.length,mismatches,mismatchRate,averageLatencyMs:averageLatency,reasons:Object.freeze(reasons)});}
 promote(surface:MigrationSurfaceV4):boolean{const result=this.evaluate(surface);if(!result.ready||result.mismatchRate>this.policy(surface).maxMismatchRate)return false;return this.registry.promote(surface).ok;}
 block(surface:MigrationSurfaceV4):void{this.registry.block(surface);}
 reset(surface?:MigrationSurfaceV4):void{if(surface)this.#observations.set(surface,[]);else for(const entry of SURFACES)this.#observations.set(entry,[]);this.registry.reset(surface);}
 report():MigrationGateReportV6{const results=SURFACES.map(surface=>this.evaluate(surface));const promoted=results.filter(r=>r.phase==='promoted').length;const blocked=results.filter(r=>r.phase==='blocked').length;const pending=results.length-promoted-blocked;return Object.freeze({runtime:this.runtime,generatedAt:Date.now(),ready:blocked===0&&pending===0,promoted,blocked,pending,results:Object.freeze(results)});}
 assertReady(required:SURFACES_SELECT_V6=SURFACES):void{const report=this.report();const pending=required.filter(surface=>this.evaluate(surface).phase!=='promoted');if(pending.length)throw new Error(`Migration gate blocked: ${pending.join(', ')}`);}
}
export type SURFACES_SELECT_V6=readonly MigrationSurfaceV4[];
export function createMigrationGateV6(runtime:RuntimeId):TypedMigrationGateV6{return new TypedMigrationGateV6(runtime);}
export function digestPairV6(legacy:unknown,modern:unknown):readonly[string,string]{return Object.freeze([digest(legacy),digest(modern)]);}
