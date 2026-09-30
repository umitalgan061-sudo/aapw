/**
 * Named traversal presentation tuning profiles.
 *
 * These are presentation-only profiles. They shape anticipation/commitment/contact weights for callers
 * that already know which traversal technique is valid. They never change collision or traversal physics.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_TUNING_VERSION='2026-09-15-v1';
export const PLAYER_TRAVERSAL_PRESENTATION_TUNINGS=Object.freeze({
 balanced:Object.freeze({anticipation:1,commitment:1,contact:1,impact:1,confidenceFloor:.5}),
 agile:Object.freeze({anticipation:1.15,commitment:1.08,contact:.92,impact:.88,confidenceFloor:.46}),
 heavy:Object.freeze({anticipation:.85,commitment:.92,contact:1.12,impact:1.18,confidenceFloor:.54}),
 cautious:Object.freeze({anticipation:1.18,commitment:.8,contact:1,impact:1.08,confidenceFloor:.62}),
 responsive:Object.freeze({anticipation:1.08,commitment:1.12,contact:1.04,impact:.96,confidenceFloor:.5}),
});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function clamp01(v){return clamp(finite(v),0,1);}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}
export function getTraversalPresentationTuning(name='balanced'){return PLAYER_TRAVERSAL_PRESENTATION_TUNINGS[name]??PLAYER_TRAVERSAL_PRESENTATION_TUNINGS.balanced;}
export function listTraversalPresentationTunings(){return Object.freeze(Object.keys(PLAYER_TRAVERSAL_PRESENTATION_TUNINGS));}
export function applyTraversalPresentationTuning(presentation={},name='balanced'){
 const tuning=getTraversalPresentationTuning(name);
 return freeze({...presentation,channels:freeze({
  traversal:round(clamp01((presentation.channels?.traversal??0)*tuning.commitment)),
  anticipation:round(clamp01((presentation.channels?.anticipation??0)*tuning.anticipation)),
  commitment:round(clamp01((presentation.channels?.commitment??0)*tuning.commitment)),
  contact:round(clamp01((presentation.channels?.contact??0)*tuning.contact)),
  impact:round(clamp01((presentation.channels?.impact??0)*tuning.impact)),
  confidence:round(Math.max(tuning.confidenceFloor,clamp01(presentation.channels?.confidence??presentation.confidence))),
 })});
}
export function compareTraversalTuningOutputs(a,b){return JSON.stringify(a)===JSON.stringify(b);}
