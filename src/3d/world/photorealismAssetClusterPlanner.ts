/**
 * Asset-first environment cluster planner.
 *
 * Plans only; hydrate/load, surface analysis, validation, ground transform,
 * manifest creation and scene attachment remain owned by the shared pipeline.
 */
import type { EnvironmentSample, PhotorealismFrame } from './photorealismDirector.ts';
import type { EnvironmentPassPlan } from './photorealismEnvironmentPass.ts';

export type EnvironmentAssetFamily='tree'|'shrub'|'grass'|'reed'|'moss'|'rock'|'scree'|'snow'|'cliff'|'decal';
export type AssetLod='hero'|'near'|'mid'|'far'|'impostor';

export interface AssetCatalogEntry {
  readonly id:string;
  readonly family:EnvironmentAssetFamily;
  readonly sourcePath:string;
  readonly derivedGlbPath?:string;
  readonly materialSlots:readonly string[];
  readonly lods:readonly AssetLod[];
  readonly boundsRadiusMeters:number;
  readonly minSlope:number;
  readonly maxSlope:number;
  readonly minHeight:number;
  readonly maxHeight:number;
  readonly requiresDryGround:boolean;
  readonly supportsInstancing:boolean;
}

export interface ClusterSeed {
  readonly x:number;
  readonly z:number;
  readonly yaw:number;
  readonly scale:number;
  readonly sample:EnvironmentSample;
  readonly frame:PhotorealismFrame;
}

export interface PlannedInstance {
  readonly assetId:string;
  readonly family:EnvironmentAssetFamily;
  readonly lod:AssetLod;
  readonly x:number;
  readonly z:number;
  readonly yaw:number;
  readonly scale:number;
  readonly groundOffsetMeters:number;
  readonly materialSurfaceHints:readonly string[];
  readonly instanceBatchKey:string;
  readonly placementReasons:readonly string[];
}

export interface ClusterPlan {
  readonly deterministicKey:string;
  readonly family:EnvironmentAssetFamily;
  readonly instances:readonly PlannedInstance[];
  readonly rejected:number;
  readonly batchCount:number;
  readonly cullDistanceMeters:number;
  readonly manifestSource:string;
}

const c=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const finite=(v:number,f:number)=>Number.isFinite(v)?v:f;
const hash=(x:number,z:number,seed:number)=>{const v=Math.sin((x+seed*.11)*91.17+(z-seed*.07)*47.31)*43758.5453;return v-Math.floor(v)};
const choose=<T,>(items:readonly T[],seed:number):T|undefined=>items.length?items[Math.min(items.length-1,Math.floor(c(seed)*items.length))]:undefined;

function familyAllowed(family:EnvironmentAssetFamily, frame:PhotorealismFrame):boolean {
  if(family==='tree')return frame.placement.allowTree;
  if(family==='shrub')return frame.placement.allowShrub;
  if(family==='grass'||family==='reed'||family==='moss')return frame.placement.allowGrass;
  if(family==='rock')return frame.placement.allowRock;
  if(family==='scree')return frame.placement.allowScree;
  return true;
}

function slopeAllowed(entry:AssetCatalogEntry,sample:EnvironmentSample):boolean {
  return sample.slopeDegrees>=entry.minSlope&&sample.slopeDegrees<=entry.maxSlope;
}
function heightAllowed(entry:AssetCatalogEntry,sample:EnvironmentSample):boolean {
  return sample.heightMeters>=entry.minHeight&&sample.heightMeters<=entry.maxHeight;
}
function dryGroundAllowed(entry:AssetCatalogEntry,sample:EnvironmentSample,frame:PhotorealismFrame):boolean {
  return !entry.requiresDryGround||(frame.weights['deep-water']<.06&&sample.waterDistanceMeters>=1.25);
}
function lodFor(distance:number,frame:PhotorealismFrame):AssetLod {
  const bias=frame.performance.lodBias;
  if(distance<18*bias)return'hero';
  if(distance<48*bias)return'near';
  if(distance<120*bias)return'mid';
  if(distance<260*bias)return'far';
  return'impostor';
}
function materialHints(frame:PhotorealismFrame):readonly string[] {
  return Object.freeze(Object.entries(frame.weights).filter(([,v])=>v>.06).map(([key])=>key));
}
function instanceBatchKey(entry:AssetCatalogEntry,frame:PhotorealismFrame,lod:AssetLod):string {
  return `${entry.id}|${entry.family}|${lod}|${frame.biome}|${frame.dominantSurface}|${frame.manifest.materialAuthority}`;
}

export function planEnvironmentCluster(seed:number,family:EnvironmentAssetFamily,entries:readonly AssetCatalogEntry[],seeds:readonly ClusterSeed[],pass:EnvironmentPassPlan):ClusterPlan {
  const candidates=entries.filter(entry=>entry.family===family&&entry.supportsInstancing);
  const instances:PlannedInstance[]=[];
  let rejected=0;
  for(const clusterSeed of seeds){
    const frame=clusterSeed.frame;
    if(!familyAllowed(family,frame)){rejected++;continue;}
    const entry=choose(candidates,hash(clusterSeed.x,clusterSeed.z,seed));
    if(!entry||!slopeAllowed(entry,clusterSeed.sample)||!heightAllowed(entry,clusterSeed.sample)||!dryGroundAllowed(entry,clusterSeed.sample,frame)){rejected++;continue;}
    const distance=Math.hypot(clusterSeed.x,clusterSeed.z);
    const lod=lodFor(distance,frame);
    const scale=finite(clusterSeed.scale,1)*(family==='tree'?.92+hash(clusterSeed.x,clusterSeed.z,seed+3)*.34:family==='rock'? .78+hash(clusterSeed.x,clusterSeed.z,seed+4)*.58: .72+hash(clusterSeed.x,clusterSeed.z,seed+5)*.42);
    const groundOffset=family==='rock'||family==='scree'?0.015:0;
    instances.push(Object.freeze({assetId:entry.id,family,lod,x:clusterSeed.x,z:clusterSeed.z,yaw:clusterSeed.yaw,scale,groundOffsetMeters:groundOffset,materialSurfaceHints:materialHints(frame),instanceBatchKey:instanceBatchKey(entry,frame,lod),placementReasons:frame.placement.reasons}));
  }
  const batchCount=new Set(instances.map(instance=>instance.instanceBatchKey)).size;
  const cullDistanceMeters=family==='tree'?420:family==='rock'||family==='cliff'?360:240;
  return Object.freeze({deterministicKey:`buzul|asset-cluster-v1|${Math.trunc(seed)}|${family}|${pass.deterministicKey}`,family,instances:Object.freeze(instances),rejected,batchCount,cullDistanceMeters,manifestSource:'WorldAssetPlacementPipeline.js -> MaterialAssignmentCore.js'});
}

export function buildDeterministicClusterSeeds(seed:number,family:EnvironmentAssetFamily,samples:readonly {sample:EnvironmentSample;frame:PhotorealismFrame}[],pass:EnvironmentPassPlan):readonly ClusterSeed[] {
  const density=family==='tree'?pass.p3.canopyDensity:family==='shrub'?pass.p3.shrubDensity:family==='rock'||family==='scree'?pass.p1.ridgeBreakup:pass.p3.grassDensity;
  const stride=family==='tree'?11:family==='rock'||family==='scree'?18:7;
  const seeds:ClusterSeed[]=[];
  for(let index=0;index<samples.length;index++){
    const item=samples[index];
    const p=hash(item.sample.worldX,index*stride+item.sample.worldZ,seed+index);
    if(p>c(density*.94+.04))continue;
    const jitterX=(hash(item.sample.worldX+index,item.sample.worldZ,seed+11)-.5)*stride;
    const jitterZ=(hash(item.sample.worldX,item.sample.worldZ+index,seed+13)-.5)*stride;
    seeds.push(Object.freeze({x:item.sample.worldX+jitterX,z:item.sample.worldZ+jitterZ,yaw:hash(item.sample.worldX,item.sample.worldZ,seed+17)*Math.PI*2,scale:.82+hash(item.sample.worldX,index,seed+19)*.36,sample:item.sample,frame:item.frame}));
  }
  return Object.freeze(seeds);
}

export function summarizeClusterPlans(plans:readonly ClusterPlan[]):Readonly<{families:number;instances:number;rejected:number;batchCount:number;byLod:Readonly<Record<AssetLod,number>>}> {
  const byLod:Record<AssetLod,number>={hero:0,near:0,mid:0,far:0,impostor:0};
  let instances=0,rejected=0,batchCount=0;
  for(const plan of plans){instances+=plan.instances.length;rejected+=plan.rejected;batchCount+=plan.batchCount;for(const item of plan.instances)byLod[item.lod]++;}
  return Object.freeze({families:plans.length,instances,rejected,batchCount,byLod:Object.freeze(byLod)});
}
