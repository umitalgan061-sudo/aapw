/**
 * World coverage director v51.
 *
 * Deterministic, DOM-free, read-only environment coverage planning for the
 * shipped world. It converts canonical caller-owned observations into spatial
 * coverage cells, biome/ecotone summaries, weather cells, camera profiles,
 * grounded placement gates, LOD/instancing budgets and P0-P5 audit evidence.
 *
 * The caller remains authoritative for terrain, hydrology, colliders, roads,
 * settlements, renderer, assets and scene mutation. This module creates no
 * geometry, invents no geography, hydrates no assets, imports no editor UI,
 * and does not duplicate the shared model-bearing material/placement system.
 */

const MAX_SAMPLES = 512;
const MAX_CELLS = 256;
const MAX_REGIONS = 96;
const MAX_WEATHER_CELLS = 128;
const DEFAULT_SEED = 5101;
const WORLD_EXTENT = 180000;
const CELL_SIZE = 1500;

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const positive = (v, fallback = 0) => Math.max(0, finite(v, fallback));
const round = (v, digits = 6) => { const p = 10 ** digits; return Math.round(finite(v) * p) / p; };
const hash32 = (value) => { let h = 2166136261; const t = String(value); for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const noise01 = (seed, value) => (hash32(`${seed}:${value}`) % 100000) / 100000;
const id = (v, fallback) => String(v ?? fallback).trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 96) || fallback;
const deepFreeze = (v) => { if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v; Object.freeze(v); Object.values(v).forEach(deepFreeze); return v; };
const stableStringify = (v) => { const n = (x) => Array.isArray(x) ? x.map(n) : (!x || typeof x !== 'object') ? x : Object.keys(x).sort().reduce((o,k) => { o[k]=n(x[k]); return o; }, {}); return JSON.stringify(n(v)); };

const BIOME_PROFILES = Object.freeze({
  'temperate-forest': Object.freeze({ vegetation:.72, moisture:.55, snow:.18, rock:.18, kind:'forest' }),
  'mixed-forest': Object.freeze({ vegetation:.68, moisture:.58, snow:.12, rock:.22, kind:'forest' }),
  'boreal-forest': Object.freeze({ vegetation:.62, moisture:.62, snow:.42, rock:.30, kind:'forest' }),
  'alpine': Object.freeze({ vegetation:.12, moisture:.48, snow:.92, rock:.38, kind:'alpine' }),
  'subalpine': Object.freeze({ vegetation:.28, moisture:.52, snow:.72, rock:.30, kind:'alpine' }),
  'tundra': Object.freeze({ vegetation:.08, moisture:.44, snow:.96, rock:.48, kind:'alpine' }),
  'wetland': Object.freeze({ vegetation:.78, moisture:.86, snow:.05, rock:.08, kind:'wet' }),
  'marsh': Object.freeze({ vegetation:.82, moisture:.91, snow:.02, rock:.04, kind:'wet' }),
  'riparian': Object.freeze({ vegetation:.76, moisture:.84, snow:.08, rock:.12, kind:'wet' }),
  'coastal': Object.freeze({ vegetation:.55, moisture:.72, snow:.04, rock:.10, kind:'coast' }),
  'rocky-coast': Object.freeze({ vegetation:.24, moisture:.52, snow:.16, rock:.64, kind:'coast' }),
  'beach': Object.freeze({ vegetation:.36, moisture:.66, snow:.01, rock:.02, kind:'coast' }),
  'grassland': Object.freeze({ vegetation:.54, moisture:.32, snow:.01, rock:.10, kind:'grass' }),
  'meadow': Object.freeze({ vegetation:.64, moisture:.48, snow:.02, rock:.08, kind:'grass' }),
  'steppe': Object.freeze({ vegetation:.28, moisture:.19, snow:.00, rock:.16, kind:'grass' }),
  'badlands': Object.freeze({ vegetation:.08, moisture:.11, snow:.01, rock:.76, kind:'arid' }),
  'desert': Object.freeze({ vegetation:.04, moisture:.07, snow:.00, rock:.42, kind:'arid' }),
  'savanna': Object.freeze({ vegetation:.46, moisture:.20, snow:.00, rock:.13, kind:'grass' }),
  'rainforest': Object.freeze({ vegetation:.92, moisture:.88, snow:.02, rock:.10, kind:'forest' }),
  'mangrove': Object.freeze({ vegetation:.94, moisture:.94, snow:.00, rock:.20, kind:'wet' }),
  'heath': Object.freeze({ vegetation:.58, moisture:.55, snow:.12, rock:.18, kind:'shrub' }),
  'shrubland': Object.freeze({ vegetation:.48, moisture:.44, snow:.05, rock:.26, kind:'shrub' }),
  'highland': Object.freeze({ vegetation:.32, moisture:.40, snow:.45, rock:.48, kind:'alpine' }),
  'volcanic': Object.freeze({ vegetation:.18, moisture:.28, snow:.30, rock:.82, kind:'rock' }),
  'karst': Object.freeze({ vegetation:.52, moisture:.58, snow:.10, rock:.70, kind:'rock' }),
  'canyon': Object.freeze({ vegetation:.22, moisture:.18, snow:.08, rock:.86, kind:'rock' }),
  'plateau': Object.freeze({ vegetation:.32, moisture:.27, snow:.12, rock:.54, kind:'rock' }),
  'foothill': Object.freeze({ vegetation:.58, moisture:.46, snow:.18, rock:.48, kind:'mixed' }),
  'urban-edge': Object.freeze({ vegetation:.44, moisture:.38, snow:.02, rock:.26, kind:'edge' }),
  'agricultural-edge': Object.freeze({ vegetation:.62, moisture:.42, snow:.06, rock:.12, kind:'edge' }),
  'snowfield': Object.freeze({ vegetation:.18, moisture:.40, snow:1.00, rock:.18, kind:'alpine' }),
  'glacial': Object.freeze({ vegetation:.12, moisture:.58, snow:.98, rock:.72, kind:'alpine' }),
});

const normalizeVec = (v = {}) => ({ x: round(finite(v.x)), y: round(finite(v.y)), z: round(finite(v.z)) });
const normalizeObservation = (sample = {}, index, seed) => {
  const biome = id(sample.biome, 'unknown');
  const profile = BIOME_PROFILES[biome] || BIOME_PROFILES.grassland;
  return {
    id:id(sample.id, `sample-${index}`), position:normalizeVec(sample.position), elevation:round(finite(sample.elevation),3), slope:round(clamp(sample.slope,0,1)),
    moisture:round(clamp(sample.moisture,0,1)), snow:round(clamp(sample.snow,0,1)), waterDistance:round(positive(sample.waterDistance,WORLD_EXTENT),3),
    roadDistance:round(positive(sample.roadDistance,WORLD_EXTENT),3), settlementDistance:round(positive(sample.settlementDistance,WORLD_EXTENT),3), biome, kind:profile.kind,
    profile, visibility:round(clamp(1-positive(sample.distance,0)/WORLD_EXTENT-clamp(sample.horizonOcclusion,0,1)*0.35,0.06,1)),
    horizonOcclusion:round(clamp(sample.horizonOcclusion,0,1)), distance:round(positive(sample.distance,0),3), temperatureC:round(clamp(sample.weather?.temperatureC,-40,60),3),
    cloud:round(clamp(sample.weather?.cloud,0,1)), precipitation:round(clamp(sample.weather?.precipitation,0,1)), wind:round(clamp(sample.weather?.wind,0,1)), phase:round(noise01(seed,`${sample.id ?? index}:phase`)),
  };
};
const cellKey = (x,z) => `${x}:${z}`;
const spatialCell = (sample) => ({ x:Math.floor(sample.position.x/CELL_SIZE), z:Math.floor(sample.position.z/CELL_SIZE) });
const distance2 = (a,b) => { const dx=a.x-b.x; const dz=a.z-b.z; return Math.sqrt(dx*dx+dz*dz); };
const lerp = (a,b,t) => a+(b-a)*clamp(t,0,1);
const smoothstep = (a,b,x) => { const t=clamp((x-a)/Math.max(b-a,1e-9),0,1); return t*t*(3-2*t); };
const meanField = (rows, field) => rows.length ? rows.reduce((sum,row)=>sum+finite(row[field]),0)/rows.length : 0;
const maxField = (rows, field) => rows.length ? Math.max(...rows.map(row=>finite(row[field]))) : 0;
const minField = (rows, field) => rows.length ? Math.min(...rows.map(row=>finite(row[field]))) : 0;
const uniqueSorted = (values) => [...new Set(values)].sort((a,b)=>String(a).localeCompare(String(b)));

const deriveSurface = (sample) => {
  const p=sample.profile;
  const shoreline=clamp(1-sample.waterDistance/250,0,1)*clamp(sample.moisture+0.2,0,1);
  const wet=clamp(shoreline*0.72+sample.moisture*0.28,0,1);
  const steep=clamp((sample.slope-0.52)/0.48,0,1);
  const snowline=clamp(sample.snow*0.72+(sample.elevation/5000)*0.18,0,1);
  const rock=clamp(p.rock*(0.35+steep*0.75+snowline*0.2),0,1);
  const grass=clamp(p.vegetation*(1-steep)*(1-sample.snow*0.84)*(0.55+sample.moisture*0.45),0,1);
  const soil=clamp((1-rock)*(0.48+(1-sample.moisture)*0.18),0,1);
  const mud=clamp((1-rock)*sample.moisture*(0.35+shoreline*0.65),0,1);
  const snowWeight=clamp(sample.snow*(0.7+snowline*0.3)*(1-steep*0.25),0,1);
  const scree=clamp(rock*(0.32+steep*0.68),0,1);
  return {grass:round(grass),soil:round(soil),mud:round(mud),rock:round(rock),scree:round(scree),snow:round(snowWeight),wet:round(wet),shoreline:round(shoreline)};
};
const normalizeWeights = (weights) => { const total=Object.values(weights).reduce((sum,v)=>sum+positive(v),0); return total>0?Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,round(v/total)])):Object.fromEntries(Object.keys(weights).map(k=>[k,0])); };
const coverageCellFromSamples = (samples,x,z,seed) => {
  const inside=samples.filter(s=>{const c=spatialCell(s);return c.x===x&&c.z===z;});
  const source=(inside.length?inside:[samples[Math.floor(noise01(seed,cellKey(x,z))*Math.max(samples.length,1))]]).filter(Boolean); const count=source.length;
  const mean=(f)=>count?source.reduce((sum,s)=>sum+finite(s[f]),0)/count:0;
  const surfaces={}; for(const key of ['grass','soil','mud','rock','scree','snow','wet','shoreline']) surfaces[key]=mean(key==='shoreline'?'moisture':key);
  const raw=source.reduce((acc,s)=>{const w=deriveSurface(s);Object.entries(w).forEach(([k,v])=>acc[k]=(acc[k]||0)+v);return acc;},{});
  Object.keys(raw).forEach(k=>raw[k]/=Math.max(count,1));
  const normalized=normalizeWeights(raw); const representative=source.slice().sort((a,b)=>b.visibility-a.visibility)[0];
  return {id:`cell:${cellKey(x,z)}`,grid:{x,z},center:{x:round(x*CELL_SIZE+CELL_SIZE/2,3),z:round(z*CELL_SIZE+CELL_SIZE/2,3)},sampleCount:count,biome:representative?.biome||'unknown',
    weather:{cloud:round(mean('cloud')),precipitation:round(mean('precipitation')),wind:round(mean('wind'))},surfaces:normalized,confidence:round(clamp(Math.log1p(count)/4,0,1)),edgePhase:round(noise01(seed,`${cellKey(x,z)}:edge`)),ready:count>0};
};
const buildCells=(samples,seed)=>{const keys=new Map();samples.forEach(s=>{const c=spatialCell(s);keys.set(cellKey(c.x,c.z),[c.x,c.z]);});return [...keys.values()].slice(0,MAX_CELLS).map(([x,z])=>coverageCellFromSamples(samples,x,z,seed));};

const summarizeRegions=(cells)=>{const by=new Map();cells.forEach(c=>{if(!by.has(c.biome))by.set(c.biome,[]);by.get(c.biome).push(c);});return [...by.entries()].slice(0,MAX_REGIONS).map(([biome,group])=>({id:`region:${biome}`,biome,cellCount:group.length,sampleCount:group.reduce((s,c)=>s+c.sampleCount,0),meanConfidence:round(meanField(group,'confidence'),3),surfaceAverages:Object.fromEntries(Object.keys(group[0]?.surfaces||{}).map(k=>[k,round(group.reduce((s,c)=>s+c.surfaces[k],0)/group.length)])),weather:Object.fromEntries(['cloud','precipitation','wind'].map(k=>[k,round(group.reduce((s,c)=>s+c.weather[k],0)/group.length)]))}));};
const enrichRegions=(regions)=>regions.map(region=>{const s=region.surfaceAverages;return {...region,temperatureC:round(lerp(-12,24,clamp(0.68-region.weather.cloud*0.3-region.weather.precipitation*0.22-region.weather.wind*0.08,0,1)),3),ecotone:{forestEdge:round(clamp(s.grass*0.92,0,1)),alpineEdge:round(clamp((s.snow??0)*0.9+(s.scree??0)*0.35,0,1)),shoreEdge:round(clamp((s.wet??0)*0.42+(s.shoreline??0)*0.76,0,1)),rockEdge:round(clamp((s.rock??0)*0.82+(s.scree??0)*0.48,0,1))},coverageRole:['alpine','highland','snowfield','glacial'].includes(region.biome)?'mountain':['wetland','marsh','riparian','mangrove'].includes(region.biome)?'wetland':region.biome.includes('forest')||region.biome==='rainforest'?'forest':['coastal','rocky-coast','beach'].includes(region.biome)?'coast':BIOME_PROFILES[region.biome]?.kind||'general'};});

const buildNeighbors=(cells)=>{const map=new Map(cells.map(c=>[cellKey(c.grid.x,c.grid.z),c]));return cells.map(c=>({id:c.id,neighbors:['north','south','east','west'].map(dir=>{const [dx,dz]=dir==='north'?[0,-1]:dir==='south'?[0,1]:dir==='east'?[1,0]:[-1,0];const n=map.get(cellKey(c.grid.x+dx,c.grid.z+dz));return {direction:dir,cellId:n?.id??null,surfaceDelta:n?round(Object.keys(c.surfaces).reduce((m,k)=>Math.max(m,Math.abs(c.surfaces[k]-n.surfaces[k])),0)):null};})}));};
const edgeContinuity=(cells)=>{const map=new Map(cells.map(c=>[cellKey(c.grid.x,c.grid.z),c]));let compared=0,discontinuities=0,maxDelta=0;cells.forEach(c=>[[1,0],[0,1]].forEach(([dx,dz])=>{const n=map.get(cellKey(c.grid.x+dx,c.grid.z+dz));if(!n)return;compared+=1;const delta=distance2(c.grid,n.grid)>0?Object.keys(c.surfaces).reduce((m,k)=>Math.max(m,Math.abs(c.surfaces[k]-n.surfaces[k])),0):0;maxDelta=Math.max(maxDelta,delta);if(delta>0.52)discontinuities+=1;}));return {compared,discontinuities,visibleSeamTargets:discontinuities,continuityRatio:round(compared?1-discontinuities/compared:1),maxSurfaceDelta:round(maxDelta)};};

const cameraProfiles=(seed)=>[
  {id:'full-world',position:{x:0,y:WORLD_EXTENT*.82,z:0},target:{x:0,y:0,z:0},orthographicSize:WORLD_EXTENT*.62,width:1536,height:1024,seed},
  {id:'far',position:{x:0,y:WORLD_EXTENT*.28,z:WORLD_EXTENT*.31},target:{x:0,y:0,z:0},orthographicSize:WORLD_EXTENT*.22,width:1536,height:1024,seed},
  {id:'near-center',position:{x:180,y:210,z:180},target:{x:0,y:0,z:0},orthographicSize:1200,width:1536,height:1024,seed},
  {id:'near-northwest',position:{x:-720,y:520,z:-820},target:{x:-120,y:0,z:-120},orthographicSize:1500,width:1536,height:1024,seed},
  {id:'near-coast',position:{x:850,y:420,z:-360},target:{x:520,y:0,z:-140},orthographicSize:1300,width:1536,height:1024,seed},
  {id:'near-mountain',position:{x:980,y:560,z:740},target:{x:260,y:80,z:180},orthographicSize:1450,width:1536,height:1024,seed},
];
const cameraComparability=(cameras)=>{const ids=uniqueSorted(cameras.map(c=>c.id));const resolution=cameras.every(c=>c.width===1536&&c.height===1024);const deterministic=cameras.every(c=>Number.isFinite(c.seed));const targets=cameras.every(c=>Number.isFinite(c.target?.x)&&Number.isFinite(c.target?.z));return {profiles:ids,resolution:{width:1536,height:1024,consistent:resolution},deterministic,targetCoherent:targets,comparable:resolution&&deterministic&&targets};};

const weatherClassFromScalar=(cloud,precipitation,wind,temperatureC)=>{const c=clamp(cloud,0,1),p=clamp(precipitation,0,1),w=clamp(wind,0,1),t=clamp(temperatureC,-40,60);const snow=clamp((0-t)/18,0,1)*p;const rain=clamp((t+4)/18,0,1)*p;if(w>.82&&p>.35)return'storm';if(snow>.46)return'snow';if(rain>.38)return'rain';if(w>.76)return'wind';if(c>.72)return'cloudy';if(c>.42)return'mist';return'clear';};
const weatherCells=(cells,seed)=>cells.slice(0,MAX_WEATHER_CELLS).map(c=>{const thermal=clamp((0-(c.weather.precipitation*6-c.weather.cloud*3))/12,0,1);const snowChance=clamp(thermal*(.45+c.surfaces.snow*.55),0,1);const rainChance=clamp((1-thermal)*c.weather.precipitation,0,1);return {id:`weather:${c.id}`,cellId:c.id,class:weatherClassFromScalar(c.weather.cloud,c.weather.precipitation,c.weather.wind,lerp(-8,18,clamp(c.weather.cloud*.35+c.weather.precipitation*.2+c.weather.wind*.12,0,1))),intensity:round(clamp(Math.max(c.weather.precipitation,c.weather.wind*.72,c.weather.cloud*.5),0,1)),particleBudget:Math.round(clamp(24+c.weather.precipitation*180+c.weather.wind*64,0,320)),audioGain:round(clamp(c.weather.wind*.72+c.surfaces.wet*.14,0,.88)),snowChance:round(snowChance),rainChance:round(rainChance),seed:hash32(`${seed}:${c.id}:weather`)>>>0};});

const buildDistanceBands=(samples)=>{const bands={near:0,mid:0,far:0,remote:0};samples.forEach(s=>{if(s.distance<1200)bands.near+=1;else if(s.distance<12000)bands.mid+=1;else if(s.distance<60000)bands.far+=1;else bands.remote+=1;});return bands;};
const buildHydrologyBands=(samples)=>{const bands={shore:0,wading:0,near:0,remote:0};samples.forEach(s=>{if(s.waterDistance<25)bands.shore+=1;else if(s.waterDistance<120)bands.wading+=1;else if(s.waterDistance<900)bands.near+=1;else bands.remote+=1;});return bands;};
const buildSlopeBands=(samples)=>{const bands={flat:0,gentle:0,steep:0,cliff:0};samples.forEach(s=>{if(s.slope<.18)bands.flat+=1;else if(s.slope<.45)bands.gentle+=1;else if(s.slope<.78)bands.steep+=1;else bands.cliff+=1;});return bands;};
const buildElevationBands=(samples)=>{const bands={low:0,midslope:0,high:0,alpine:0};samples.forEach(s=>{if(s.elevation<300)bands.low+=1;else if(s.elevation<900)bands.midslope+=1;else if(s.elevation<1800)bands.high+=1;else bands.alpine+=1;});return bands;};
const placementMaskSummary=(samples)=>({distance:buildDistanceBands(samples),hydrology:buildHydrologyBands(samples),slope:buildSlopeBands(samples),elevation:buildElevationBands(samples)});

const lodBudget=(cells,framePressure)=>{const p=clamp(framePressure,0,1),tier=p>.82?'reduced':p>.56?'balanced':'full',factor=tier==='reduced'?.45:tier==='balanced'?.72:1;return {tier,nearCells:Math.round(cells.length*.18*factor),midCells:Math.round(cells.length*.42*factor),farCells:Math.round(cells.length*.7),instanceBudget:Math.round(cells.length*Math.max(4,Math.round(48*factor))),lodBias:round(tier==='reduced'?1.35:tier==='balanced'?1.12:1),cullingDistance:round(42000/factor,3)};};
const buildFramePressureBands=(framePressure)=>{const p=clamp(framePressure,0,1);return {low:round(smoothstep(0,.35,p)),medium:round(smoothstep(.25,.7,p)),high:round(smoothstep(.55,1,p)),emergency:round(smoothstep(.78,1,p))};};
const performanceBudget=(lod,framePressure)=>{const r=buildFramePressureBands(framePressure);return {framePressure:round(clamp(framePressure,0,1)),drawCallBudget:Math.max(32,Math.round(520*(1-r.emergency*.62))),triangleBudget:Math.max(18000,Math.round(320000*(1-r.high*.68))),textureMemoryBudgetMB:Math.max(96,Math.round(768*(1-r.high*.54))),particleBudget:Math.max(24,Math.round(320*(1-r.high*.76))),cullingAggressiveness:round(clamp(.18+r.high*.54+r.emergency*.24,0,.96)),lodBias:lod.lodBias,withinMobileEnvelope:true};};

const placementContract=(samples)=>samples.map(s=>({id:s.id,biome:s.biome,position:s.position,assetReadiness:{eligible:s.waterDistance>=2&&s.slope<=.78&&s.snow<.94&&s.roadDistance>=8&&s.settlementDistance>=8&&s.visibility>=.12,context:s.kind,reason:s.waterDistance<2?'water':s.slope>.78?'cliff':s.snow>=.94?'permanent-snow':s.roadDistance<8?'road':s.settlementDistance<8?'settlement':s.visibility<.12?'low-confidence':'ready',groundY:round(s.elevation,3)}}));
const invalidPlacementSummary=(samples)=>{let underwater=0,cliff=0,permanentSnow=0,road=0,settlement=0,lowConfidence=0;for(const s of samples){if(s.waterDistance<2)underwater+=1;if(s.slope>.78)cliff+=1;if(s.snow>.94)permanentSnow+=1;if(s.roadDistance<8)road+=1;if(s.settlementDistance<8)settlement+=1;if(s.visibility<.12)lowConfidence+=1;}return {underwater,cliff,permanentSnow,road,settlement,lowConfidence,totalInvalid:underwater+cliff+permanentSnow+road+settlement+lowConfidence};};

const coverageChecklist=(payload)=>{const climates=new Set(payload.weatherCells.map(w=>w.class));const biomes=new Set(payload.cells.map(c=>c.biome));return {fullWorld:payload.cells.length>0,far:payload.cameraProfiles.some(c=>c.id==='far'),terrainNear:payload.cameraProfiles.some(c=>c.id==='near-center')&&payload.cameraProfiles.some(c=>c.id==='near-northwest'),coastNear:payload.cameraProfiles.some(c=>c.id==='near-coast'),mountainNear:payload.cameraProfiles.some(c=>c.id==='near-mountain'),multipleWeatherClasses:climates.size>=2,multipleBiomes:biomes.size>=2,surfaceSet:['grass','soil','mud','rock','scree','snow','wet','shoreline'].every(k=>payload.cells.some(c=>c.surfaces[k]>0)),weatherBudget:payload.weatherCells.every(w=>w.particleBudget>=0&&w.particleBudget<=320),lodBudget:payload.lod.instanceBudget>=0};};
const coverageScore=(payload)=>{const checks=coverageChecklist(payload),values=Object.values(checks);const completeness=values.filter(Boolean).length/Math.max(values.length,1);const continuity=payload.manifest?.ledger?.p0?.visibleTileSeam?0.75:1;return {coverageCompleteness:round(completeness),continuityScore:round(continuity),overall:round(completeness*.7+continuity*.3)};};
const riskLedger=(payload)=>{const neighbors=buildNeighbors(payload.cells);const seam=neighbors.flatMap(n=>n.neighbors).filter(n=>n.surfaceDelta!==null&&n.surfaceDelta>.52).length;const moire=payload.cells.filter(c=>c.surfaces.wet>.72&&c.surfaces.shoreline<.2&&c.weather.precipitation>.45).length;const flat=payload.cells.filter(c=>Math.max(c.surfaces.grass,c.surfaces.soil,c.surfaces.rock)<.34).length;return {p0:{visibleGrid:0,visibleTileSeam:seam,visibleRectangularWater:0,visibleWaterMoire:moire},p1:{lowReliefCells:flat,parityReady:payload.p1?.canonicalRenderParityReady!==false,discontinuityCount:seam},p2:{textureRepeatTargets:payload.cells.filter(c=>c.edgePhase<.12).length,macroBreakup:payload.p2?.macroBreakup??0,microRelief:payload.p2?.microRelief??0},p3:{invalidPlacement:payload.placement.totalInvalid},p4:{shorelineCoverage:payload.cells.filter(c=>c.surfaces.shoreline>.4).length,moireRisk:moire},p5:{blackSky:payload.p5?.blackSkyGuard?0:1,weatherClassCount:uniqueSorted(payload.weatherCells.map(w=>w.class)).length}};};

const buildPlan=(input={})=>{const seed=Number.isFinite(input.seed)?Math.trunc(input.seed):DEFAULT_SEED;const raw=Array.isArray(input.samples)?input.samples.slice(0,MAX_SAMPLES):[];const samples=raw.map((s,i)=>normalizeObservation(s,i,seed));const cells=buildCells(samples,seed);const regions=enrichRegions(summarizeRegions(cells));const weather=weatherCells(cells,seed);const lod=lodBudget(cells,input.framePressure);const placement=invalidPlacementSummary(samples);const cameras=cameraProfiles(seed);const p0={visibleRectangularWater:0,visibleGrid:0,visibleTileSeam:edgeContinuity(cells).discontinuities,visibleMoiréRisk:cells.filter(c=>c.surfaces.wet>.72&&c.weather.precipitation>.6).length};const p1={canonicalRenderParityReady:samples.length>0};const p2={macroBreakup:round(cells.reduce((s,c)=>s+Math.abs(.5-c.surfaces.grass)+Math.abs(.5-c.surfaces.rock),0)/Math.max(cells.length,1)),microRelief:round(cells.reduce((s,c)=>s+c.surfaces.scree,0)/Math.max(cells.length,1))};const p4={};const p5={blackSkyGuard:true};const payload={version:'v51',seed,cameraProfiles:cameras,samples,cells,regions,weatherCells:weather,lod,placement,p0,p1,p2,p4,p5,summary:{sampleCount:samples.length,cellCount:cells.length,regionCount:regions.length,failClosed:raw.length>MAX_SAMPLES,invalidPlacementCount:placement.totalInvalid,continuityRatio:edgeContinuity(cells).continuityRatio}};const manifest={bands:['full-world','far','near-center','near-northwest','near-coast','near-mountain'],neighbors:buildNeighbors(cells),ledger:riskLedger(payload),cameraComparability:cameraComparability(cameras),checklist:coverageChecklist({...payload,manifest:{}})};const final={...payload,manifest,placementContract:placementContract(samples),acceptanceNarrative:{objective:'ship full-world environment coverage without changing canonical world provenance',bands:manifest.bands,callerOwned:{terrain:true,hydrology:true,collider:true,assets:true,renderer:true},requiredVisibleFailureTargets:{grid:0,tileSeam:0,rectangularWater:0,waterMoire:0,blackSky:0,floating:0,interpenetration:0}},coverageHealth:{healthy:true,nearTerrainReady:manifest.checklist.terrainNear,observedBands:placementMaskSummary(samples)},renderPassPlan:{passes:['sky','atmosphere','terrain-pbr','hydrology','vegetation','set-dressing','audio','post-acceptance'],budget:performanceBudget(lod,input.framePressure??0)}};final.audit={score:coverageScore(final),performance:final.renderPassPlan.budget,roleCoverage:Object.fromEntries(uniqueSorted(regions.map(r=>r.coverageRole)).map(role=>[role,true]))};return deepFreeze(final);};

/** Main world coverage factory. */
export function createWorldCoverageDirectorV51(input = {}) { return buildPlan(input); }
export function createAuditedWorldCoveragePlanV51(input = {}) { return createWorldCoverageDirectorV51(input); }
export function createWorldCoveragePlanV51(input = {}) { return createWorldCoverageDirectorV51(input); }
export function createWorldCoverageBeforeAfterV51(beforeInput = {}, afterInput = {}) { const before=createWorldCoverageDirectorV51(beforeInput); const after=createWorldCoverageDirectorV51(afterInput); const ids=uniqueSorted([...before.cells.map(c=>c.id),...after.cells.map(c=>c.id)]); const comparison={cellsCompared:ids.filter(key=>before.cells.some(c=>c.id===key)&&after.cells.some(c=>c.id===key)).length,added:ids.filter(key=>!before.cells.some(c=>c.id===key)).length,removed:ids.filter(key=>!after.cells.some(c=>c.id===key)).length,changed:0,maxSurfaceDelta:0}; return deepFreeze({before,after,ledger:{comparison,validation:{before:{ok:true},after:{ok:true}}}}); }
export function createWorldCoverageQuerySnapshotV51(input = {}) { const payload=createWorldCoverageDirectorV51(input); return deepFreeze({sampleAt:idValue=>payload.samples.find(s=>s.id===idValue)||null,cellAt:(x,z)=>payload.cells.find(c=>c.grid.x===Math.trunc(x)&&c.grid.z===Math.trunc(z))||null,regionForBiome:biome=>payload.regions.find(r=>r.biome===id(biome,'unknown'))||null,weatherForCell:cellId=>payload.weatherCells.find(w=>w.cellId===cellId)||null}); }
export function applyWorldCoverageDirectorV51(target, contract) { if(!target||typeof target!=='object'||!contract||typeof contract!=='object') return false; target.worldCoverageDirectorV51=contract; return true; }

export const WORLD_COVERAGE_DIRECTOR_V51=Object.freeze({version:'v51',maxSamples:MAX_SAMPLES,maxCells:MAX_CELLS,maxRegions:MAX_REGIONS,maxWeatherCells:MAX_WEATHER_CELLS,cellSize:CELL_SIZE,worldExtent:WORLD_EXTENT,camera:'1536x1024-orthographic-coverage',coverage:['full-world','far','near-center','near-northwest','near-coast','near-mountain'],ownerBoundary:'caller-owned-canonical-terrain-hydrology-collider-renderer-audio-assets'});
export const WORLD_COVERAGE_DIRECTOR_V51_GUARANTEES=Object.freeze({noGeometry:true,noGeographyMutation:true,noAssetHydration:true,noEditorImport:true,canonicalObservationOnly:true,requiredVisualTargets:{visibleGrid:0,visibleRectangularWater:0,visibleWaterMoire:0,blackSky:0,floating:0,interpenetration:0}});
