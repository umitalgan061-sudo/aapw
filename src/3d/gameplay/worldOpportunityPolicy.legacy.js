/**
 * Deterministic world-opportunity policy.
 * Read-only: describes authored opportunities without creating or mutating world entities.
 */
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
export const WORLD_OPPORTUNITY_POLICY = freeze({
  version: 1,
  maxDistanceMeters: 360,
  maxCandidatesDesktop: 14,
  maxCandidatesMobile: 9,
  maxSignals: 12,
  opportunityTypes: [
    'landmark','resource_patch','shelter','trade_window','social_gathering','watch_point',
    'route_choice','weather_break','quiet_space','danger_edge','craft_window','rest_window',
  ],
  accessModes: ['visible','nearby','approach','restricted','weather_gated'],
});
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const text = (v, fallback='unknown') => String(v ?? fallback).trim() || fallback;
export function stableHash(input) {
  let hash = 2166136261;
  for (let i=0;i<input.length;i+=1) { hash ^= input.charCodeAt(i); hash = Math.imul(hash,16777619); }
  return hash >>> 0;
}
const jitter = (seed, id) => (stableHash(`${seed}:${id}`) % 1000) / 1000;
export function getWorldPhase(clockSeconds) {
  const s=((Math.floor(Number(clockSeconds)||0)%86400)+86400)%86400;
  if(s<21600) return 'night';
  if(s<28800) return 'dawn';
  if(s<43200) return 'morning';
  if(s<57600) return 'midday';
  if(s<68400) return 'afternoon';
  if(s<75600) return 'dusk';
  return 'evening';
}
export function normalizeOpportunityContext(input={}) {
  return freeze({
    seed:text(input.seed,'world'),
    distanceMeters:clamp(input.distanceMeters,0,360),
    slope:clamp01(input.slope),
    vegetation:clamp01(input.vegetation),
    moisture:clamp01(input.moisture),
    populationDensity:clamp01(input.populationDensity),
    threatLevel:clamp01(input.threatLevel),
    roadActivity:clamp01(input.roadActivity),
    routeFriction:clamp01(input.routeFriction),
    visibility:clamp01(input.visibility ?? 1),
    clockSeconds:Number(input.clockSeconds)||0,
    weather:text(input.weather,'clear').toLowerCase(),
    biome:text(input.biome,'mixed').toLowerCase(),
    settlementDistanceMeters:clamp(input.settlementDistanceMeters,0,5000),
    landmarkDistanceMeters:clamp(input.landmarkDistanceMeters,0,5000),
    shelterAvailable:Boolean(input.shelterAvailable),
    resourceAbundance:clamp01(input.resourceAbundance),
    patrolPressure:clamp01(input.patrolPressure),
  });
}
const distanceScore = (m) => clamp01(1-m/360);
const baseScore = {
 landmark:.64,resource_patch:.68,shelter:.72,trade_window:.70,social_gathering:.58,watch_point:.55,
 route_choice:.62,weather_break:.50,quiet_space:.48,danger_edge:.34,craft_window:.52,rest_window:.58,
};
const phasePreference = {
 landmark:['morning','afternoon','dusk'],resource_patch:['morning','afternoon'],
 shelter:['dusk','evening','night'],trade_window:['morning','midday','afternoon'],
 social_gathering:['dusk','evening'],watch_point:['dawn','dusk','night'],
 route_choice:['morning','afternoon'],weather_break:['morning','midday','afternoon'],
 quiet_space:['night','dawn'],danger_edge:['dusk','night'],
 craft_window:['morning','midday','afternoon'],rest_window:['afternoon','evening','night'],
};
const weatherPenalty = {
 landmark:{fog:.25,rain:.05,snow:.08,storm:.35},resource_patch:{fog:.05,rain:.04,snow:.2,storm:.3},
 shelter:{fog:0,rain:0,snow:0,storm:0},trade_window:{fog:.08,rain:.12,snow:.18,storm:.3},
 social_gathering:{fog:.02,rain:.12,snow:.18,storm:.35},watch_point:{fog:.35,rain:.1,snow:.1,storm:.25},
 route_choice:{fog:.18,rain:.08,snow:.1,storm:.25},weather_break:{fog:0,rain:0,snow:0,storm:0},
 quiet_space:{fog:0,rain:.02,snow:.04,storm:.1},danger_edge:{fog:.08,rain:.12,snow:.08,storm:.05},
 craft_window:{fog:0,rain:.01,snow:.03,storm:.08},rest_window:{fog:0,rain:.03,snow:.02,storm:.02},
};
function biomeFactor(type,biome) {
  if(type==='landmark') return biome.includes('mountain')?1:biome.includes('forest')?.8:.75;
  if(type==='resource_patch') return biome.includes('forest')||biome.includes('wetland')?1:.72;
  if(type==='shelter') return biome.includes('mountain')||biome.includes('forest')?.9:.76;
  if(type==='trade_window') return biome.includes('plains')||biome.includes('road')?1:.78;
  if(type==='social_gathering') return biome.includes('settlement')||biome.includes('plains')?1:.65;
  if(type==='watch_point') return biome.includes('ridge')||biome.includes('mountain')?1:.74;
  if(type==='quiet_space') return biome.includes('forest')||biome.includes('cave')?1:.8;
  if(type==='danger_edge') return biome.includes('frontier')||biome.includes('mountain')?.95:.7;
  return .84;
}
function reason(type,c) {
 const reasons={
  landmark:`landmark proximity ${Math.round(c.distanceMeters)}m`,
  resource_patch:`resource abundance ${(c.resourceAbundance*100).toFixed(0)}%`,
  shelter:c.shelterAvailable?'known shelter is available':'cover is implied by conditions',
  trade_window:`settlement proximity ${Math.round(c.settlementDistanceMeters)}m`,
  social_gathering:`population density ${(c.populationDensity*100).toFixed(0)}%`,
  watch_point:`visibility ${(c.visibility*100).toFixed(0)}%`,
  route_choice:`route friction ${(c.routeFriction*100).toFixed(0)}%`,
  weather_break:`${c.weather} conditions favor cover`,
  quiet_space:'lower population pressure supports a quiet space',
  danger_edge:`threat pressure ${(c.threatLevel*100).toFixed(0)}%`,
  craft_window:'stable conditions support craft',
  rest_window:`${getWorldPhase(c.clockSeconds)} phase supports rest`,
 };
 return reasons[type];
}
export function scoreWorldOpportunity(type,input={}) {
 const c=normalizeOpportunityContext(input);
 if(!WORLD_OPPORTUNITY_POLICY.opportunityTypes.includes(type)) throw new Error(`Unknown world opportunity type: ${type}`);
 const p=getWorldPhase(c.clockSeconds);
 const d=distanceScore(c.distanceMeters);
 const prox=(type==='trade_window'||type==='social_gathering')?clamp01(1-c.settlementDistanceMeters/360):d;
 const visibilityGate=c.visibility<.25&&!['shelter','weather_break','rest_window'].includes(type)?.45:1;
 let score=baseScore[type];
 score*=.52+.48*prox;
 score*=.62+.38*(phasePreference[type].includes(p)?1:.72);
 score*=.68+.32*biomeFactor(type,c.biome);
 score*=visibilityGate;
 score*=1-(weatherPenalty[type]?.[c.weather]??.05);
 if(type==='resource_patch') score*=.55+.45*c.resourceAbundance;
 if(type==='shelter'||type==='rest_window'||type==='weather_break') score*=.58+.42*(c.weather==='storm'?1:c.moisture);
 if(type==='trade_window'||type==='social_gathering') score*=.55+.45*c.populationDensity;
 if(type==='watch_point') score*=.58+.42*c.visibility;
 if(type==='route_choice') score*=.7+.3*(1-c.routeFriction);
 if(type==='danger_edge') score*=.42+.58*(c.threatLevel+c.patrolPressure)/2;
 score+=(jitter(c.seed,`${type}:${Math.round(c.distanceMeters)}`)-.5)*.04;
 return clamp01(score);
}
export function classifyWorldOpportunity(type,input={}) {
 const c=normalizeOpportunityContext(input);
 const score=scoreWorldOpportunity(type,c);
 const storm=['storm','blizzard','whiteout'].includes(c.weather);
 const access=c.visibility<.3?'nearby':c.distanceMeters<90?'approach':'visible';
 return freeze({type,score:Number(score.toFixed(4)),phase:getWorldPhase(c.clockSeconds),
   access:storm&&!['shelter','weather_break','rest_window'].includes(type)?'weather_gated':access,
   reason:reason(type,c)});
}
export function rankWorldOpportunities(input={},options={}) {
 const c=normalizeOpportunityContext(input);
 const limit=Math.max(1,Math.min(Number(options.maxCandidates)||14,14));
 const candidates=WORLD_OPPORTUNITY_POLICY.opportunityTypes
  .filter(t=>!(t==='shelter'&&!c.shelterAvailable&&c.weather==='clear'))
  .map(t=>classifyWorldOpportunity(t,c))
  .sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type))
  .slice(0,limit).map((x,i)=>freeze({...x,rank:i+1}));
 return freeze({version:1,phase:getWorldPhase(c.clockSeconds),candidates,count:candidates.length});
}
export function buildOpportunitySignal(candidate,input={}) {
 const c=normalizeOpportunityContext(input);
 const confidence=clamp01(candidate.score*(.65+.35*c.visibility));
 return freeze({id:`${candidate.type}:${stableHash(`${c.seed}:${candidate.type}:${Math.floor(c.distanceMeters)}`)}`,
  type:candidate.type,rank:candidate.rank??null,score:candidate.score,confidence:Number(confidence.toFixed(4)),
  access:candidate.access,evidence:freeze({distanceMeters:Number(c.distanceMeters.toFixed(2)),
  visibility:Number(c.visibility.toFixed(3)),weather:c.weather,phase:getWorldPhase(c.clockSeconds)})});
}
export function buildWorldOpportunitySnapshot(input={},options={}) {
 const c=normalizeOpportunityContext(input); const ranked=rankWorldOpportunities(c,options);
 const signals=ranked.candidates.slice(0,12).map(x=>buildOpportunitySignal(x,c));
 const deterministicKey=stableHash(JSON.stringify({seed:c.seed,phase:ranked.phase,
  weather:c.weather,distance:c.distanceMeters})).toString(16);
 return freeze({version:1,phase:ranked.phase,candidates:ranked.candidates,signals,deterministicKey});
}
