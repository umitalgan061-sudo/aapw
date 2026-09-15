/**
 * Surface-aware traversal presentation policy.
 *
 * Surface identity is caller-provided metadata. This layer only changes presentation emphasis; it never
 * changes whether traversal is allowed. Unknown surfaces use the balanced profile.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_SURFACE_VERSION='2026-09-15-v1';
export const PLAYER_TRAVERSAL_SURFACE_PROFILES=Object.freeze({
 stone:Object.freeze({grip:0.92,impact:0.98,anticipation:0.95,audio:'stone'}),
 wood:Object.freeze({grip:0.82,impact:0.88,anticipation:1.02,audio:'wood'}),
 metal:Object.freeze({grip:0.78,impact:1.08,anticipation:1.04,audio:'metal'}),
 ice:Object.freeze({grip:0.32,impact:0.78,anticipation:1.14,audio:'ice'}),
 mud:Object.freeze({grip:0.58,impact:0.72,anticipation:1.08,audio:'mud'}),
 grass:Object.freeze({grip:0.88,impact:0.62,anticipation:0.96,audio:'soft'}),
 sand:Object.freeze({grip:0.7,impact:0.6,anticipation:1,audio:'sand'}),
 unknown:Object.freeze({grip:0.75,impact:0.8,anticipation:1,audio:'generic'}),
});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}

export function getTraversalSurfaceProfile(surfaceId='unknown'){return PLAYER_TRAVERSAL_SURFACE_PROFILES[surfaceId]??PLAYER_TRAVERSAL_SURFACE_PROFILES.unknown;}
export function listTraversalSurfaceProfiles(){return Object.freeze(Object.keys(PLAYER_TRAVERSAL_SURFACE_PROFILES));}
export function applyTraversalSurfacePresentation(presentation={},surfaceId='unknown'){
 const profile=getTraversalSurfaceProfile(surfaceId);const traversal=clamp01(presentation.channels?.traversal);const anticipation=clamp01(presentation.channels?.anticipation);const commitment=clamp01(presentation.channels?.commitment);const impact=clamp01(presentation.channels?.impact);
 return freeze({...presentation,surfaceId,channels:freeze({
  traversal:round(traversal*profile.grip),anticipation:round(Math.min(1,anticipation*profile.anticipation)),commitment:round(commitment*profile.grip),contact:round(clamp01(presentation.channels?.contact)*profile.grip),impact:round(Math.min(1,impact*profile.impact)),confidence:round(clamp01(presentation.channels?.confidence)*(.65+profile.grip*.35)),
 })});
}
export function resolveTraversalSurfaceAudio(presentation={},surfaceId='unknown'){const profile=getTraversalSurfaceProfile(surfaceId);return freeze({surface:surfaceId,audioMaterial:profile.audio,grip:profile.grip,impactMultiplier:profile.impact});}
export function isTraversalSurfaceKnown(surfaceId){return Object.prototype.hasOwnProperty.call(PLAYER_TRAVERSAL_SURFACE_PROFILES,surfaceId);}
export function compareTraversalSurfaceOutputs(a={},b={}){return JSON.stringify(a)===JSON.stringify(b);}
