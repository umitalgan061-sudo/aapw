/** Runtime guards that protect presentation consumers from contradictory traversal packets. */
export const PLAYER_TRAVERSAL_PRESENTATION_GUARDS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}

export function guardTraversalPresentationChannels(p={}){
 const channels={...(p.channels??{})};
 const blocked=p.state==='blocked';
 const cancelled=p.state==='cancelled';
 if(blocked)channels.commitment=0;
 if(cancelled){for(const key of ['traversal','anticipation','commitment','contact','impact'])channels[key]=0;}
 for(const key of ['traversal','anticipation','commitment','contact','impact','confidence'])channels[key]=clamp01(channels[key]);
 return freeze({...p,channels:freeze(channels)});
}

export function guardTraversalPresentationState(p={},previous=null){
 const guarded=guardTraversalPresentationChannels(p);
 const issues=[];
 if(guarded.state==='blocked'&&guarded.channels.commitment>0)issues.push('blocked-commitment');
 if(guarded.state==='cancelled'&&guarded.channels.traversal>0)issues.push('cancelled-active');
 if(previous&&previous.state==='clear'&&guarded.state==='land')issues.push('unexpected-land');
 if(guarded.confidence<0||guarded.confidence>1)issues.push('confidence-range');
 return freeze({presentation:guarded,safe:issues.length===0,issues:freeze(issues)});
}

export function enforceTraversalConsumerSafety(packet={}){
 const animation=packet.animation?freeze({...packet.animation,weight:clamp01(packet.animation.weight),anticipation:clamp01(packet.animation.anticipation),commitment:clamp01(packet.animation.commitment),contact:clamp01(packet.animation.contact),impact:clamp01(packet.animation.impact)}):null;
 const audio=packet.audio?freeze({...packet.audio,intensity:clamp01(packet.audio.intensity)}):null;
 const vfx=packet.vfx?freeze({...packet.vfx,weight:clamp01(packet.vfx.weight),contact:clamp01(packet.vfx.contact),impact:clamp01(packet.vfx.impact)}):null;
 return freeze({...packet,animation,audio,vfx});
}

export function guardTraversalReplayRecord(record={}){
 const errors=[];
 if(typeof record.state!=='string')errors.push('state');
 if(typeof record.phase!=='string')errors.push('phase');
 if(typeof record.event!=='string')errors.push('event');
 if(finite(record.clockSeconds)<0)errors.push('clock');
 if(record.confidence<0||record.confidence>1)errors.push('confidence');
 return freeze({valid:errors.length===0,errors:freeze(errors)});
}

export function guardTraversalTimelineMonotonicity(timeline=[]){
 const errors=[];let previous=-Infinity;
 timeline.forEach((entry,index)=>{const time=finite(entry?.timestampSeconds);if(time<previous)errors.push(`index:${index}`);previous=time;});
 return freeze({valid:errors.length===0,errors:freeze(errors)});
}
