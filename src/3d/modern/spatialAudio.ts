import type { Disposable, EntityId, TimestampMs } from './types';

export interface AudioClip { readonly id:string;readonly uri:string;readonly durationSeconds?:number;readonly streaming?:boolean; }
export interface AudioSource { readonly id:string;readonly clipId:string;readonly position:{x:number;y:number;z:number};readonly volume:number;readonly radius:number;readonly loop:boolean;readonly attachedTo?:EntityId; }
export interface ListenerState { readonly position:{x:number;y:number;z:number};readonly forward:{x:number;y:number;z:number};readonly up:{x:number;y:number;z:number}; }
export interface AudioMix { readonly master:number;readonly music:number;readonly ambience:number;readonly effects:number;readonly voice:number; }
export interface AudioStats { readonly clips:number;readonly activeSources:number;readonly playing:number;readonly bytesHint:number; }

/** Web-Audio-independent spatial audio domain model. Browser adapters can bind it to AudioContext or Web Audio worklets. */
export class SpatialAudioRuntime implements Disposable {
 private readonly clips=new Map<string,AudioClip>();private readonly sources=new Map<string,AudioSource>();private listener:ListenerState={position:{x:0,y:0,z:0},forward:{x:0,y:0,z:-1},up:{x:0,y:1,z:0}};private mix:AudioMix={master:1,music:1,ambience:1,effects:1,voice:1};private readonly playing=new Set<string>();private disposed=false;
 public registerClip(clip:AudioClip):void{this.ensure();if(this.clips.has(clip.id))throw new Error(`AUDIO_CLIP_REDEFINED:${clip.id}`);this.clips.set(clip.id,{...clip});}
 public removeClip(id:string):boolean{this.ensure();for(const source of this.sources.values())if(source.clipId===id)this.stop(source.id);return this.clips.delete(id);}
 public addSource(source:AudioSource):void{this.ensure();if(!this.clips.has(source.clipId))throw new Error(`AUDIO_CLIP_MISSING:${source.clipId}`);if(this.sources.has(source.id))throw new Error(`AUDIO_SOURCE_REDEFINED:${source.id}`);this.sources.set(source.id,{...source,volume:clamp(source.volume),radius:Math.max(.01,source.radius)});}
 public updateSource(id:string,patch:Partial<AudioSource>):boolean{this.ensure();const source=this.sources.get(id);if(!source)return false;if(patch.clipId&& !this.clips.has(patch.clipId))throw new Error(`AUDIO_CLIP_MISSING:${patch.clipId}`);this.sources.set(id,{...source,...patch,volume:clamp(patch.volume??source.volume),radius:Math.max(.01,patch.radius??source.radius)});return true;}
 public removeSource(id:string):boolean{this.stop(id);return this.sources.delete(id);}
 public play(id:string):boolean{this.ensure();if(!this.sources.has(id))return false;this.playing.add(id);return true;}
 public stop(id:string):boolean{const was=this.playing.delete(id);return was;}
 public isPlaying(id:string):boolean{return this.playing.has(id);}
 public setListener(listener:ListenerState):void{this.ensure();this.listener={position:{...listener.position},forward:{...listener.forward},up:{...listener.up}};}
 public listenerState():ListenerState{return{position:{...this.listener.position},forward:{...this.listener.forward},up:{...this.listener.up}};}
 public setMix(patch:Partial<AudioMix>):void{this.ensure();this.mix={master:clamp(patch.master??this.mix.master),music:clamp(patch.music??this.mix.music),ambience:clamp(patch.ambience??this.mix.ambience),effects:clamp(patch.effects??this.mix.effects),voice:clamp(patch.voice??this.mix.voice)};}
 public mixState():AudioMix{return{...this.mix};}
 public gainFor(id:string):number{const source=this.sources.get(id);if(!source||!this.playing.has(id))return 0;const dx=source.position.x-this.listener.position.x,dy=source.position.y-this.listener.position.y,dz=source.position.z-this.listener.position.z;const distance=Math.hypot(dx,dy,dz);const attenuation=Math.max(0,1-distance/source.radius);return source.volume*this.mix.master*attenuation;}
 public snapshot(timestamp:TimestampMs):{readonly timestamp:TimestampMs;readonly mix:AudioMix;readonly active:readonly {id:string;gain:number}[]} {const active=[...this.playing].sort().map(id=>({id,gain:Number(this.gainFor(id).toFixed(4))}));return{timestamp,mix:this.mixState(),active};}
 public stats():AudioStats{let bytesHint=0;for(const clip of this.clips.values())bytesHint+=Math.max(0,Math.floor((clip.durationSeconds??0)*48000*4));return{clips:this.clips.size,activeSources:this.sources.size,playing:this.playing.size,bytesHint};}
 public clear():void{this.playing.clear();this.sources.clear();this.clips.clear();}
 private ensure():void{if(this.disposed)throw new Error('SPATIAL_AUDIO_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.clear();this.disposed=true;}
}
const clamp=(value:number):number=>Math.min(1,Math.max(0,Number.isFinite(value)?value:0));
