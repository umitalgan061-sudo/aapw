/** Typed production audio facade for the 3D mode. */
import * as THREE from 'three';
import {ASSET_PATHS,STORAGE_KEYS} from '../config.ts';
import {createImmersiveAudioDirector} from './immersiveAudioDirector.js';
import {createAudioSnapshot,serializeAudioSnapshot} from './audioSnapshot.js';
const CLICK_SOUND_URL=`${ASSET_PATHS.AUDIO}ui-click.wav`,CLICK_VOLUME=.35,DISCOVERY_CHIME_VOLUME=.22,DISCOVERY_CHIME_PLAYBACK_RATE=1.6;
export type AudioQuality='balanced'|'low'|'medium'|'high'|'ultra'|string; export type AudioEnvironment='plains'|string;
export interface AudioManagerOptions{readonly camera:THREE.Camera;readonly initialMuted?:boolean;readonly quality?:AudioQuality;readonly reducedMotion?:boolean;readonly coarsePointer?:boolean;readonly environment?:AudioEnvironment;}
export interface AudioManager{readonly playClick:()=>Promise<void>;readonly playDiscoveryChime:()=>Promise<void>;readonly setMuted:(next:boolean)=>void;readonly isMuted:()=>boolean;readonly update:(deltaSeconds:number,world?:Readonly<Record<string,unknown>>)=>unknown;readonly setEnvironment:(environment:AudioEnvironment,state?:Readonly<Record<string,unknown>>)=>unknown;readonly registerSpatialSource:(source:unknown)=>unknown;readonly updateSpatialSource:(id:string,patch:unknown)=>unknown;readonly removeSpatialSource:(id:string)=>boolean;readonly setAudioDuck:(group:string,active:boolean,options?:unknown)=>unknown;readonly clearAudioDuck:(id:string)=>boolean;readonly applyAudioOcclusion:(result:unknown)=>unknown;readonly playWorldCue:(kind:string,options?:unknown)=>unknown;readonly getImmersiveSnapshot:()=>unknown;readonly getAudioSnapshot:()=>unknown;readonly getAudioSnapshotJson:()=>string;readonly dispose:()=>void;}
export function readStoredMuted():boolean{try{return globalThis.localStorage?.getItem(STORAGE_KEYS.SOUND_MUTED)==='1';}catch{return false;}}
export function createAudioManager({camera,initialMuted=false,quality='balanced',reducedMotion=false,coarsePointer=false,environment='plains'}:AudioManagerOptions):AudioManager{
 let listener:THREE.AudioListener|null=null,audioLoader:THREE.AudioLoader|null=null,muted=Boolean(initialMuted),clickBufferPromise:Promise<AudioBuffer|null>|null=null,audioDirector:unknown=null;
 try{listener=new THREE.AudioListener();camera.add(listener);listener.setMasterVolume(muted?0:1);try{audioDirector=createImmersiveAudioDirector({listener,quality,reducedMotion,coarsePointer,environment});}catch(error){console.warn('[audioManager] immersive audio director unavailable, legacy cues remain active',error);audioDirector=null;}}catch(error){console.warn('[audioManager] AudioListener unavailable, sound disabled',error);listener=null;}
 const director=()=>audioDirector as {triggerCue?:Function;setMasterVolume?:Function;update?:Function;setEnvironment?:Function;registerSource?:Function;updateSource?:Function;removeSource?:Function;setDuck?:Function;clearDuck?:Function;applyOcclusion?:Function;snapshot?:Function;dispose?:Function}|null;
 function loadClickBuffer():Promise<AudioBuffer|null>{if(!clickBufferPromise){audioLoader=audioLoader??new THREE.AudioLoader();clickBufferPromise=new Promise<AudioBuffer|null>((resolve,reject)=>audioLoader?.load(CLICK_SOUND_URL,resolve,undefined,reject)).catch(error=>{console.warn('[audioManager] click sound failed to load',error);return null;});}return clickBufferPromise;}
 async function playBuffer(volume:number,playbackRate:number):Promise<void>{if(!listener)return;const context=listener.context,resumePromise=context?.state==='suspended'?context.resume().catch(()=>undefined):null,buffer=await loadClickBuffer();if(resumePromise)await resumePromise;if(!buffer)return;try{const sound=new THREE.Audio(listener);sound.setBuffer(buffer);sound.setVolume(volume);sound.setPlaybackRate(playbackRate);const baseOnEnded=sound.onEnded.bind(sound);sound.onEnded=()=>{baseOnEnded();sound.disconnect();};sound.play();}catch(error){console.warn('[audioManager] sound playback failed',error);}}
 function playClick():Promise<void>{director()?.triggerCue?.('ui',{gain:CLICK_VOLUME});return playBuffer(CLICK_VOLUME,1);}
 function playDiscoveryChime():Promise<void>{director()?.triggerCue?.('ambience',{gain:DISCOVERY_CHIME_VOLUME});return playBuffer(DISCOVERY_CHIME_VOLUME,DISCOVERY_CHIME_PLAYBACK_RATE);}
 function setMuted(next:boolean):void{muted=Boolean(next);listener?.setMasterVolume(muted?0:1);director()?.setMasterVolume?.(muted?0:1);}
 function isMuted():boolean{return muted;}
 function update(deltaSeconds:number,world:Readonly<Record<string,unknown>>={}):unknown{return director()?.update?.(deltaSeconds,world)??null;}
 function setEnvironment(nextEnvironment:AudioEnvironment,state:Readonly<Record<string,unknown>>={}):unknown{return director()?.setEnvironment?.(nextEnvironment,state)??null;}
 function registerSpatialSource(source:unknown):unknown{return director()?.registerSource?.(source)??null;}
 function updateSpatialSource(id:string,patch:unknown):unknown{return director()?.updateSource?.(id,patch)??null;}
 function removeSpatialSource(id:string):boolean{return director()?.removeSource?.(id)??false;}
 function setAudioDuck(group:string,active:boolean,options:unknown={}):unknown{return director()?.setDuck?.(group,active,options)??null;}
 function clearAudioDuck(id:string):boolean{return director()?.clearDuck?.(id)??false;}
 function applyAudioOcclusion(result:unknown):unknown{return director()?.applyOcclusion?.(result)??null;}
 function playWorldCue(kind:string,options:unknown={}):unknown{return director()?.triggerCue?.(kind,options)??false;}
 function getImmersiveSnapshot():unknown{return director()?.snapshot?.()??null;}
 function getAudioSnapshot():unknown{return createAudioSnapshot({director:audioDirector});}
 function getAudioSnapshotJson():string{return serializeAudioSnapshot({director:audioDirector});}
 function dispose():void{try{director()?.dispose?.();}catch(error){console.warn('[audioManager] immersive audio dispose failed',error);}audioDirector=null;if(listener)camera.remove(listener);listener=null;}
 return Object.freeze({playClick,playDiscoveryChime,setMuted,isMuted,update,setEnvironment,registerSpatialSource,updateSpatialSource,removeSpatialSource,setAudioDuck,clearAudioDuck,applyAudioOcclusion,playWorldCue,getImmersiveSnapshot,getAudioSnapshot,getAudioSnapshotJson,dispose});
}
