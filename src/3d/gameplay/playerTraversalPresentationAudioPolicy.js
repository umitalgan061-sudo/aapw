/** Audio intent policy for traversal presentation. */
export const PLAYER_TRAVERSAL_AUDIO_POLICY_VERSION='2026-09-15-v1';
const CUES=Object.freeze({none:'none',approach:'traversal-approach',prepare:'traversal-prepare',vault:'vault',climb:'climb',drop:'drop',land:'landing',blocked:'blocked',cancelled:'cancel',recover:'recover',clear:'none'});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}function freeze(v){return Object.freeze(v);}
export function resolveTraversalAudioIntent(presentation={}){
 const state=presentation.state??'clear';const event=presentation.event??'none';const impact=clamp01(presentation.channels?.impact);const commitment=clamp01(presentation.channels?.commitment);const confidence=clamp01(presentation.confidence);const active=!['clear','cancelled'].includes(state);
 const cue=CUES[state]??event;const intensity=clamp01(Math.max(impact,commitment*.8));
 return freeze({version:PLAYER_TRAVERSAL_AUDIO_POLICY_VERSION,state,event,cue,active,intensity,confidence,oneShot:['land','blocked','cancelled'].includes(state),loop:active&&!['land','blocked','cancelled'].includes(state)});
}
export function attenuateTraversalAudioForConfidence(intent={},threshold=.45){const confidence=clamp01(intent.confidence);const attenuation=confidence<threshold?confidence/Math.max(.001,threshold):1;return freeze({...intent,intensity:clamp01(intent.intensity)*attenuation,attenuation});}
export function isTraversalAudioIntentCompatible(intent={}){return typeof intent.cue==='string'&&intent.intensity>=0&&intent.intensity<=1&&intent.confidence>=0&&intent.confidence<=1;}
