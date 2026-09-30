/**
 * Recovery policy for traversal presentation after interrupted execution or landing.
 * Recovery is a presentation state; movement cancellation and physics remain caller-owned.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_RECOVERY_VERSION='2026-09-15-v1';
const PROFILES=Object.freeze({
 vault:Object.freeze({duration:.42,settle:.18,reentry:.16}),
 climb:Object.freeze({duration:.55,settle:.22,reentry:.2}),
 drop:Object.freeze({duration:.48,settle:.2,reentry:.18}),
 land:Object.freeze({duration:.5,settle:.16,reentry:.24}),
 blocked:Object.freeze({duration:.3,settle:.12,reentry:.3}),
 cancelled:Object.freeze({duration:.22,settle:.1,reentry:.2}),
 recover:Object.freeze({duration:.32,settle:.14,reentry:.22}),
});
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp(v,min,max){return Math.max(min,Math.min(max,v));}function clamp01(v){return clamp(finite(v),0,1);}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}
export function getTraversalRecoveryProfile(state='recover'){return PROFILES[state]??PROFILES.recover;}
export function resolveTraversalRecoveryProgress(state='recover',elapsedSeconds=0){const profile=getTraversalRecoveryProfile(state);return clamp01(Math.max(0,finite(elapsedSeconds))/profile.duration);}
export function resolveTraversalRecoveryChannels(state='recover',elapsedSeconds=0){const profile=getTraversalRecoveryProfile(state);const progress=resolveTraversalRecoveryProgress(state,elapsedSeconds);const settleProgress=clamp01((progress-(profile.duration-profile.settle))/profile.settle);return freeze({progress:round(progress),recovery:round(1-progress),settle:round(settleProgress),reentry:round(clamp01(profile.reentry))});}
export function buildTraversalRecoveryPresentation(previous={},current={},elapsedSeconds=0){const from=previous.state??'recover';const to=current.state??'recover';const channels=resolveTraversalRecoveryChannels(from,elapsedSeconds);return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_RECOVERY_VERSION,from,to,interrupted:from!==to||from==='blocked'||from==='cancelled',channels,readyForReentry:channels.settle>=.9||to==='clear'});}
export function isTraversalRecoveryComplete(recovery={}){return Boolean(recovery.readyForReentry);}
export function compareTraversalRecovery(a,b){return JSON.stringify(a)===JSON.stringify(b);}
