export interface IntelligencePolicy {readonly id:string;readonly domain:string;readonly limit:number;readonly fallback:number;readonly priority:number;readonly description:string;}
export const INTELLIGENCE_POLICIES:readonly IntelligencePolicy[]=Object.freeze([
 {id:'actors',domain:'runtime',limit:128,fallback:64,priority:10,description:'Maximum actor snapshots processed per simulation tick.'},
 {id:'stimuli',domain:'perception',limit:32,fallback:16,priority:10,description:'Maximum relevant stimuli processed for one actor.'},
 {id:'memories',domain:'memory',limit:256,fallback:64,priority:10,description:'Maximum retained memories per actor.'},
 {id:'goals',domain:'decision',limit:16,fallback:8,priority:9,description:'Maximum active goal definitions per actor.'},
 {id:'events',domain:'events',limit:1024,fallback:128,priority:10,description:'Maximum retained world events.'},
 {id:'interests',domain:'interest',limit:24,fallback:8,priority:9,description:'Maximum ranked world-interest candidates.'},
 {id:'perceptionRadius',domain:'perception',limit:256,fallback:96,priority:9,description:'Maximum perception radius before a sensor adapter takes over.'},
 {id:'decisionInterval',domain:'decision',limit:60,fallback:6,priority:9,description:'Decision cadence in simulation ticks.'},
 {id:'memoryHalfLife',domain:'memory',limit:4096,fallback:32,priority:8,description:'Memory confidence half-life in ticks.'},
 {id:'eventRetention',domain:'events',limit:100000,fallback:720,priority:8,description:'Event retention horizon in ticks.'},
 {id:'interestRadius',domain:'interest',limit:512,fallback:96,priority:8,description:'Interest scan radius.'},
 {id:'dangerEmergency',domain:'decision',limit:1,fallback:.78,priority:10,description:'Danger threshold for emergency flee priority.'},
 {id:'intentFloor',domain:'decision',limit:1,fallback:.08,priority:8,description:'Minimum intent utility before selection.'},
 {id:'confidenceFloor',domain:'perception',limit:1,fallback:.05,priority:8,description:'Minimum sensor confidence before memory creation.'},
 {id:'payloadKeys',domain:'events',limit:64,fallback:24,priority:7,description:'Maximum event payload keys retained.'},
]);
export function policy(id:string):IntelligencePolicy|undefined{return INTELLIGENCE_POLICIES.find(p=>p.id===id);}
export function policyValue(id:string,value:number):number{const p=policy(id);if(!p)return 0;if(!Number.isFinite(value))return p.fallback;return Math.max(0,Math.min(p.limit,value));}
export function policyReport():readonly string[]{return Object.freeze([...INTELLIGENCE_POLICIES].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).map(p=>`${p.domain}/${p.id} <= ${p.limit}; fallback=${p.fallback}; ${p.description}`));}
