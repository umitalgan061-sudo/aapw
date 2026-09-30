/**
 * Consumer scheduling semantics for traversal presentation events.
 *
 * This policy answers "how should a consumer schedule this event?" without deciding whether traversal
 * is legal. It keeps one-shot/loop/priority/latency semantics consistent across animation, audio and VFX.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_EVENT_POLICY_VERSION='2026-09-15-v1';
const EVENT_POLICY=Object.freeze({
 'none':Object.freeze({kind:'none',priority:0,oneShot:false,loop:false,latency:0}),
 'approach-enter':Object.freeze({kind:'anticipation',priority:20,oneShot:true,loop:true,latency:.08}),
 'prepare-enter':Object.freeze({kind:'prepare',priority:35,oneShot:true,loop:true,latency:.05}),
 'commit-vault':Object.freeze({kind:'commit',priority:70,oneShot:true,loop:false,latency:.02}),
 'commit-climb':Object.freeze({kind:'commit',priority:70,oneShot:true,loop:false,latency:.02}),
 'commit-drop':Object.freeze({kind:'commit',priority:70,oneShot:true,loop:false,latency:.02}),
 'execute-vault':Object.freeze({kind:'execution',priority:85,oneShot:false,loop:true,latency:0}),
 'execute-climb':Object.freeze({kind:'execution',priority:85,oneShot:false,loop:true,latency:0}),
 'execute-drop':Object.freeze({kind:'execution',priority:85,oneShot:false,loop:true,latency:0}),
 'land-soft':Object.freeze({kind:'contact',priority:82,oneShot:true,loop:false,latency:0}),
 'land-hard':Object.freeze({kind:'impact',priority:96,oneShot:true,loop:false,latency:0}),
 'blocked-enter':Object.freeze({kind:'blocked',priority:92,oneShot:true,loop:false,latency:.01}),
 'recover-enter':Object.freeze({kind:'recovery',priority:65,oneShot:true,loop:true,latency:.04}),
 'recover-exit':Object.freeze({kind:'recovery-exit',priority:45,oneShot:true,loop:false,latency:.04}),
 'cancel':Object.freeze({kind:'cancel',priority:98,oneShot:true,loop:false,latency:0}),
 'timeout':Object.freeze({kind:'timeout',priority:90,oneShot:true,loop:false,latency:0}),
 'clear-enter':Object.freeze({kind:'clear',priority:15,oneShot:true,loop:false,latency:.08}),
 'confidence-drop':Object.freeze({kind:'confidence',priority:30,oneShot:true,loop:false,latency:.1}),
 'confidence-recover':Object.freeze({kind:'confidence-recover',priority:25,oneShot:true,loop:false,latency:.1}),
 'surface-change':Object.freeze({kind:'surface-change',priority:28,oneShot:true,loop:false,latency:.06}),
 'direction-change':Object.freeze({kind:'redirect',priority:42,oneShot:true,loop:false,latency:.03}),
});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

export function resolveTraversalPresentationEventPolicy(event='none'){
 return EVENT_POLICY[event]??EVENT_POLICY.none;
}
export function listTraversalPresentationEventPolicies(){return Object.freeze(Object.keys(EVENT_POLICY));}
export function buildTraversalPresentationEventIntent(presentation={}){
 const event=presentation.event??'none';const base=resolveTraversalPresentationEventPolicy(event);const confidence=clamp01(presentation.confidence);const impact=clamp01(presentation.channels?.impact);const commitment=clamp01(presentation.channels?.commitment);
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_EVENT_POLICY_VERSION,event,kind:base.kind,priority:base.priority,oneShot:base.oneShot,loop:base.loop,latencySeconds:round(base.latency),confidence,intensity:round(Math.max(impact,commitment)),suppressed:confidence<.25&&base.priority<80});
}
export function compareTraversalPresentationEventPriority(a='none',b='none'){return resolveTraversalPresentationEventPolicy(a).priority-resolveTraversalPresentationEventPolicy(b).priority;}
export function chooseHigherPriorityTraversalEvent(events=[]){return events.slice().sort((a,b)=>compareTraversalPresentationEventPriority(b,a.event??'none'))[0]??null;}
export function isTraversalPresentationEventPolicySafe(event='none'){const p=resolveTraversalPresentationEventPolicy(event);return p.priority>=0&&p.priority<=100&&p.latency>=0&&p.latency<=1;}
export function scaleTraversalPresentationEventIntent(intent={},factor=1){const f=clamp01(factor);return freeze({...intent,intensity:round(clamp01(intent.intensity)*f),confidence:round(clamp01(intent.confidence)*f)});}
