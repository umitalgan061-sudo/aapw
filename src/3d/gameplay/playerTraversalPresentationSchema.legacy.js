/** Schema helpers for traversal presentation records. */
export const PLAYER_TRAVERSAL_PRESENTATION_SCHEMA_VERSION='2026-09-15-v1';
export const PLAYER_TRAVERSAL_PRESENTATION_REQUIRED_KEYS=Object.freeze(['version','state','phase','event','confidence','terminal','metrics','channels']);
const STATES=new Set(['clear','approach','prepare','vault','climb','drop','land','blocked','recover','cancelled']);
const PHASES=new Set(['idle','anticipation','commit','execution','contact','recovery','terminal']);
const EVENTS=new Set(['none','approach-enter','prepare-enter','commit-vault','commit-climb','commit-drop','execute-vault','execute-climb','execute-drop','land-soft','land-hard','blocked-enter','recover-enter','recover-exit','cancel','timeout','clear-enter','confidence-drop','confidence-recover','surface-change','direction-change']);
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}

export function validateTraversalPresentationShape(value={}){
 const errors=[];
 for(const key of PLAYER_TRAVERSAL_PRESENTATION_REQUIRED_KEYS)if(!(key in value))errors.push(`missing:${key}`);
 if(!STATES.has(value.state))errors.push('state');
 if(!PHASES.has(value.phase))errors.push('phase');
 if(!EVENTS.has(value.event))errors.push('event');
 if(value.confidence!==undefined&&(value.confidence<0||value.confidence>1))errors.push('confidence');
 if(!value.metrics||typeof value.metrics!=='object')errors.push('metrics');
 if(!value.channels||typeof value.channels!=='object')errors.push('channels');
 return freeze({valid:errors.length===0,errors:freeze(errors)});
}

export function normalizeTraversalPresentationShape(value={}){
 const metrics=value.metrics??{};const channels=value.channels??{};
 return freeze({
  version:String(value.version??PLAYER_TRAVERSAL_PRESENTATION_SCHEMA_VERSION),
  state:STATES.has(value.state)?value.state:'clear',phase:PHASES.has(value.phase)?value.phase:'idle',event:EVENTS.has(value.event)?value.event:'none',
  confidence:clamp01(value.confidence),terminal:Boolean(value.terminal),elapsedSeconds:Math.max(0,finite(value.elapsedSeconds)),
  metrics:freeze({distance:Math.max(0,finite(metrics.distance)),height:finite(metrics.height),width:Math.max(0,finite(metrics.width)),approachSpeed:Math.max(0,finite(metrics.approachSpeed)),verticalSpeed:finite(metrics.verticalSpeed),traversalWeight:clamp01(metrics.traversalWeight),surfaceConfidence:clamp01(metrics.surfaceConfidence),footContactConfidence:clamp01(metrics.footContactConfidence),impact:Math.max(0,finite(metrics.impact))}),
  channels:freeze(Object.fromEntries(['traversal','anticipation','commitment','contact','impact','confidence'].map(k=>[k,clamp01(channels[k])]))),
 });
}

export function schemaFingerprint(value={}){return JSON.stringify(normalizeTraversalPresentationShape(value));}
export function equivalentTraversalPresentationShape(a,b){return schemaFingerprint(a)===schemaFingerprint(b);}
export function traversalPresentationSchemaConstants(){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_SCHEMA_VERSION,states:freeze([...STATES]),phases:freeze([...PHASES]),events:freeze([...EVENTS])});}
