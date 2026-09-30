/**
 * Offline calibration helpers for traversal presentation tuning.
 * Generates deterministic boundary reports from the same policy used at runtime; it never mutates
 * gameplay tuning or writes persistent configuration.
 */
import { buildPlayerTraversalPresentationState, getTraversalPresentationLimits } from './playerTraversalPresentationPolicy.js';
import { PLAYER_TRAVERSAL_THRESHOLD_CORPUS } from './fixtures/playerTraversalPresentationThresholdCorpus.js';

export const PLAYER_TRAVERSAL_PRESENTATION_CALIBRATION_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

export function classifyTraversalCalibrationResult(result,expected){
 return freeze({expected,observed:result.state,match:result.state===expected,confidence:round(result.confidence),event:result.event});
}

export function evaluateTraversalThresholdCorpus(corpus=PLAYER_TRAVERSAL_THRESHOLD_CORPUS){
 const rows=[];
 for(const sample of corpus){
  const cue={traversalWeight:sample.w,traversalForwardDistance:sample.d,traversalHeight:sample.h,grounded:sample.g,landingImpactMps:sample.impact,surfaceConfidence:sample.surface,footPlantConfidence:sample.contact,traversalWidth:sample.width,planarSpeedMps:sample.speed,traversalBlocked:sample.blocked,cancelRequested:sample.cancel};
  const result=buildPlayerTraversalPresentationState(null,cue);
  rows.push(classifyTraversalCalibrationResult(result,sample.e));
 }
 const mismatches=rows.filter(row=>!row.match);
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_CALIBRATION_VERSION,count:rows.length,passed:rows.length-mismatches.length,failed:mismatches.length,rows:freeze(rows),valid:mismatches.length===0});
}

export function generateTraversalBoundaryPairs(){
 const limits=getTraversalPresentationLimits();
 return freeze([
  {name:'prepare-distance',lower:limits.prepareDistanceMeters-.01,upper:limits.prepareDistanceMeters+.01},
  {name:'commit-distance',lower:limits.commitDistanceMeters-.01,upper:limits.commitDistanceMeters+.01},
  {name:'climb-height',lower:limits.climbThresholdMeters-.01,upper:limits.climbThresholdMeters+.01},
  {name:'drop-height',lower:limits.dropThresholdMeters-.01,upper:limits.dropThresholdMeters+.01},
  {name:'soft-impact',lower:limits.softLandingImpactMps-.01,upper:limits.softLandingImpactMps+.01},
  {name:'hard-impact',lower:limits.hardLandingImpactMps-.01,upper:limits.hardLandingImpactMps+.01},
 ]);
}

export function runTraversalBoundaryProbe(){
 const pairs=generateTraversalBoundaryPairs();const rows=[];
 for(const pair of pairs){
  const make=(value)=>({traversalWeight:.8,traversalForwardDistance:pair.name.includes('distance')?value:1.5,traversalHeight:pair.name.includes('height')?value:0,landingImpactMps:pair.name.includes('impact')?value:0,elapsedSeconds:.1,grounded:!pair.name.includes('height')});
  const lower=buildPlayerTraversalPresentationState(null,make(pair.lower));const upper=buildPlayerTraversalPresentationState(null,make(pair.upper));
  rows.push(freeze({name:pair.name,lower:lower.state,upper:upper.state,changed:lower.state!==upper.state}));
 }
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_CALIBRATION_VERSION,rows:freeze(rows),changedPairs:rows.filter(r=>r.changed).length});
}

export function summarizeTraversalCalibration(report){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_CALIBRATION_VERSION,count:report.count??0,passed:report.passed??0,failed:report.failed??0,passRate:round((report.passed??0)/Math.max(1,report.count??0)),valid:Boolean(report.valid)});}

export function clampTraversalCalibrationValue(value,min,max){return round(Math.max(min,Math.min(max,finite(value))));}
export function compareTraversalCalibrationReports(a,b){return JSON.stringify(a)===JSON.stringify(b);}
