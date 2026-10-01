
import { clamp, type R35AccessibilityProfile, type R35Id } from './contracts';

const DEFAULT:R35AccessibilityProfile=Object.freeze({reducedMotion:false,highContrast:false,textScale:1,subtitleMode:'speech',colorMode:'normal',inputRepeat:1,haptics:true});
export interface AccessibleInput { readonly action:R35Id; readonly value:number; readonly repeat:number; readonly announced:boolean; }
export class AccessibilityRuntimeR35 {
  #profile:R35AccessibilityProfile=DEFAULT; #remap=new Map<R35Id,R35Id>(); #recentAnnouncements:string[]=[];
  setProfile(next:Partial<R35AccessibilityProfile>):R35AccessibilityProfile{this.#profile=Object.freeze({reducedMotion:next.reducedMotion??this.#profile.reducedMotion,highContrast:next.highContrast??this.#profile.highContrast,textScale:clamp(next.textScale??this.#profile.textScale,0.75,2.5),subtitleMode:next.subtitleMode??this.#profile.subtitleMode,colorMode:next.colorMode??this.#profile.colorMode,inputRepeat:clamp(next.inputRepeat??this.#profile.inputRepeat,0.5,4),haptics:next.haptics??this.#profile.haptics});return this.#profile;}
  remap(action:R35Id,to:R35Id):void{if(action&&to&&action!==to)this.#remap.set(action,to);}
  clearRemap(action?:R35Id):void{if(action)this.#remap.delete(action);else this.#remap.clear();}
  normalizeInput(action:R35Id,value:number,repeat=1):AccessibleInput{const mapped=this.#remap.get(action)??action;const repeats=Math.max(1,Math.round(Math.max(0,repeat)*this.#profile.inputRepeat));return Object.freeze({action:mapped,value:Number.isFinite(value)?value:0,repeat:repeats,announced:repeats>1});}
  motionScale():number{return this.#profile.reducedMotion?0.35:1;}
  subtitleEnabled(kind:'speech'|'effect'|'ambient'):boolean{if(this.#profile.subtitleMode==='off')return false;if(this.#profile.subtitleMode==='speech')return kind==='speech';return true;}
  announce(text:string):string{const normalized=text.replace(/\s+/g,' ').trim().slice(0,240);if(normalized)this.#recentAnnouncements.push(normalized);if(this.#recentAnnouncements.length>32)this.#recentAnnouncements.shift();return normalized;}
  announcements():ReadonlyArray<string>{return Object.freeze([...this.#recentAnnouncements]);}
  profile():R35AccessibilityProfile{return this.#profile;}
  colorTransform(rgb:{r:number;g:number;b:number}):{r:number;g:number;b:number}{const r=clamp(rgb.r,0,1),g=clamp(rgb.g,0,1),b=clamp(rgb.b,0,1);switch(this.#profile.colorMode){case 'deuteranopia':return {r:0.625*r+0.375*g,g:0.7*r+0.3*g,b:b};case 'protanopia':return {r:0.567*r+0.433*g,g:0.558*r+0.442*g,b:b};case 'tritanopia':return {r:r,g:0.95*g+0.05*b,b:0.433*g+0.567*b};default:return {r,g,b};}}
}
