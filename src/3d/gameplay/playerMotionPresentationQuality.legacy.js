/** Quality report for the complete player presentation packet. */
import { validatePlayerMotionPresentation } from './playerMotionPresentationPolicy.js';
import { evaluatePlayerPresentationHealth } from './playerPresentationHealth.js';
import { isPlayerMotionBlendStable } from './playerMotionPresentationBlendPolicy.js';

export const PLAYER_MOTION_PRESENTATION_QUALITY_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}
export function evaluatePlayerMotionQuality(state={},previous=null,timeline=[]){const validation=validatePlayerMotionPresentation({state,contract:state.traversalContract??{},blend:state.blend??{},projection:state.projection??{}});const health=evaluatePlayerPresentationHealth(state,previous,timeline);const stable=isPlayerMotionBlendStable(previous??state,state);const score=round((clamp01(health.score)*.5+(validation.valid?1:0)*.25+(stable?1:0)*.15+clamp01(state.channels?.confidence)*.1));return freeze({version:PLAYER_MOTION_PRESENTATION_QUALITY_VERSION,valid:validation.valid,healthy:health.healthy,stableBlend:stable,score,validation,health});}
export function summarizePlayerMotionQuality(report={}){return freeze({version:PLAYER_MOTION_PRESENTATION_QUALITY_VERSION,valid:Boolean(report.valid),healthy:Boolean(report.healthy),stableBlend:Boolean(report.stableBlend),score:round(report.score)});}
export function comparePlayerMotionQuality(a,b){return JSON.stringify(summarizePlayerMotionQuality(a))===JSON.stringify(summarizePlayerMotionQuality(b));}
