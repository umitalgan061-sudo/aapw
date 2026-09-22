/**
 * Buzul Muhafızı — deterministic environment photorealism director.
 *
 * This is a decision layer only. Terrain height/collider, water, vegetation,
 * asset placement and material assignment remain authoritative elsewhere.
 */
export type EnvironmentBiome = 'ocean'|'coast'|'river'|'wetland'|'grassland'|'forest'|'tundra'|'snow'|'rock'|'scree';
export type EnvironmentSurface = 'deep-water'|'shallow-water'|'wet-edge'|'grass'|'soil'|'mud'|'rock'|'scree'|'snow'|'road';

export interface EnvironmentSample {
  readonly worldX:number; readonly worldZ:number; readonly heightMeters:number;
  readonly waterLevelMeters:number; readonly slopeDegrees:number; readonly curvature:number;
  readonly moisture:number; readonly temperature:number; readonly rockWeight:number; readonly snowWeight:number;
  readonly waterDistanceMeters:number; readonly roadDistanceMeters:number; readonly settlementDistanceMeters:number;
  readonly forestDensity:number; readonly windward:number; readonly lee:number; readonly biomeHint?:EnvironmentBiome;
}
export interface PhotorealismFrame {
  readonly schemaVersion:1; readonly biome:EnvironmentBiome; readonly dominantSurface:EnvironmentSurface;
  readonly weights:Readonly<Record<EnvironmentSurface,number>>;
  readonly pbr:{albedo:readonly[number,number,number]; roughness:number; metalness:number; normalStrength:number; ao:number; clearcoat:number; transmission:number};
  readonly water:{depthClass:'dry'|'wet-edge'|'shallow'|'deep'; foam:number; roughness:number; normalScale:number; shorelineFade:number};
  readonly atmosphere:{fogDensity:number; aerialPerspective:number; sunEnergy:number; moonEnergy:number; skyLuminance:number; exposure:number};
  readonly vegetation:ReadonlyArray<{family:'canopy'|'understory'|'shrub'|'grass'|'reed'|'moss'; density:number; scaleMin:number; scaleMax:number; maxSlope:number}>;
  readonly antiTiling:{macroMeters:number; microMeters:number; triplanarBlend:number; phaseX:number; phaseZ:number};
  readonly placement:{allowTree:boolean; allowShrub:boolean; allowGrass:boolean; allowRock:boolean; allowScree:boolean; reasons:ReadonlyArray<string>};
  readonly performance:{targetFrameMs:number; maxDrawCalls:number; maxTriangles:number; maxTextureMb:number; lodBias:number; instanceBatchSize:number};
  readonly manifest:{placementAuthority:'WorldAssetPlacementPipeline.js'; materialAuthority:'MaterialAssignmentCore.js'; sourceAuthority:'canonical-world-terrain'; deterministicKey:string};
}
const c=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const s=(v:number)=>{const t=c(v);return t*t*(3-2*t)};
const l=(a:number,b:number,t:number)=>a+(b-a)*c(t);
const h=(x:number,z:number,seed:number)=>{const v=Math.sin((x+seed*.17)*127.1+(z-seed*.31)*311.7)*43758.5453;return v-Math.floor(v)};
const n3=(v:readonly[number,number,number])=>{const t=Math.max(1e-9,v[0]+v[1]+v[2]);return [v[0]/t,v[1]/t,v[2]/t] as const};
const mix=(a:readonly[number,number,number],b:readonly[number,number,number],t:number)=>[l(a[0],b[0],t),l(a[1],b[1],t),l(a[2],b[2],t)] as const;
const palette:Record<EnvironmentBiome,readonly[number,number,number]>={ocean:[.03,.08,.11],coast:[.28,.32,.23],river:[.06,.12,.14],wetland:[.22,.27,.16],grassland:[.34,.39,.24],forest:[.17,.22,.13],tundra:[.43,.44,.37],snow:[.78,.8,.76],rock:[.36,.37,.35],scree:[.29,.29,.27]};
function weights(x:EnvironmentSample):Readonly<Record<EnvironmentSurface,number>>{
  const depth=c((x.waterLevelMeters-x.heightMeters)/35); const shore=c(1-x.waterDistanceMeters/32); const steep=s(c((x.slopeDegrees-12)/38));
  const rock=c(Math.max(x.rockWeight,steep*.92)); const snow=c(Math.max(x.snowWeight,x.temperature<-2?(2-x.temperature)/18:0));
  const road=c(1-x.roadDistanceMeters/9); const mud=c(x.moisture*(1-depth)*(1-steep)); const deep=c(depth*(1-shore*.75));
  const shallow=c((1-depth)*shore*.9); const wet=c(shore*(1-deep)*(x.heightMeters<=x.waterLevelMeters?1:.45)); const scree=c(steep*(1-rock)*.65+rock*.35);
  const grass=c((1-x.moisture)*(1-rock)*(1-snow)*(1-road)); const soil=c((1-grass)*(1-rock)*(1-snow)*.75);
  const q=n3([deep,shallow,wet,grass,soil,mud,rock,scree,snow,road]);
  return Object.freeze({'deep-water':q[0],'shallow-water':q[1],'wet-edge':q[2],grass:q[3],soil:q[4],mud:q[5],rock:q[6],scree:q[7],snow:q[8],road:q[9]});
}
function biome(x:EnvironmentSample,w:Readonly<Record<EnvironmentSurface,number>>):EnvironmentBiome{
  if(x.biomeHint)return x.biomeHint; if(w['deep-water']>.45)return'ocean'; if(w['shallow-water']>.28)return x.waterDistanceMeters<6?'coast':'river'; if(w.snow>.48)return'snow'; if(w.rock>.38&&x.slopeDegrees>32)return'rock'; if(w.scree>.26)return'scree'; if(x.forestDensity>.54&&x.slopeDegrees<34)return'forest'; if(x.temperature<1)return'tundra'; if(x.moisture>.72)return'wetland'; return'grassland';
}
function dominant(w:Readonly<Record<EnvironmentSurface,number>>):EnvironmentSurface{return (Object.entries(w).sort((a,b)=>b[1]-a[1])[0]?.[0]??'grass') as EnvironmentSurface}
function buildPbr(x:EnvironmentSample,b:EnvironmentBiome,w:Readonly<Record<EnvironmentSurface,number>>,seed:number){
  const macro=h(x.worldX*.012,x.worldZ*.012,seed), micro=h(x.worldX*.15,x.worldZ*.15,seed+7), base=palette[b];
  const wet=mix(base,[.05,.08,.06],x.moisture*.48), snow=mix(wet,[.86,.87,.84],w.snow*.72), rock=mix(snow,[.34,.35,.34],w.rock*.55+w.scree*.25), v=.9+macro*.18+micro*.05;
  return Object.freeze({albedo:[c(rock[0]*v),c(rock[1]*v),c(rock[2]*v)] as const,roughness:c(l(.96,.34,w['deep-water']+w['shallow-water']*.65)+w.snow*.08,.18,.98),metalness:c(w.road*.08,0,.12),normalStrength:c(l(.42,1,w.rock+w.scree)+w['wet-edge']*.18,.25,1.35),ao:c(.7+x.curvature*.15-w.snow*.08,.32,.92),clearcoat:c(w['shallow-water']*.32+w['deep-water']*.18,0,.42),transmission:c(w['shallow-water']*.18,0,.25)});
}
function buildWater(x:EnvironmentSample,w:Readonly<Record<EnvironmentSurface,number>>){const deep=c((x.waterLevelMeters-x.heightMeters)/35),shore=c(1-x.waterDistanceMeters/24),foam=c(shore*(1-w['deep-water'])*.85);return Object.freeze({depthClass:w['deep-water']>.42?'deep':w['shallow-water']>.25?'shallow':shore>.16?'wet-edge':'dry' as const,foam,roughness:c(.18+shore*.22+x.windward*.08,.12,.72),normalScale:c(.22+(1-shore)*.22+x.lee*.05,.18,.52),shorelineFade:shore,depth:deep})}
function buildAtmosphere(x:EnvironmentSample,b:EnvironmentBiome){const altitude=c((x.heightMeters-x.waterLevelMeters)/1400), cold=c((2-x.temperature)/18);return Object.freeze({fogDensity:c(.00032+(1-altitude)*.00085+cold*.00022,.00022,.00165),aerialPerspective:c(.16+(1-altitude)*.33+(b==='ocean'?.12:0),.12,.78),sunEnergy:c(1.05-cold*.22,.62,1.18),moonEnergy:c(.12+cold*.1,.08,.34),skyLuminance:c(.66+altitude*.12-cold*.06,.42,.92),exposure:c(-.12+(b==='snow'?-0.08:0)+(b==='ocean'?.03:0),-.24,.14)})}
function buildVegetation(x:EnvironmentSample,b:EnvironmentBiome,w:Readonly<Record<EnvironmentSurface,number>>){const road=c((x.roadDistanceMeters-8)/18), seat=c((x.settlementDistanceMeters-90)/220), slope=c(1-x.slopeDegrees/40), water=c(x.waterDistanceMeters/8), forest=c(x.forestDensity), wet=c(x.moisture), bands:Array<PhotorealismFrame['vegetation'][number]>=[]; if(b==='forest'||(forest>.4&&w.grass>.08))bands.push({family:'canopy',density:c(forest*slope*road*seat*water),scaleMin:.85,scaleMax:1.35,maxSlope:33}); bands.push({family:'understory',density:c((.18+wet*.42)*slope*road*seat*water),scaleMin:.55,scaleMax:1.1,maxSlope:38}); bands.push({family:wet>.6?'reed':x.temperature<1?'moss':'grass',density:c((.22+w.grass*.9+wet*.22)*slope*road*seat),scaleMin:.7,scaleMax:1.2,maxSlope:42}); if(b==='coast'||b==='wetland')bands.push({family:'shrub',density:c((.18+wet*.25)*road*seat*slope),scaleMin:.45,scaleMax:.92,maxSlope:28}); return Object.freeze(bands)}
function buildPlacement(x:EnvironmentSample,b:EnvironmentBiome,w:Readonly<Record<EnvironmentSurface,number>>){const reasons:string[]=[];const allowTree=x.waterDistanceMeters>=3&&x.slopeDegrees<=34&&x.roadDistanceMeters>=10&&x.settlementDistanceMeters>=90&&w.snow<.96;const allowShrub=x.waterDistanceMeters>=.7&&x.slopeDegrees<=32&&x.roadDistanceMeters>=6;const allowGrass=x.slopeDegrees<=44&&x.roadDistanceMeters>=4&&w['deep-water']<.08;const allowRock=w.rock>.14||x.slopeDegrees>23;const allowScree=w.scree>.12&&x.slopeDegrees>18;if(!allowTree)reasons.push('tree-exclusion-mask');if(!allowShrub)reasons.push('shrub-exclusion-mask');if(!allowGrass)reasons.push('grass-exclusion-mask');if(!allowRock)reasons.push('rock-insufficient');if(!allowScree)reasons.push('scree-insufficient');if(b==='ocean')reasons.push('canonical-water-biome');return Object.freeze({allowTree,allowShrub,allowGrass,allowRock,allowScree,reasons:Object.freeze([...new Set(reasons)])})}
export function buildPhotorealismFrame(seed:number,x:EnvironmentSample):PhotorealismFrame{if(!Number.isFinite(seed))throw new Error('seed must be finite');const w=weights(x),b=biome(x,w),d=dominant(w),f:PhotorealismFrame={schemaVersion:1,biome:b,dominantSurface:d,weights:w,pbr:buildPbr(x,b,w,Math.trunc(seed)),water:buildWater(x,w),atmosphere:buildAtmosphere(x,b),vegetation:buildVegetation(x,b,w),antiTiling:Object.freeze({macroMeters:170+h(x.worldX*.002,x.worldZ*.002,seed)*90,microMeters:6.5+h(x.worldX*.04,x.worldZ*.04,seed+3)*4.5,triplanarBlend:c(.22+x.slopeDegrees/150,.22,.86),phaseX:Math.round((h(x.worldX*.004,x.worldZ*.004,seed+5)-.5)*160)/4,phaseZ:Math.round((h(x.worldX*.004,x.worldZ*.004,seed+9)-.5)*160)/4}),placement:buildPlacement(x,b,w),performance:Object.freeze({targetFrameMs:16.6,maxDrawCalls:b==='forest'?420:300,maxTriangles:b==='forest'?1200000:850000,maxTextureMb:b==='forest'?640:480,lodBias:c(.82+(b==='forest'?.12:0),.78,1.16),instanceBatchSize:b==='forest'?192:128}),manifest:Object.freeze({placementAuthority:'WorldAssetPlacementPipeline.js',materialAuthority:'MaterialAssignmentCore.js',sourceAuthority:'canonical-world-terrain',deterministicKey:`buzul|photorealism-v1|${Math.trunc(seed)}|${Math.round(x.worldX*4)/4}|${Math.round(x.worldZ*4)/4}|${b}|${d}`})};return Object.freeze(f)}
export function validatePhotorealismFrame(f:PhotorealismFrame):readonly string[]{const e:string[]=[];if(f.schemaVersion!==1)e.push('schema');if(f.manifest.placementAuthority!=='WorldAssetPlacementPipeline.js')e.push('placement-authority');if(f.manifest.materialAuthority!=='MaterialAssignmentCore.js')e.push('material-authority');if(f.placement.allowTree&&f.weights['deep-water']>.08)e.push('tree-on-water');if(f.placement.allowTree&&f.weights.rock>.85)e.push('tree-on-rock');if(f.pbr.roughness<0||f.pbr.roughness>1)e.push('roughness');if(f.water.foam<0||f.water.foam>1)e.push('foam');return Object.freeze(e)}
export function frameToMaterialRecipe(f:PhotorealismFrame){return Object.freeze({recipeVersion:1,surfaces:Object.freeze(Object.entries(f.weights).filter(([,v])=>v>.035).map(([k])=>k)),baseColor:f.pbr.albedo,roughness:f.pbr.roughness,metalness:f.pbr.metalness,normalStrength:f.pbr.normalStrength,ao:f.pbr.ao,clearcoat:f.pbr.clearcoat,transmission:f.pbr.transmission,antiTiling:f.antiTiling,provenance:f.manifest})}
export function placementQueryFromFrame(f:PhotorealismFrame){return Object.freeze({allowTree:f.placement.allowTree,allowShrub:f.placement.allowShrub,allowGrass:f.placement.allowGrass,allowRock:f.placement.allowRock,allowScree:f.placement.allowScree,speciesBands:f.vegetation,reasons:f.placement.reasons,provenance:f.manifest})}
export function environmentPhotorealismHealth(frames:readonly PhotorealismFrame[]){return Object.freeze({frameCount:frames.length,invalidCount:frames.reduce((n,f)=>n+validatePhotorealismFrame(f).length,0),sharedContractCoverage:frames.filter(f=>f.manifest.placementAuthority==='WorldAssetPlacementPipeline.js'&&f.manifest.materialAuthority==='MaterialAssignmentCore.js').length,treeOnWaterCount:frames.filter(f=>f.placement.allowTree&&f.weights['deep-water']>.08).length})}
