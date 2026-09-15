import { clamp01, finiteV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

const HABITATS = Object.freeze({
  elk:{slope:.48,moisture:.58,canopy:.62,disturbance:.18},
  wolf:{slope:.68,moisture:.42,canopy:.4,disturbance:.28},
  ibex:{slope:.92,moisture:.2,canopy:.12,disturbance:.2},
  boar:{slope:.55,moisture:.76,canopy:.78,disturbance:.3},
  fox:{slope:.6,moisture:.34,canopy:.3,disturbance:.4},
  crane:{slope:.22,moisture:.88,canopy:.08,disturbance:.2},
});
export const WILDLIFE_V67 = Object.freeze({id:'wildlife-v67',version:67,deterministic:true,noWorldMutation:true});
const fit=(value,target,scale=.8)=>clamp01(1-Math.abs(clamp01(value)-target)/scale);
export const habitatScoreV67 = (sample={},species='elk') => { const s=normalizeSampleV67(sample); const r=HABITATS[species]??HABITATS.elk; return clamp01(fit(s.slope,r.slope)*.26+fit(s.moisture,r.moisture)*.27+fit(s.canopy,r.canopy)*.25+fit(1-s.humanPressure,1-r.disturbance)*.22); };
export const rankSpeciesV67 = (sample={}) => Object.keys(HABITATS).map(species=>({species,score:habitatScoreV67(sample,species)})).sort((a,b)=>b.score-a.score);
export const chooseSpeciesV67 = (sample={}) => rankSpeciesV67(sample)[0];
export const predatorPressureV67 = (sample={}) => clamp01(sample.wolfPressure??0);
export const preySafetyV67 = (sample={},species='elk') => clamp01(habitatScoreV67(sample,species)*(1-predatorPressureV67(sample)*.55)-normalizeSampleV67(sample).humanPressure*.35);
export const corridorWeightV67 = (sample={},species='elk') => clamp01(habitatScoreV67(sample,species)*.72+preySafetyV67(sample,species)*.28);
export const disturbanceAvoidanceV67 = (sample={}) => clamp01(normalizeSampleV67(sample).humanPressure);
export const buildWildlifeSampleV67 = (sample={}) => { const ranked=rankSpeciesV67(sample); const top=ranked[0]; return {id:normalizeSampleV67(sample).id,species:top.species,suitability:top.score,safety:preySafetyV67(sample,top.species),avoidance:disturbanceAvoidanceV67(sample),corridor:corridorWeightV67(sample,top.species)}; };
export const buildWildlifeFieldV67 = (samples=[]) => samples.map(buildWildlifeSampleV67);
export const migrationPressureV67 = (field=[]) => meanV67(field.map(x=>clamp01(1-x.suitability+x.avoidance*.4)));
export const corridorLinksV67 = (field=[]) => { const strong=field.filter(x=>x.corridor>.58); return Math.max(0,strong.length-1); };
export const wildlifeSummaryV67 = (field=[]) => ({samples:field.length,topSpecies:Object.fromEntries(Object.keys(HABITATS).map(k=>[k,field.filter(x=>x.species===k).length])),migrationPressure:migrationPressureV67(field),links:corridorLinksV67(field)});
export const validateWildlifeV67 = (field=[]) => { const errors=[]; if(!Array.isArray(field))errors.push('field'); if(field.some(x=>x.suitability<0||x.suitability>1))errors.push('suitability-range'); if(field.some(x=>!HABITATS[x.species]))errors.push('species'); return {ok:errors.length===0,errors}; };
export const wildlifeTelemetryV67 = (field=[]) => ({policy:WILDLIFE_V67.id,summary:wildlifeSummaryV67(field),valid:validateWildlifeV67(field).ok});
export const herdActivityV67 = (field=[]) => clamp01(meanV67(field.map(x=>x.safety))*.7+meanV67(field.map(x=>x.corridor))*.3);
export const animalAlertV67 = (sample={}) => clamp01(finiteV67(sample.humanPressure)*.65+finiteV67(sample.wolfPressure)*.35);
