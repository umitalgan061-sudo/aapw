/** Small, stable selectors for downstream consumers. */
export const PLAYER_TRAVERSAL_PRESENTATION_SELECTORS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}
export const isTraversalActive=p=>Boolean(p&&p.state&&p.state!=='clear'&&p.state!=='cancelled');
export const isTraversalCommitted=p=>['vault','climb','drop'].includes(p?.state);
export const isTraversalAirborne=p=>['climb','drop'].includes(p?.state)&&p?.metrics?.impact<4.5;
export const isTraversalContact=p=>p?.state==='land';
export const isTraversalBlocked=p=>p?.state==='blocked';
export const isTraversalRecovering=p=>p?.state==='recover';
export const traversalTechnique=p=>p?.technique??null;
export const traversalWeight=p=>clamp01(p?.channels?.traversal);
export const traversalAnticipation=p=>clamp01(p?.channels?.anticipation);
export const traversalCommitment=p=>clamp01(p?.channels?.commitment);
export const traversalContact=p=>clamp01(p?.channels?.contact);
export const traversalImpact=p=>clamp01(p?.channels?.impact);
export const traversalConfidence=p=>clamp01(p?.confidence);
export function selectTraversalAnimationFrame(p={}){return freeze({state:p.state??'clear',phase:p.phase??'idle',technique:p.technique??null,weight:traversalWeight(p),anticipation:traversalAnticipation(p),commitment:traversalCommitment(p),contact:traversalContact(p),impact:traversalImpact(p)});}
export function selectTraversalAudioFrame(p={}){return freeze({event:p.event??'none',state:p.state??'clear',intensity:Math.max(traversalCommitment(p),traversalImpact(p)),blocked:isTraversalBlocked(p)});}
export function selectTraversalVfxFrame(p={}){return freeze({event:p.event??'none',state:p.state??'clear',weight:traversalWeight(p),contact:traversalContact(p),impact:traversalImpact(p)});}
export function selectTraversalDebugFrame(p={}){return freeze({state:p.state??'clear',phase:p.phase??'idle',event:p.event??'none',confidence:traversalConfidence(p),distance:finite(p.metrics?.distance),height:finite(p.metrics?.height),surface:p.surfaceId??'unknown'});}
export function selectTraversalPresentationSummary(p={}){return freeze({active:isTraversalActive(p),committed:isTraversalCommitted(p),airborne:isTraversalAirborne(p),contact:isTraversalContact(p),blocked:isTraversalBlocked(p),recovering:isTraversalRecovering(p),technique:traversalTechnique(p),weight:traversalWeight(p),confidence:traversalConfidence(p)});}
