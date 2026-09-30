/**
 * Blend policy for composite player presentation channels.
 *
 * Traversal and locomotion are two semantic contributors. This module converts their contribution
 * strengths into normalized consumer weights while preserving a stable dominant domain.
 */
export const PLAYER_MOTION_PRESENTATION_BLEND_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp(v,min,max){return Math.max(min,Math.min(max,v));}function clamp01(v){return clamp(finite(v),0,1);}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}

export function resolvePlayerMotionBlendWeights(state={}){
 const traversal=clamp01(state.traversal?.channels?.traversal);const anticipation=clamp01(state.traversal?.channels?.anticipation);const commitment=clamp01(state.traversal?.channels?.commitment);const contact=clamp01(state.traversal?.channels?.contact);const locomotion=clamp01(state.locomotion?.envelope?.directional);const traversalActive=['vault','climb','drop','land','blocked','recover','cancelled'].includes(state.traversal?.state);
 let traversalWeight=traversalActive?Math.max(traversal,commitment,contact):Math.min(traversal,.65);
 let locomotionWeight=locomotion;
 if(traversalActive)locomotionWeight*=.55;
 const total=traversalWeight+locomotionWeight;
 if(total>1){const scale=1/total;traversalWeight*=scale;locomotionWeight*=scale;}
 return freeze({traversal:round(traversalWeight),locomotion:round(locomotionWeight),anticipation:round(anticipation),commitment:round(commitment),contact:round(contact),dominant:traversalWeight>=locomotionWeight?'traversal':'locomotion'});
}

export function blendPlayerMotionChannels(state={}){
 const weights=resolvePlayerMotionBlendWeights(state);const confidence=clamp01(state.channels?.confidence);return freeze({version:PLAYER_MOTION_PRESENTATION_BLEND_VERSION,weights,channels:freeze({locomotion:round(weights.locomotion),traversal:round(weights.traversal),anticipation:round(weights.anticipation),commitment:round(weights.commitment),contact:round(weights.contact),impact:round(clamp01(state.traversal?.channels?.impact)),confidence}),dominant:weights.dominant});
}

export function isPlayerMotionBlendStable(previous={},current={}){const a=blendPlayerMotionChannels(previous),b=blendPlayerMotionChannels(current);return a.dominant===b.dominant||Math.abs(a.weights.traversal-b.weights.traversal)<.35;}

export function clampPresentationBlend(value){return round(clamp01(value));}
