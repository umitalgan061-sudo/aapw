/** VFX intent policy for traversal presentation. */
export const PLAYER_TRAVERSAL_VFX_POLICY_VERSION='2026-09-15-v1';
const EFFECTS=Object.freeze({clear:null,approach:'traversal-anticipation',prepare:'traversal-ready',vault:'vault-dust',climb:'climb-contact',drop:'drop-contact',land:'landing-impact',blocked:'traversal-blocked',recover:'traversal-recover',cancelled:null});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}function freeze(v){return Object.freeze(v);}
export function resolveTraversalVfxIntent(presentation={}){
 const state=presentation.state??'clear';const event=presentation.event??'none';const effect=EFFECTS[state]??null;const traversal=clamp01(presentation.channels?.traversal);const contact=clamp01(presentation.channels?.contact);const impact=clamp01(presentation.channels?.impact);const confidence=clamp01(presentation.confidence);
 const scale=clamp01(Math.max(traversal*.8,impact));
 return freeze({version:PLAYER_TRAVERSAL_VFX_POLICY_VERSION,state,event,effect,enabled:Boolean(effect)&&confidence>.25,weight:scale,contact,impact,confidence,burst:['vault','climb','drop','land','blocked'].includes(state),loop:['approach','prepare','recover'].includes(state)});
}
export function attenuateTraversalVfxForSurface(intent={},surfaceConfidence=1){const factor=.55+.45*clamp01(surfaceConfidence);return freeze({...intent,weight:clamp01(intent.weight)*factor,confidence:clamp01(intent.confidence)*factor});}
export function isTraversalVfxIntentCompatible(intent={}){return intent.weight>=0&&intent.weight<=1&&intent.confidence>=0&&intent.confidence<=1;}
