import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const ATMOSPHERE_V67 = Object.freeze({id:'atmosphere-v67',version:67,deterministic:true,noWorldMutation:true});
export const fogDensityV67 = (sample={}) => { const s=normalizeSampleV67(sample); const precip=clamp01(sample.precipitation??s.rain); const thermal=clamp01(1-Math.abs(s.temperature-9)/32); return clamp01(s.humidity*.55+precip*.3+thermal*.12-s.elevation/12000); };
export const horizonVisibilityV67 = (sample={}) => clamp01(1-fogDensityV67(sample)*.88);
export const skyLuminanceV67 = (sample={}) => { const sun=clamp01((finiteV67(sample.sunElevation,18)+6)/96); return clamp01(.22+sun*.68-clamp01(sample.cloudCover)*.18); };
export const cloudShadowV67 = (sample={}) => clamp01(sample.cloudCover)*clamp01((finiteV67(sample.sunElevation,18)+10)/100);
export const exposureCompensationV67 = (sample={}) => clamp01(.72+(0.45-skyLuminanceV67(sample))*.75+(1-horizonVisibilityV67(sample))*.1);
export const buildAtmosphereSampleV67 = (sample={}) => { const s=normalizeSampleV67(sample); const fog=fogDensityV67({...s,...sample}); return {id:s.id,fog,visibility:horizonVisibilityV67({...s,...sample}),skyLuma:skyLuminanceV67(sample),cloudShadow:cloudShadowV67(sample),exposure:exposureCompensationV67(sample)}; };
export const buildAtmosphereFieldV67 = (samples=[]) => samples.map(buildAtmosphereSampleV67);
export const atmosphereSummaryV67 = (field=[]) => ({samples:field.length,meanVisibility:meanV67(field.map(x=>x.visibility)),meanFog:meanV67(field.map(x=>x.fog)),darkFrames:field.filter(x=>x.skyLuma<.3).length});
export const visibilityBandV67 = (visibility=1) => visibility<.2?'blind':visibility<.42?'poor':visibility<.7?'usable':'clear';
export const buildHorizonEnvelopeV67 = (field=[]) => field.map(x=>({id:x.id,visibility:x.visibility,band:visibilityBandV67(x.visibility),fog:x.fog}));
export const validateAtmosphereV67 = (field=[]) => { const errors=[]; if(!Array.isArray(field))errors.push('field'); if(field.some(x=>x.visibility<0||x.visibility>1))errors.push('visibility-range'); if(field.some(x=>x.fog<0||x.fog>1))errors.push('fog-range'); return {ok:errors.length===0,errors}; };
export const atmosphereTelemetryV67 = (field=[]) => ({policy:ATMOSPHERE_V67.id,summary:atmosphereSummaryV67(field),valid:validateAtmosphereV67(field).ok});
export const cameraReadabilityV67 = (sample={}) => clamp01(horizonVisibilityV67(sample)*.7+skyLuminanceV67(sample)*.3);
export const atmosphereScenarioV67 = ({humidity=.7,precipitation=.2,cloudCover=.4,sunElevation=25}={}) => ({humidity,precipitation,cloudCover,sunElevation,density:fogDensityV67({humidity,rain:precipitation,cloudCover,sunElevation})});
export const blendAtmosphereV67 = (a={},b={},weight=.5) => { const t=clamp01(weight); return {fog:a.fog*(1-t)+b.fog*t,visibility:a.visibility*(1-t)+b.visibility*t,skyLuma:a.skyLuma*(1-t)+b.skyLuma*t}; };
