/** Deterministic transition policy for traversal presentation states. */
import { PLAYER_TRAVERSAL_PRESENTATION_STATES } from './playerTraversalPresentationPolicy.js';
export const PLAYER_TRAVERSAL_PRESENTATION_TRANSITION_VERSION='2026-09-15-v1';
const ALLOWED=Object.freeze({
 clear:['approach','prepare','cancelled','blocked'],
 approach:['clear','prepare','blocked','cancelled'],
 prepare:['clear','approach','vault','climb','drop','blocked','cancelled'],
 vault:['land','recover','blocked','cancelled'],
 climb:['land','recover','blocked','cancelled'],
 drop:['land','recover','blocked','cancelled'],
 land:['recover','clear','blocked'],
 blocked:['clear','approach','prepare','cancelled'],
 recover:['clear','approach','prepare','cancelled','blocked'],
 cancelled:['clear'],
});
function freeze(v){return Object.freeze(v);}
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
export function isTraversalPresentationTransitionAllowed(from='clear',to='clear'){return from===to||Boolean(ALLOWED[from]?.includes(to));}
export function resolveTraversalPresentationTransition(from='clear',to='clear',confidence=1){
 const valid=isTraversalPresentationTransitionAllowed(from,to);
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_TRANSITION_VERSION,from,to,valid,confidence:clamp01(confidence),reason:valid?'allowed':'illegal-transition'});
}
export function filterTraversalPresentationTransition(previous,current){
 const from=previous?.state??'clear'; const to=current?.state??'clear';
 if(isTraversalPresentationTransitionAllowed(from,to)) return current;
 return freeze({...current,state:from,event:'none',confidence:Math.min(clamp01(current?.confidence),clamp01(previous?.confidence))});
}
export function enumerateTraversalPresentationTransitions(){
 const rows=[];
 for(const from of PLAYER_TRAVERSAL_PRESENTATION_STATES) for(const to of PLAYER_TRAVERSAL_PRESENTATION_STATES) rows.push(freeze({from,to,allowed:isTraversalPresentationTransitionAllowed(from,to)}));
 return freeze(rows);
}
export function transitionRate(timeline=[]){
 if(timeline.length<2)return 0;
 let changes=0; for(let i=1;i<timeline.length;i+=1)if(timeline[i].state!==timeline[i-1].state)changes+=1;
 return changes/(timeline.length-1);
}
