const freeze=(v)=>Object.freeze(v);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const smooth=(a,b,v)=>{const t=clamp((finite(v)-a)/Math.max(.00001,b-a));return t*t*(3-2*t);};

export const TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY=freeze({
 id:'terrain-environment-climate-transitions-2026-09-07-v1',deterministic:true,renderOnly:true,canonicalHeightUnchanged:true,canonicalHydrologyUnchanged:true,canonicalColliderUnchanged:true,
 temperature:{coldC:-8,coolC:3,mildC:13,warmC:22},moisture:{dry:.28,moderate:.55,wet:.76},wind:{low:.3,high:.72},elevation:{uplandMeters:180,alpineMeters:360},transitionBandMeters:90,
});

export const CLIMATE_MATERIAL_CHANNELS=freeze({
 forest:freeze({albedoWet:.82,albedoDry:1.01,roughnessWet:-.08,roughnessDry:.05,mossBias:.65}),
 meadow:freeze({albedoWet:.88,albedoDry:1.05,roughnessWet:-.04,roughnessDry:.04,mossBias:.38}),
 heath:freeze({albedoWet:.91,albedoDry:1.08,roughnessWet:-.02,roughnessDry:.07,mossBias:.22}),
 tundra:freeze({albedoWet:.94,albedoDry:1.02,roughnessWet:-.06,roughnessDry:.03,mossBias:.18}),
 alpine:freeze({albedoWet:.96,albedoDry:1.00,roughnessWet:-.04,roughnessDry:.06,mossBias:.11}),
 wetland:freeze({albedoWet:.78,albedoDry:.94,roughnessWet:-.12,roughnessDry:.02,mossBias:.82}),
 dryland:freeze({albedoWet:.98,albedoDry:1.12,roughnessWet:.03,roughnessDry:.10,mossBias:.05}),
 rock:freeze({albedoWet:.93,albedoDry:1.05,roughnessWet:-.06,roughnessDry:.04,mossBias:.09}),
});

function normalizeBiome(biome){return String(biome??'meadow').trim().toLowerCase();}
function thermalWeight(temperatureC){const p=TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.temperature;return freeze({cold:smooth(-18,p.coldC,temperatureC),cool:smooth(p.coldC,p.coolC,temperatureC),mild:smooth(p.coolC,p.mildC,temperatureC),warm:smooth(p.mildC,p.warmC,temperatureC),hot:smooth(p.warmC,34,temperatureC)});}
function moistureWeight(moisture){const m=clamp(finite(moisture,.5));const p=TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.moisture;return freeze({dry:1-smooth(p.moderate,p.wet,m),moderate:smooth(p.dry,p.wet,m),wet:smooth(p.moderate,1,m),value:m});}
function elevationWeight(elevationMeters){const e=Math.max(0,finite(elevationMeters));const p=TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.elevation;return freeze({upland:smooth(p.uplandMeters-80,p.uplandMeters+80,e),alpine:smooth(p.alpineMeters-80,p.alpineMeters+80,e),coldHighland:smooth(p.alpineMeters+40,560,e)});}
function windWeight(windExposure){const w=clamp(finite(windExposure,.5));return freeze({sheltered:1-smooth(.24,.64,w),exposed:smooth(.32,.88,w),value:w});}

export function biomeTransitionWeights({biome='meadow',moisture=.5,elevationMeters=0,slopeDegrees=0,temperatureC=12}={}){
 const b=normalizeBiome(biome),t=thermalWeight(temperatureC),m=moistureWeight(moisture),e=elevationWeight(elevationMeters),s=smooth(0,42,slopeDegrees);
 const forestBase=clamp((b==='forest'||b==='forest-edge'?1:0)*(.48+t.mild*.32+t.warm*.16)*(.55+m.wet*.42)*(1-s*.34)*(1-e.alpine*.68));
 const wetForest=clamp(forestBase*(.54+m.wet*.46));
 const meadow=clamp((b==='meadow'||b==='grassland'||b==='wet-meadow'?1:0)*(.60+m.moderate*.20+m.wet*.26)*(1-e.alpine*.52));
 const heath=clamp((b==='heath'||b==='dry-heath'||b==='upland-heath'?1:0)*(.58+t.cool*.25+t.mild*.22)*(1-m.wet*.38));
 const tundra=clamp((b==='tundra'||b==='tundra-edge'||b==='alpine-bare'?1:0)*(.52+t.cold*.38+e.coldHighland*.36)*(1-m.wet*.08));
 const wetland=clamp((b==='wetland'||b==='marsh'||b==='fen'?1:0)*(.62+m.wet*.54)*(1-s*.55)*(1-e.alpine*.85));
 const dryland=clamp((b==='dryland'||b==='steppe'||b==='scrub'?1:0)*(.54+t.warm*.42)*(1-m.wet*.64)*(1-e.alpine*.78));
 const alpine=clamp((e.alpine*.68+t.cold*.22+s*.26)*(b==='alpine-bare'||b==='tundra'?1:.72));
 return freeze({forest:forestBase,wetForest,meadow,heath,tundra,wetland,dryland,alpine,thermal:t,moisture:m,elevation:e,slope:s});
}

export function climateMaterialResponse({biome='meadow',moisture=.5,temperatureC=12,exposure=.5,rockWeight=0,snowWeight=0}={}){
 const b=normalizeBiome(biome),channel=CLIMATE_MATERIAL_CHANNELS[b]??CLIMATE_MATERIAL_CHANNELS.meadow,m=moistureWeight(moisture),t=thermalWeight(temperatureC),w=windWeight(exposure),rock=clamp(rockWeight),snow=clamp(snowWeight);
 const dryFactor=clamp((t.warm+t.hot*.55)*(1-m.wet*.48)+w.exposed*.14);const wetFactor=clamp(m.wet*(1-t.hot*.30)+snow*.08);
 const albedoValue=clamp(channel.albedoWet+(channel.albedoDry-channel.albedoWet)*dryFactor-snow*.06,0.72,1.18);
 const roughnessOffset=clamp(channel.roughnessWet+(channel.roughnessDry-channel.roughnessWet)*dryFactor+wetFactor*-.055+rock*.08+w.exposed*.025,-.18,.18);
 const mossBlend=clamp(channel.mossBias*wetFactor*(1-rock*.42));
 const frostBlend=clamp(snow*(.72+w.sheltered*.14));
 const weathering=clamp(.22+m.wet*.26+w.exposed*.18+rock*.22+snow*.12);
 return freeze({biome:b,albedoValue,roughnessOffset,mossBlend,frostBlend,weathering,moisture:m.value,thermal:t,wind:w});
}

export function seasonalAssetWeights({season='summer',snowWeight=0,temperatureC=12,biome='meadow',moisture=.5,windExposure=.5}={}){
 const s=String(season??'summer').toLowerCase(),snow=clamp(snowWeight),b=normalizeBiome(biome),t=thermalWeight(temperatureC),m=moistureWeight(moisture),w=windWeight(windExposure);
 const winterSignal=s==='winter'||s==='late-winter'||s==='snow' ? 1 : 0;const autumnSignal=s==='autumn'||s==='fall' ? 1:0;const springSignal=s==='spring'?1:0;
 const evergreen=/pine|spruce|fir|evergreen|tundra/.test(b);const deciduous=!evergreen;
 const winterVegetation=clamp(winterSignal*(snow*.72+t.cold*.25+(evergreen?.25:0)));
 const dormantLeaf=clamp(winterVegetation*(deciduous?.92:.22)+autumnSignal*.34);
 const flowering=clamp(springSignal*(m.moderate*.46+t.mild*.42)*(1-snow*.82));
 const dryGrass=clamp((seasonalDrySeasonScore(s,temperatureC,m.value))*(1-snow*.74)*(b==='dryland'||b==='heath'?.98:.62));
 const wetGrowth=clamp((springSignal*.44+m.wet*.34)*(1-winterVegetation*.72));
 return freeze({winterVegetation,dormantLeaf,flowering,dryGrass,wetGrowth,evergreen,deciduous,season:s,windRetention:w.sheltered});
}

function seasonalDrySeasonScore(season,temperatureC,moisture){const s=String(season);const seasonalBoost=s==='summer'||s==='late-summer'?1:s==='spring'?.46:s==='autumn'?.64:.08;return clamp(seasonalBoost*(.44+thermalWeight(temperatureC).warm*.44)*(1-moisture*.56));}

export function climateExposureEnvelope({temperatureC=12,moisture=.5,windExposure=.5,elevationMeters=0,biome='meadow',slopeDegrees=0}={}){
 const t=thermalWeight(temperatureC),m=moistureWeight(moisture),w=windWeight(windExposure),e=elevationWeight(elevationMeters),b=biomeTransitionWeights({biome,moisture,elevationMeters,slopeDegrees,temperatureC});
 const forestScore=clamp(b.forest*.48+b.wetForest*.22+t.mild*.12+m.wet*.10+w.sheltered*.08);
 const heathScore=clamp(b.heath*.42+t.cool*.18+(1-m.wet)*.22+w.exposed*.09+e.upland*.09);
 const tundraScore=clamp(b.tundra*.42+b.alpine*.28+t.cold*.15+e.coldHighland*.1+w.exposed*.05);
 const wetlandScore=clamp(b.wetland*.56+m.wet*.24+(1-w.exposed)*.12+(1-e.alpine)*.08);
 const drylandScore=clamp(b.dryland*.56+t.hot*.18+(1-m.wet)*.18+e.upland*.08);
 return freeze({forestScore,heathScore,tundraScore,wetlandScore,drylandScore,thermal:t,moisture:m,wind:w,elevation:e,transition:b});
}

export function climateMaterialLayers(options={}){const response=climateMaterialResponse(options);const seasonal=seasonalAssetWeights(options);return freeze({policyId:TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id,albedoValue:response.albedoValue,roughnessOffset:response.roughnessOffset,mossBlend:response.mossBlend,frostBlend:response.frostBlend,weathering:response.weathering,seasonal,renderOnly:true});}

export function validateClimateTransitionSample(sample={}){
 const errors=[];const r=climateMaterialResponse(sample);const b=biomeTransitionWeights(sample);const s=seasonalAssetWeights(sample);if(r.albedoValue<.72||r.albedoValue>1.18)errors.push('albedo-range');if(r.roughnessOffset<-.18||r.roughnessOffset>.18)errors.push('roughness-range');if(b.forest<0||b.tundra<0||b.wetland<0)errors.push('biome-weight-range');if(s.winterVegetation<0||s.winterVegetation>1)errors.push('seasonal-range');return freeze({ok:errors.length===0,errors:freeze(errors),policyId:TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id});}

export function buildClimateTransitionManifest(samples=[]){const reports=samples.map(validateClimateTransitionSample);const errors=reports.flatMap(r=>r.errors);return freeze({version:1,policyId:TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id,reports,errors:freeze(errors),acceptance:freeze({ok:errors.length===0,errorCount:errors.length})});}
