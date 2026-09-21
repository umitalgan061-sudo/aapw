/**
 * Derived metrics for traversal presentation analysis.
 * These metrics are observation-only and intentionally independent from physics authority.
 */
export const PLAYER_TRAVERSAL_PRESENTATION_METRICS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp(v,min,max){return Math.max(min,Math.min(max,v));}function clamp01(v){return clamp(finite(v),0,1);}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}

export function deriveTraversalMotionMetrics(previous={},current={}){
 const dt=Math.max(.001,finite(current.elapsedSeconds)-finite(previous.elapsedSeconds));
 const distanceDelta=Math.max(-8,Math.min(8,finite(previous.metrics?.distance)-finite(current.metrics?.distance)));
 const heightDelta=finite(current.metrics?.height)-finite(previous.metrics?.height);
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_METRICS_VERSION,deltaSeconds:round(dt),approachRate:round(distanceDelta/dt),verticalRate:round(heightDelta/dt),weightDelta:round(clamp01(current.metrics?.traversalWeight)-clamp01(previous.metrics?.traversalWeight)),confidenceDelta:round(clamp01(current.confidence)-clamp01(previous.confidence)),stateChanged:previous.state!==current.state,eventChanged:previous.event!==current.event});
}

export function summarizeTraversalMetrics(series=[]){
 let active=0,committed=0,contacts=0,blocked=0,confidence=0,approachRate=0,verticalRate=0;
 for(const row of series){if(row.state&&row.state!=='clear'&&row.state!=='cancelled')active+=1;if(['vault','climb','drop'].includes(row.state))committed+=1;if(row.state==='land')contacts+=1;if(row.state==='blocked')blocked+=1;confidence+=clamp01(row.confidence);approachRate+=finite(row.approachRate);verticalRate+=finite(row.verticalRate);}
 const count=series.length||1;
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_METRICS_VERSION,samples:series.length,active,committed,contacts,blocked,activeRate:round(active/count),committedRate:round(committed/count),contactRate:round(contacts/count),blockedRate:round(blocked/count),averageConfidence:round(confidence/count),averageApproachRate:round(approachRate/count),averageVerticalRate:round(verticalRate/count)});
}

export function calculateTraversalEfficiency(timeline=[]){
 if(timeline.length<2)return 0;
 const active=timeline.filter(x=>!['clear','cancelled'].includes(x.state)).length;
 const successful=timeline.filter(x=>['land','clear'].includes(x.state)&&x.event!=='blocked-enter').length;
 return round(clamp01(successful/Math.max(1,active)));
}

export function detectTraversalOscillation(timeline=[],windowSize=6){
 const size=Math.max(2,Math.floor(finite(windowSize,6)));const rows=[];
 for(let i=size;i<timeline.length;i+=1){const window=timeline.slice(i-size,i).map(x=>x.state);const unique=new Set(window);if(unique.size>=4)rows.push(freeze({index:i,states:freeze(window)}));}
 return freeze(rows);
}

export function buildTraversalPerformanceReport(timeline=[]){
 const metrics=[];for(let i=1;i<timeline.length;i+=1)metrics.push(deriveTraversalMotionMetrics(timeline[i-1],timeline[i]));
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_METRICS_VERSION,summary:summarizeTraversalMetrics(timeline),efficiency:calculateTraversalEfficiency(timeline),oscillations:detectTraversalOscillation(timeline),deltas:freeze(metrics)});
}

export function compareTraversalPerformanceReports(a={},b={}){return JSON.stringify(a)===JSON.stringify(b);}
