/**
 * Buzul Muhafızı — P0→P5 environment pass planner.
 *
 * This module never invents geography. It consumes canonical samples and emits
 * bounded render/placement instructions for existing world authorities.
 */
import type { EnvironmentSample, PhotorealismFrame } from './photorealismDirector.ts';
import { buildPhotorealismFrame, frameToMaterialRecipe, placementQueryFromFrame, validatePhotorealismFrame } from './photorealismDirector.ts';

export type VisualPriority = 'P0'|'P1'|'P2'|'P3'|'P4'|'P5';
export type VisualFailure =
  | 'rectangular-water-block'
  | 'grid-seam'
  | 'shoreline-step'
  | 'water-moire'
  | 'smooth-wall'
  | 'flat-ground'
  | 'snow-sheet'
  | 'sparse-canopy'
  | 'sterile-road-ribbon'
  | 'black-sky'
  | 'floating-asset'
  | 'material-mismatch';

export interface CanonicalEnvironmentObservation {
  readonly sample: EnvironmentSample;
  readonly renderedHeightMeters: number;
  readonly colliderHeightMeters: number;
  readonly shorelineGradient: number;
  readonly waterNormalRepeat: number;
  readonly skyLuminance: number;
  readonly visibleGridSeam: boolean;
  readonly visibleRectangularWater: boolean;
  readonly visibleSmoothWall: boolean;
  readonly visibleFlatGround: boolean;
  readonly visibleSnowSheet: boolean;
  readonly visibleSparseCanopy: boolean;
  readonly visibleRoadRibbon: boolean;
  readonly visibleFloatingAsset: boolean;
  readonly visibleMaterialMismatch: boolean;
}

export interface EnvironmentIssue {
  readonly priority: VisualPriority;
  readonly code: VisualFailure;
  readonly severity: number;
  readonly message: string;
  readonly evidence: Readonly<Record<string, number|string|boolean>>;
}

export interface EnvironmentPassPlan {
  readonly deterministicKey: string;
  readonly p0: Readonly<{ seamBlendMeters:number; shorelineBlendMeters:number; waterNormalFrequency:number; suppressRectangularWater:boolean; suppressGridOverlay:boolean }>;
  readonly p1: Readonly<{ ridgeBreakup:number; cliffExposure:number; screeBandMeters:number; microReliefMeters:number; parityToleranceMeters:number }>;
  readonly p2: Readonly<{ macroMeters:number; microMeters:number; triplanarBlend:number; snowlineMeters:number; wetEdgeMeters:number; antiTilingPhase:[number,number] }>;
  readonly p3: Readonly<{ canopyDensity:number; understoryDensity:number; shrubDensity:number; grassDensity:number; clearingRadiusMeters:number; instanceBatchSize:number; lodBias:number }>;
  readonly p4: Readonly<{ shorelineFade:number; foamWidthMeters:number; depthBlendMeters:number; normalScale:number; moireSuppression:number }>;
  readonly p5: Readonly<{ fogDensity:number; aerialPerspective:number; exposure:number; skyLuminance:number; blackSkyGuard:boolean }>;
  readonly issues: readonly EnvironmentIssue[];
  readonly health: Readonly<{ invalidFrame:boolean; visibleFailureCount:number; parityErrorMeters:number; acceptanceReady:boolean }>;
  readonly frame: PhotorealismFrame;
  readonly materialRecipe: ReturnType<typeof frameToMaterialRecipe>;
  readonly placementQuery: ReturnType<typeof placementQueryFromFrame>;
}

const clamp = (value:number,min=0,max=1):number => Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
const finite = (value:number,fallback:number):number => Number.isFinite(value)?value:fallback;
const smooth = (value:number):number => { const t=clamp(value); return t*t*(3-2*t); };
const abs = (value:number):number => Math.abs(finite(value,0));
const round4 = (value:number):number => Math.round(value*4)/4;
const priorityWeight:Record<VisualPriority,number> = { P0:6, P1:5, P2:4, P3:3, P4:2, P5:1 };

function parityError(observation:CanonicalEnvironmentObservation):number {
  return abs(observation.renderedHeightMeters-observation.colliderHeightMeters);
}

function pushIssue(list:EnvironmentIssue[], issue:EnvironmentIssue):void {
  list.push(Object.freeze(issue));
}

function inspectP0(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.visibleRectangularWater) pushIssue(list,{priority:'P0',code:'rectangular-water-block',severity:1,message:'Hydrology is rendered as a visible rectangular/tile block.',evidence:{waterDistance:observation.sample.waterDistanceMeters,waterLevel:observation.sample.waterLevelMeters}});
  if (observation.visibleGridSeam) pushIssue(list,{priority:'P0',code:'grid-seam',severity:1,message:'A visible grid/Pindex seam remains in the shipped surface.',evidence:{worldX:observation.sample.worldX,worldZ:observation.sample.worldZ}});
  if (observation.shorelineGradient<0.18) pushIssue(list,{priority:'P0',code:'shoreline-step',severity:clamp((0.18-observation.shorelineGradient)/0.18),message:'Shoreline gradient is too abrupt for a continuous canonical surface.',evidence:{shorelineGradient:observation.shorelineGradient}});
  if (observation.waterNormalRepeat>0.72) pushIssue(list,{priority:'P0',code:'water-moire',severity:clamp((observation.waterNormalRepeat-0.72)/0.28),message:'Water normal repetition risks visible stripe/moire artefacts.',evidence:{waterNormalRepeat:observation.waterNormalRepeat}});
}

function inspectP1(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.visibleSmoothWall) pushIssue(list,{priority:'P1',code:'smooth-wall',severity:0.88,message:'Mountain/cliff silhouette is a smooth wall or synthetic plateau.',evidence:{slopeDegrees:observation.sample.slopeDegrees,curvature:observation.sample.curvature}});
  const error=parityError(observation);
  if (error>0.35) pushIssue(list,{priority:'P1',code:'floating-asset',severity:clamp(error/2),message:'Rendered geometry and canonical collider diverge beyond placement tolerance.',evidence:{renderedHeight:observation.renderedHeightMeters,colliderHeight:observation.colliderHeightMeters,parityErrorMeters:error}});
}

function inspectP2(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.visibleFlatGround) pushIssue(list,{priority:'P2',code:'flat-ground',severity:0.8,message:'Ground material reads as a single flat colour with weak macro/micro breakup.',evidence:{moisture:observation.sample.moisture,rockWeight:observation.sample.rockWeight,curvature:observation.sample.curvature}});
  if (observation.visibleSnowSheet) pushIssue(list,{priority:'P2',code:'snow-sheet',severity:0.82,message:'Snow reads as a uniform sheet without snowline/ecotone breakup.',evidence:{snowWeight:observation.sample.snowWeight,temperature:observation.sample.temperature}});
}

function inspectP3(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.visibleSparseCanopy) pushIssue(list,{priority:'P3',code:'sparse-canopy',severity:0.74,message:'Forest/vegetation distribution is too sparse or isolated to read as a biome.',evidence:{forestDensity:observation.sample.forestDensity,slopeDegrees:observation.sample.slopeDegrees}});
  if (observation.visibleRoadRibbon) pushIssue(list,{priority:'P3',code:'sterile-road-ribbon',severity:0.62,message:'Road/line surface reads as a sterile ribbon without edge ecotone.',evidence:{roadDistanceMeters:observation.sample.roadDistanceMeters,moisture:observation.sample.moisture}});
}

function inspectP4(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.visibleMaterialMismatch) pushIssue(list,{priority:'P4',code:'material-mismatch',severity:0.76,message:'Surface recipe and rendered material response disagree.',evidence:{waterDistance:observation.sample.waterDistanceMeters,rockWeight:observation.sample.rockWeight,snowWeight:observation.sample.snowWeight}});
}

function inspectP5(observation:CanonicalEnvironmentObservation, list:EnvironmentIssue[]):void {
  if (observation.skyLuminance<0.2) pushIssue(list,{priority:'P5',code:'black-sky',severity:clamp((0.2-observation.skyLuminance)/0.2),message:'Sky/background is below the black-sky guard threshold.',evidence:{skyLuminance:observation.skyLuminance}});
}

function sortedIssues(issues:EnvironmentIssue[]):readonly EnvironmentIssue[] {
  return Object.freeze([...issues].sort((a,b)=>priorityWeight[b.priority]-priorityWeight[a.priority]||b.severity-a.severity||a.code.localeCompare(b.code)));
}

function buildP0(frame:PhotorealismFrame, issues:readonly EnvironmentIssue[]):EnvironmentPassPlan['p0'] {
  const seam = issues.some(i=>i.code==='grid-seam') ? 14 : 8;
  const shoreline = issues.some(i=>i.code==='shoreline-step') ? 22 : 12;
  return Object.freeze({seamBlendMeters:seam,shorelineBlendMeters:shoreline,waterNormalFrequency:clamp(0.16+frame.water.normalScale*.38,.12,.46),suppressRectangularWater:issues.some(i=>i.code==='rectangular-water-block'),suppressGridOverlay:issues.some(i=>i.code==='grid-seam')});
}
function buildP1(frame:PhotorealismFrame, observation:CanonicalEnvironmentObservation):EnvironmentPassPlan['p1'] {
  const ridge=clamp(frame.weights.rock+frame.weights.scree+abs(observation.sample.curvature)*.4);
  const cliff=clamp((observation.sample.slopeDegrees-18)/52+frame.weights.rock*.4);
  return Object.freeze({ridgeBreakup:clamp(ridge*.78+.18),cliffExposure:clamp(cliff),screeBandMeters:round4(3+cliff*14),microReliefMeters:round4(.08+ridge*.45),parityToleranceMeters:.35});
}
function buildP2(frame:PhotorealismFrame):EnvironmentPassPlan['p2'] {
  return Object.freeze({macroMeters:frame.antiTiling.macroMeters,microMeters:frame.antiTiling.microMeters,triplanarBlend:frame.antiTiling.triplanarBlend,snowlineMeters:round4(3+frame.weights.snow*18),wetEdgeMeters:round4(2+frame.water.foam*7),antiTilingPhase:[round4(frame.antiTiling.phaseX),round4(frame.antiTiling.phaseZ)] as [number,number]});
}
function buildP3(frame:PhotorealismFrame, observation:CanonicalEnvironmentObservation):EnvironmentPassPlan['p3'] {
  const canopy=frame.vegetation.find(v=>v.family==='canopy')?.density??0;
  const understory=frame.vegetation.find(v=>v.family==='understory')?.density??0;
  const shrub=frame.vegetation.find(v=>v.family==='shrub')?.density??0;
  const grass=frame.vegetation.find(v=>v.family==='grass'||v.family==='reed'||v.family==='moss')?.density??0;
  return Object.freeze({canopyDensity:clamp(canopy*.92+observation.sample.forestDensity*.18),understoryDensity:clamp(understory*1.08),shrubDensity:clamp(shrub*1.12),grassDensity:clamp(grass*1.08),clearingRadiusMeters:round4(7+frame.weights.road*18+frame.weights['wet-edge']*4),instanceBatchSize:frame.performance.instanceBatchSize,lodBias:frame.performance.lodBias});
}
function buildP4(frame:PhotorealismFrame, issues:readonly EnvironmentIssue[]):EnvironmentPassPlan['p4'] {
  const moire=issues.find(i=>i.code==='water-moire')?.severity??0;
  return Object.freeze({shorelineFade:frame.water.shorelineFade,foamWidthMeters:round4(1.5+frame.water.foam*7),depthBlendMeters:round4(6+frame.water.shorelineFade*18),normalScale:clamp(frame.water.normalScale*(1-moire*.28),.14,.52),moireSuppression:clamp(moire+.25)});
}
function buildP5(frame:PhotorealismFrame, observation:CanonicalEnvironmentObservation):EnvironmentPassPlan['p5'] {
  return Object.freeze({fogDensity:frame.atmosphere.fogDensity,aerialPerspective:frame.atmosphere.aerialPerspective,exposure:frame.atmosphere.exposure,skyLuminance:Math.max(frame.atmosphere.skyLuminance,observation.skyLuminance),blackSkyGuard:observation.skyLuminance<.2});
}

export function buildEnvironmentPassPlan(seed:number, observation:CanonicalEnvironmentObservation):EnvironmentPassPlan {
  const frame=buildPhotorealismFrame(seed,observation.sample);
  const issues:EnvironmentIssue[]=[];
  inspectP0(observation,issues); inspectP1(observation,issues); inspectP2(observation,issues); inspectP3(observation,issues); inspectP4(observation,issues); inspectP5(observation,issues);
  const sorted=sortedIssues(issues);
  const invalidFrame=validatePhotorealismFrame(frame).length>0;
  const error=parityError(observation);
  const visibleFailureCount=sorted.length;
  const acceptanceReady=!invalidFrame&&visibleFailureCount===0&&error<=.35&&observation.skyLuminance>=.2;
  return Object.freeze({deterministicKey:`buzul|env-pass-v1|${Math.trunc(seed)}|${Math.round(observation.sample.worldX*4)/4}|${Math.round(observation.sample.worldZ*4)/4}`,p0:buildP0(frame,sorted),p1:buildP1(frame,observation),p2:buildP2(frame),p3:buildP3(frame,observation),p4:buildP4(frame,sorted),p5:buildP5(frame,observation),issues:sorted,health:Object.freeze({invalidFrame,visibleFailureCount,parityErrorMeters:error,acceptanceReady}),frame,materialRecipe:frameToMaterialRecipe(frame),placementQuery:placementQueryFromFrame(frame)});
}

export function mergeEnvironmentPassPlans(plans:readonly EnvironmentPassPlan[]):Readonly<{count:number;acceptanceReady:boolean;visibleFailureCount:number;maxParityErrorMeters:number;priorities:Readonly<Record<VisualPriority,number>>}> {
  const priorities:Record<VisualPriority,number>={P0:0,P1:0,P2:0,P3:0,P4:0,P5:0};
  let maxParity=0; let failures=0; let ready=plans.length>0;
  for(const plan of plans){ failures+=plan.health.visibleFailureCount; maxParity=Math.max(maxParity,plan.health.parityErrorMeters); ready=ready&&plan.health.acceptanceReady; for(const issue of plan.issues)priorities[issue.priority]++; }
  return Object.freeze({count:plans.length,acceptanceReady:ready,visibleFailureCount:failures,maxParityErrorMeters:maxParity,priorities:Object.freeze(priorities)});
}
