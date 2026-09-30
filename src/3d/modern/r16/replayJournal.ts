import { BoundedQueue } from './bounded.js';
import { digestValue, combineDigests, normalizeTick } from './deterministic.js';
import type { R16Command, R16CommandReceipt, R16RuntimeConfig } from './types.js';

export interface R16ReplayEntry {
  readonly index:number;
  readonly tick:number;
  readonly command:R16Command;
  readonly receipt?:R16CommandReceipt;
  readonly digest:string;
}
export interface R16ReplaySegment {
  readonly id:string;
  readonly startTick:number;
  readonly endTick:number;
  readonly entries:readonly R16ReplayEntry[];
  readonly digest:string;
}
export interface R16ReplayCursor { readonly segmentId:string; readonly index:number; readonly tick:number; }

export class R16ReplayJournal{
  readonly #entries:BoundedQueue<R16ReplayEntry>;readonly #segments:R16ReplaySegment[]=[];readonly #maxSegments:number;#index=0;#segmentIndex=0;#recording=true;
  constructor(config:Pick<R16RuntimeConfig,'maxJournalEntries'>,maxSegments=64){this.#entries=new BoundedQueue({capacity:Math.max(1,Math.trunc(config.maxJournalEntries)),dropOldest:true});this.#maxSegments=Math.max(1,Math.trunc(maxSegments));}
  setRecording(recording:boolean){this.#recording=recording;}get recording(){return this.#recording;}
  record(command:R16Command,receipt?:R16CommandReceipt):R16ReplayEntry|null{
    if(!this.#recording)return null;this.#index++;
    const entry:R16ReplayEntry=Object.freeze({index:this.#index,tick:normalizeTick(command.tick),command,receipt,digest:digestValue({index:this.#index,tick:command.tick,command,receipt})});
    this.#entries.push(entry);return entry;
  }
  beginSegment(id:string,startTick:number):R16ReplaySegment{
    const segment:R16ReplaySegment=Object.freeze({id:id.slice(0,96),startTick:normalizeTick(startTick),endTick:normalizeTick(startTick),entries:Object.freeze([]),digest:''});
    this.#segments.push(segment);if(this.#segments.length>this.#maxSegments)this.#segments.shift();this.#segmentIndex=this.#segments.length-1;return segment;
  }
  sealSegment(endTick:number):R16ReplaySegment|null{
    const current=this.#segments[this.#segmentIndex];if(!current)return null;
    const entries=this.#entries.values().filter(e=>e.tick>=current.startTick&&e.tick<=normalizeTick(endTick));
    const segment:R16ReplaySegment=Object.freeze({...current,endTick:normalizeTick(endTick),entries:Object.freeze(entries),digest:combineDigests(entries.map(e=>e.digest))});
    this.#segments[this.#segmentIndex]=segment;return segment;
  }
  entries(fromTick=0,toTick=Number.MAX_SAFE_INTEGER,limit=2048):readonly R16ReplayEntry[]{return Object.freeze(this.#entries.values().filter(e=>e.tick>=normalizeTick(fromTick)&&e.tick<=normalizeTick(toTick)).slice(0,Math.max(1,Math.trunc(limit))));}
  segment(id:string){return this.#segments.find(s=>s.id===id)??null;}
  segments(){return Object.freeze([...this.#segments]);}
  cursor(segmentId:string,index=0):R16ReplayCursor|null{const segment=this.segment(segmentId);if(!segment)return null;const bounded=Math.max(0,Math.min(segment.entries.length,Math.trunc(index)));const entry=segment.entries[bounded-1];return Object.freeze({segmentId,index:bounded,tick:entry?.tick??segment.startTick});}
  digest(){return digestValue({entries:this.#entries.values().map(e=>e.digest),segments:this.#segments.map(s=>s.digest)});}
  clear(){this.#entries.clear();this.#segments.length=0;this.#index=0;this.#segmentIndex=0;}
}
