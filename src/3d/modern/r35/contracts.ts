
export type R35Id = string;
export type R35Phase = 'boot' | 'active' | 'paused' | 'recovering' | 'complete';

export interface R35Vec3 { readonly x:number; readonly y:number; readonly z:number; }
export interface R35Quat { readonly x:number; readonly y:number; readonly z:number; readonly w:number; }
export interface R35Clock { readonly tick:number; readonly step:number; readonly elapsed:number; }
export interface R35Event<T extends string = string, P = unknown> {
  readonly id:R35Id; readonly type:T; readonly tick:number; readonly source:R35Id; readonly payload:P;
}
export type R35Result<T> = { readonly ok:true; readonly value:T; } | { readonly ok:false; readonly error:R35Error; }
export interface R35Error { readonly code:string; readonly message:string; readonly retryable:boolean; }
export interface R35Metric { readonly name:string; readonly value:number; readonly tick:number; readonly tags:Readonly<Record<string,string>>; }
export interface R35Budget { readonly cpu:number; readonly gpu:number; readonly memory:number; readonly entities:number; readonly events:number; }
export interface R35WorldConfig {
  readonly cellSize:number; readonly maxEntities:number; readonly maxEventsPerTick:number;
  readonly simulationRange:number; readonly sleepRange:number; readonly decisionInterval:number;
}
export interface R35NeedState {
  readonly hunger:number; readonly thirst:number; readonly energy:number; readonly safety:number; readonly social:number;
}
export interface R35Memory {
  readonly key:string; readonly strength:number; readonly lastTick:number; readonly tags:readonly string[];
}
export type R35Disposition = 'friendly' | 'neutral' | 'cautious' | 'hostile';
export interface R35AgentState {
  readonly id:R35Id; readonly position:R35Vec3; readonly velocity:R35Vec3;
  readonly disposition:R35Disposition; readonly needs:R35NeedState; readonly memories:readonly R35Memory[];
  readonly utility:number; readonly lod:'near'|'mid'|'far'|'sleep'; readonly revision:number;
}
export interface R35WorldEvent {
  readonly kind:'stimulus'|'interaction'|'damage'|'resource'|'time';
  readonly source:R35Id; readonly target?:R35Id; readonly magnitude:number; readonly tags:readonly string[];
}
export type R35ObjectiveKind = 'event'|'counter'|'collect'|'reach'|'talk'|'flag';
export interface R35Objective {
  readonly id:R35Id; readonly kind:R35ObjectiveKind; readonly target?:R35Id;
  readonly required:number; readonly order:number; readonly hidden?:boolean;
}
export interface R35QuestDefinition { readonly id:R35Id; readonly version:number; readonly objectives:readonly R35Objective[]; readonly reward?:R35Reward; }
export interface R35QuestState { readonly id:R35Id; readonly status:'locked'|'active'|'complete'|'failed'; readonly progress:Readonly<Record<R35Id,number>>; readonly revision:number; }
export interface R35Reward { readonly xp:number; readonly currency:number; readonly items:readonly R35Id[]; readonly flags:readonly R35Id[]; }
export interface R35ItemDefinition {
  readonly id:R35Id; readonly version:number; readonly stackLimit:number; readonly weight:number; readonly value:number;
  readonly tags:readonly string[]; readonly slots:readonly string[];
}
export interface R35ItemStack { readonly itemId:R35Id; readonly quantity:number; readonly durability?:number; }
export interface R35InventoryState { readonly revision:number; readonly capacity:number; readonly weight:number; readonly slots:readonly R35ItemStack[]; readonly equipped:Readonly<Record<string,R35Id|null>>; }
export interface R35DialogueLine { readonly speaker:R35Id; readonly textKey:string; readonly duration:number; readonly emotion?:string; }
export interface R35DialogueChoice { readonly id:R35Id; readonly textKey:string; readonly next:R35Id|null; readonly requires?:R35Predicate; readonly effects?:readonly R35Effect[]; }
export interface R35DialogueNode { readonly id:R35Id; readonly lines:readonly R35DialogueLine[]; readonly choices:readonly R35DialogueChoice[]; }
export interface R35DialogueGraph { readonly id:R35Id; readonly version:number; readonly start:R35Id; readonly nodes:readonly R35DialogueNode[]; }
export type R35Predicate = { readonly kind:'flag'; readonly key:R35Id; readonly equals:boolean } | { readonly kind:'counter'; readonly key:R35Id; readonly min:number } | { readonly kind:'item'; readonly key:R35Id; readonly min:number };
export type R35Effect = { readonly kind:'flag'; readonly key:R35Id; readonly value:boolean } | { readonly kind:'counter'; readonly key:R35Id; readonly delta:number } | { readonly kind:'item'; readonly key:R35Id; readonly delta:number };
export interface R35PlayerProfile { readonly id:R35Id; readonly flags:Readonly<Record<R35Id,boolean>>; readonly counters:Readonly<Record<R35Id,number>>; }
export interface R35SaveEnvelope { readonly schema:number; readonly slot:R35Id; readonly tick:number; readonly payload:unknown; readonly digest:string; readonly createdAt:number; }
export interface R35ReplayInput { readonly tick:number; readonly action:R35Id; readonly value:number; readonly device:'keyboard'|'mouse'|'gamepad'|'touch'|'system'; }
export interface R35ReplayCheckpoint { readonly tick:number; readonly digest:string; readonly payload:unknown; }
export interface R35AccessibilityProfile {
  readonly reducedMotion:boolean; readonly highContrast:boolean; readonly textScale:number; readonly subtitleMode:'off'|'speech'|'all';
  readonly colorMode:'normal'|'deuteranopia'|'protanopia'|'tritanopia'; readonly inputRepeat:number; readonly haptics:boolean;
}
export interface R35ContentManifest { readonly version:number; readonly entries:readonly R35ContentEntry[]; readonly digest:string; }
export interface R35ContentEntry { readonly id:R35Id; readonly kind:'world'|'quest'|'item'|'dialogue'|'audio'|'material'; readonly version:number; readonly digest:string; readonly dependencies:readonly R35Id[]; readonly optional?:boolean; }
export interface R35HealthReport { readonly phase:R35Phase; readonly tick:number; readonly entities:number; readonly activeQuests:number; readonly inventoryWeight:number; readonly metrics:readonly R35Metric[]; readonly warnings:readonly string[]; readonly digest:string; }

export function clamp(value:number,min:number,max:number):number { return value < min ? min : value > max ? max : value; }
export function quantize(value:number, step=0.001):number { return Math.round(value/step)*step; }
export function vec(x:number,y:number,z:number):R35Vec3 { return Object.freeze({x,y,z}); }
export function add(a:R35Vec3,b:R35Vec3):R35Vec3 { return vec(a.x+b.x,a.y+b.y,a.z+b.z); }
export function mul(a:R35Vec3,s:number):R35Vec3 { return vec(a.x*s,a.y*s,a.z*s); }
export function distance(a:R35Vec3,b:R35Vec3):number { const x=a.x-b.x,y=a.y-b.y,z=a.z-b.z; return Math.hypot(x,y,z); }
export function stableHash(value:unknown):string {
  const json=stableStringify(value); let h1=0x811c9dc5; let h2=0x9e3779b9;
  for(let i=0;i<json.length;i++){ const c=json.charCodeAt(i); h1=Math.imul(h1^c,16777619)>>>0; h2=Math.imul(h2^(c+i),2246822519)>>>0; }
  return (h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0');
}
export function stableStringify(value:unknown):string {
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  const object=value as Record<string,unknown>;
  return '{'+Object.keys(object).sort().map(k=>JSON.stringify(k)+':'+stableStringify(object[k])).join(',')+'}';
}
export function ok<T>(value:T):R35Result<T> { return {ok:true,value}; }
export function fail<T>(code:string,message:string,retryable=false):R35Result<T> { return {ok:false,error:{code,message,retryable}}; }
