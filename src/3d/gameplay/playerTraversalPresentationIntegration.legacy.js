/**
 * Unified traversal presentation pipeline facade.
 *
 * This facade is intentionally thin: it composes existing pure layers rather than creating another state
 * machine. A caller can use it as the single integration boundary between gameplay traversal cues and
 * presentation consumers, while still being able to test every layer independently.
 */
import { buildPlayerTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { buildPlayerTraversalConsumerPacket } from './playerTraversalPresentationBridge.js';
import { validateTraversalPresentationQuality } from './playerTraversalPresentationQuality.js';
import { buildTraversalTimelineEntry, appendTraversalTimeline, compactTraversalTimeline } from './playerTraversalPresentationTimeline.js';
import { createTraversalPresentationTelemetry } from './playerTraversalPresentationTelemetry.js';
import { diagnoseTraversalPresentationState } from './playerTraversalPresentationDiagnostics.js';
import { filterTraversalPresentationTransition } from './playerTraversalPresentationTransitionPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_INTEGRATION_VERSION='2026-09-15-v1';
function freeze(v){return Object.freeze(v);}

export function createPlayerTraversalPresentationPipeline(options={}){
 let previous=null; let timeline=[]; let tickIndex=0;
 const telemetry=createTraversalPresentationTelemetry();
 const keepTimeline=Math.max(1,Math.floor(Number(options.maxTimelineEntries)||120));
 function tick(cue={}){
  tickIndex+=1;
  const raw=buildPlayerTraversalPresentationState(previous,cue);
  const safe=filterTraversalPresentationTransition(previous,raw);
  const contract=createPlayerTraversalPresentationContract(safe);
  const packet=buildPlayerTraversalConsumerPacket(contract,{audio:options.audio!==false,vfx:options.vfx!==false,debug:options.debug!==false});
  const quality=validateTraversalPresentationQuality(safe,previous);
  const diagnostics=diagnoseTraversalPresentationState(safe,previous);
  const entry=buildTraversalTimelineEntry(previous,cue);
  timeline=compactTraversalTimeline(appendTraversalTimeline(timeline,entry),{maxEntries:keepTimeline});
  telemetry.observe(safe);
  previous=safe;
  return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_INTEGRATION_VERSION,tickIndex,state:safe,contract,packet,quality,diagnostics,timelineEntry:entry});
 }
 function reset(){previous=null;timeline=[];tickIndex=0;telemetry.reset();return freeze({reset:true,version:PLAYER_TRAVERSAL_PRESENTATION_INTEGRATION_VERSION});}
 function snapshot(){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_INTEGRATION_VERSION,tickIndex,previous,timeline,telemetry:telemetry.snapshot()});}
 function timelineSnapshot(){return freeze(timeline.slice());}
 return freeze({tick,reset,snapshot,timelineSnapshot});
}

export function processTraversalPresentationSequence(cues=[],options={}){
 const pipeline=createPlayerTraversalPresentationPipeline(options); const outputs=[]; for(const cue of cues)outputs.push(pipeline.tick(cue)); return freeze({outputs:freeze(outputs),snapshot:pipeline.snapshot()});
}
