/** Passive telemetry for composite player motion presentation. */
export const PLAYER_MOTION_PRESENTATION_TELEMETRY_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}
export function createPlayerMotionPresentationTelemetry(){
 const domains={locomotion:0,traversal:0};const states={};let samples=0;let confidence=0;let traversal=0;let locomotion=0;let domainSwitches=0;let previousDomain=null;
 function observe(state){if(!state)return snapshot();samples+=1;const domain=state.domain??'locomotion';if(domains[domain]!=null)domains[domain]+=1;if(previousDomain!=null&&previousDomain!==domain)domainSwitches+=1;previousDomain=domain;const traversalState=state.traversal?.state??'clear';states[traversalState]=(states[traversalState]??0)+1;confidence+=clamp01(state.channels?.confidence);traversal+=clamp01(state.channels?.traversal);locomotion+=clamp01(state.channels?.locomotion);return snapshot();}
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_TELEMETRY_VERSION,samples,domains:freeze({...domains}),states:freeze({...states}),domainSwitches,confidenceAverage:round(samples?confidence/samples:0),traversalAverage:round(samples?traversal/samples:0),locomotionAverage:round(samples?locomotion/samples:0)});}
 function reset(){domains.locomotion=0;domains.traversal=0;for(const k of Object.keys(states))delete states[k];samples=0;confidence=0;traversal=0;locomotion=0;domainSwitches=0;previousDomain=null;return snapshot();}
 return freeze({observe,snapshot,reset});
}
export function mergePlayerMotionPresentationTelemetry(a={},b={}){return freeze({version:PLAYER_MOTION_PRESENTATION_TELEMETRY_VERSION,samples:finite(a.samples)+finite(b.samples),domains:freeze({locomotion:finite(a.domains?.locomotion)+finite(b.domains?.locomotion),traversal:finite(a.domains?.traversal)+finite(b.domains?.traversal)}),domainSwitches:finite(a.domainSwitches)+finite(b.domainSwitches)});}
