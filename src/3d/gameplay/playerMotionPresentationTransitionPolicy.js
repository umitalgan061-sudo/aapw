/**
 * Composite transition policy for locomotion/traversal presentation domains.
 * It validates presentation transitions only; gameplay action validity remains elsewhere.
 */
export const PLAYER_MOTION_PRESENTATION_TRANSITION_VERSION='2026-09-15-v1';
const DOMAIN_TRANSITIONS=Object.freeze({
 locomotion:Object.freeze(['locomotion','traversal']),
 traversal:Object.freeze(['traversal','locomotion']),
});
const TRAVERSAL_TERMINALS=new Set(['blocked','cancelled']);
function freeze(v){return Object.freeze(v);}
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
export function isPlayerMotionPresentationDomainTransitionAllowed(from='locomotion',to='locomotion'){return from===to||Boolean(DOMAIN_TRANSITIONS[from]?.includes(to));}
export function resolvePlayerMotionPresentationTransition(previous={},current={}){
 const from=previous.domain??'locomotion';const to=current.domain??'locomotion';const allowed=isPlayerMotionPresentationDomainTransitionAllowed(from,to);const terminal=TRAVERSAL_TERMINALS.has(current.traversal?.state);
 return freeze({version:PLAYER_MOTION_PRESENTATION_TRANSITION_VERSION,from,to,allowed,terminal,reason:allowed?(terminal?'terminal-traversal':'domain-transition'):'invalid-domain-transition',confidence:clamp01(current.channels?.confidence)});
}
export function enforcePlayerMotionPresentationTransition(previous={},current={}){
 const result=resolvePlayerMotionPresentationTransition(previous,current);
 return result.allowed?current:freeze({...current,domain:previous.domain??'locomotion',reason:'transition-guard'});
}
export function countPlayerMotionDomainTransitions(states=[]){let count=0;for(let i=1;i<states.length;i+=1)if(states[i]?.domain!==states[i-1]?.domain)count+=1;return count;}
export function summarizePlayerMotionTransitions(states=[]){return freeze({version:PLAYER_MOTION_PRESENTATION_TRANSITION_VERSION,count:states.length,switches:countPlayerMotionDomainTransitions(states),locomotionStates:states.filter(s=>s.domain==='locomotion').length,traversalStates:states.filter(s=>s.domain==='traversal').length});}
