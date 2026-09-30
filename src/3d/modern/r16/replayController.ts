import { digestValue } from './deterministic.js';
import { R16ReplayJournal, type R16ReplayEntry } from './replayJournal.js';

export type R16ReplayMode='idle'|'recording'|'playback'|'paused';
export interface R16ReplayState{readonly mode:R16ReplayMode;readonly tick:number;readonly cursor:number;readonly entries:number;readonly digest:string;}
export interface R16ReplayCursorResult{readonly entry:R16ReplayEntry|null;readonly done:boolean;readonly index:number;readonly tick:number;}

export class R16ReplayController{
  readonly journal:R16ReplayJournal;#mode:R16ReplayMode='idle';#cursor=0;#tick=0;
  constructor(journal:R16ReplayJournal){this.journal=journal;}
  startRecording(tick=0){this.#mode='recording';this.#cursor=0;this.#tick=Math.max(0,Math.trunc(tick));this.journal.setRecording(true);}
  startPlayback(tick=0){this.#mode='playback';this.#cursor=0;this.#tick=Math.max(0,Math.trunc(tick));this.journal.setRecording(false);}
  pause(){if(this.#mode!=='idle')this.#mode='paused';}
  resume(){if(this.#mode==='paused')this.#mode='recording';}
  stop(){this.#mode='idle';this.#cursor=0;}
  next():R16ReplayCursorResult{
    const entries=this.journal.entries();const entry=entries[this.#cursor]??null;
    if(!entry)return Object.freeze({entry:null,done:true,index:this.#cursor,tick:this.#tick});
    this.#cursor+=1;this.#tick=entry.tick;
    return Object.freeze({entry,done:false,index:this.#cursor,tick:this.#tick});
  }
  state():R16ReplayState{
    return Object.freeze({mode:this.#mode,tick:this.#tick,cursor:this.#cursor,entries:this.journal.entries().length,digest:digestValue({mode:this.#mode,tick:this.#tick,cursor:this.#cursor,entries:this.journal.digest()})});
  }
  clear(){this.stop();this.journal.clear();}
}
