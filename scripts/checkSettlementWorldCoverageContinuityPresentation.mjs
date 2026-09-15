import { strict as assert } from 'node:assert';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_API,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES,
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER,
  resolveSettlementWorldCoverageAtmosphere,
  resolveSettlementWorldCoverageTimePhase,
  validateSettlementWorldCoverageAtmosphere,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityAtmosphere.js';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_API,
  buildSettlementWorldCoverageSignage,
  chooseSettlementWorldCoveragePrimarySign,
  validateSettlementWorldCoverageSignage,
} from '../src/3d/gameplay/settlementWorldCoverageContinuitySignage.js';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_API,
  buildSettlementWorldCoverageRoadVisibilityBands,
  classifySettlementWorldCoverageRoad,
  scoreSettlementWorldCoverageRoadVisibility,
  validateSettlementWorldCoverageRoadVisibility,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityRoads.js';
import {
  SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_API,
  createSettlementWorldCoverageContinuityExperience,
  validateSettlementWorldCoverageContinuityExperience,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityExperience.js';

const settlement={id:'winterhold',regionId:'north_temperate_forest',anchor:{x:512,y:18,z:768},entrance:{x:520,y:18,z:768},services:['gate','market','tavern','blacksmith','farm','barracks','stable','house']};
const player={position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:100,copper:240,fatigue:35};
const surface={biome:'north-temperate',layer:'forest',moisture:.7,elevationMeters:300,slopeDegrees:5,roadDistanceMeters:14};
const weather={type:'clear',visibility:.95,intensity:.1,precipitation:0,wind:.2,wetness:.05};
const frozen=(value,label)=>{assert(Object.isFrozen(value),`${label} not frozen`);if(value&&typeof value==='object')for(const c of Object.values(value))if(c&&typeof c==='object')frozen(c,label);};

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_API.version,1);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES.length,8);
assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER.length,8);
for(const [hour,phase] of [[0,'pre-dawn'],[5,'dawn'],[8,'morning'],[12,'midday'],[16,'afternoon'],[19,'dusk'],[21,'evening'],[23.5,'night'],[24,'pre-dawn']])assert.equal(resolveSettlementWorldCoverageTimePhase(hour).phase,phase);
const dawn=resolveSettlementWorldCoverageTimePhase(5.5);assert.equal(dawn.phase,'dawn');assert.ok(dawn.progress>=0&&dawn.progress<=1);frozen(dawn,'dawn');
for(const type of SETTLEMENT_WORLD_COVERAGE_WEATHER){const atmosphere=resolveSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:18,weather:{type},context:surface,stage:'threshold'});assert.equal(atmosphere.weather.type,type);assert.ok(atmosphere.presentation.readability>=0&&atmosphere.presentation.readability<=1);assert.ok(atmosphere.presentation.ambientDensity>=0&&atmosphere.presentation.ambientDensity<=1);assert.ok(atmosphere.fingerprint);frozen(atmosphere,`atmosphere:${type}`);}
const atmosphere=resolveSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:13,weather,context:surface,stage:'threshold'});assert.equal(validateSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:13,weather,context:surface,stage:'threshold'}).ok,true);assert.equal(atmosphere.constraints.readOnly,true);assert.equal(atmosphere.constraints.noParticleCreation,true);
const storm=resolveSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:2,weather:{type:'storm',visibility:.2,intensity:1,wind:1},context:surface,stage:'far',mobile:false});const mobileStorm=resolveSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:2,weather:{type:'storm',visibility:.2,intensity:1,wind:1},context:surface,stage:'far',mobile:true});assert.ok(mobileStorm.presentation.ambientDensity<storm.presentation.ambientDensity);
const atmosphereRepeat=resolveSettlementWorldCoverageAtmosphere({settlementId:'winterhold',worldX:512,worldZ:768,seed:7,hour:13,weather,context:surface,stage:'threshold'});assert.equal(atmosphere.fingerprint,atmosphereRepeat.fingerprint);

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_SIGNAGE_API.serviceCount,8);
const thresholdSigns=buildSettlementWorldCoverageSignage({settlementId:'winterhold',stage:'threshold',gatewayState:'available',services:settlement.services,routeId:'north_gate',distanceMeters:28,atmosphere,serviceFocus:'market'});assert.ok(thresholdSigns.signCount>=8);assert.ok(thresholdSigns.readableCount>0);assert.equal(validateSettlementWorldCoverageSignage(thresholdSigns).ok,true);const primary=chooseSettlementWorldCoveragePrimarySign(thresholdSigns);assert.ok(primary);assert.ok(primary.visible);frozen(thresholdSigns,'thresholdSigns');
const farSigns=buildSettlementWorldCoverageSignage({settlementId:'winterhold',stage:'far',gatewayState:'blocked',services:settlement.services,routeId:'north_gate',distanceMeters:240,atmosphere:storm});assert.ok(farSigns.signCount>=1);assert.ok(farSigns.readableCount<=farSigns.signCount);
const resumeSigns=buildSettlementWorldCoverageSignage({settlementId:'winterhold',stage:'resume',gatewayState:'inside',services:settlement.services,routeId:'north_gate',distanceMeters:0,atmosphere,checkpoint:{settlementId:'winterhold',activeService:'house',sequence:8}});assert.ok(resumeSigns.signs.some((s)=>s.type==='checkpoint'));
const warningSigns=buildSettlementWorldCoverageSignage({settlementId:'winterhold',stage:'approach',gatewayState:'approach-only',services:settlement.services,routeId:'north_gate',distanceMeters:100,atmosphere:{...atmosphere,weather:{type:'fog',visibility:.2,intensity:.9,precipitation:0}}});assert.ok(warningSigns.signs.some((s)=>s.type==='warning'));

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_API.classes.length,6);
for(const roadClass of SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ROAD_API.classes){const road=classifySettlementWorldCoverageRoad({roadClass,roadDistanceMeters:30,slopeDegrees:5,surfaceLayer:'forest',isWater:false});assert.equal(road.roadClass,roadClass);assert.ok(road.baseBias>=0&&road.baseBias<=1);}
const clearRoad=scoreSettlementWorldCoverageRoadVisibility({settlementId:'winterhold',worldX:512,worldZ:768,seed:8,stage:'threshold',roadClass:'gateway',roadDistanceMeters:10,slopeDegrees:4,surfaceLayer:'forest',atmosphere,isWater:false});assert.ok(clearRoad.score>0);assert.equal(validateSettlementWorldCoverageRoadVisibility({settlementId:'winterhold',worldX:512,worldZ:768,seed:8,stage:'threshold',roadClass:'gateway',roadDistanceMeters:10,slopeDegrees:4,surfaceLayer:'forest',atmosphere}).ok,true);frozen(clearRoad,'clearRoad');
const snowRoad=scoreSettlementWorldCoverageRoadVisibility({settlementId:'winterhold',worldX:512,worldZ:768,seed:8,stage:'approach',roadClass:'local',roadDistanceMeters:110,slopeDegrees:25,surfaceLayer:'rock',atmosphere:{weather:{type:'snow',visibility:.6,wetness:.2},time:{phase:'dawn'}}});assert.ok(snowRoad.score<clearRoad.score);
const bands=buildSettlementWorldCoverageRoadVisibilityBands({stage:'threshold',distanceMeters:28});assert.equal(bands.length,4);assert.equal(bands.filter((band)=>band.active).length,1);frozen(bands,'bands');
const waterRoad=scoreSettlementWorldCoverageRoadVisibility({settlementId:'winterhold',worldX:512,worldZ:768,seed:8,stage:'threshold',roadClass:'crossing',roadDistanceMeters:8,slopeDegrees:2,surfaceLayer:'shoreline',isWater:true,atmosphere});assert.ok(waterRoad.score<clearRoad.score);

assert.equal(SETTLEMENT_WORLD_COVERAGE_CONTINUITY_EXPERIENCE_API.cueCap,8);
const experience=createSettlementWorldCoverageContinuityExperience({settlement,player,surface,regionId:settlement.regionId,seed:888,hour:13,weather,roadClass:'gateway',roadDistanceMeters:12});assert.equal(experience.stage,'threshold');assert.equal(experience.mode,'arrive');assert.equal(experience.gatewayState,'available');assert.ok(experience.recommendedService);assert.ok(experience.quickCues.length<=8);assert.ok(experience.readiness>=0&&experience.readiness<=1);assert.equal(experience.ownership.noTerrainMutation,true);assert.equal(experience.ownership.noRoadMutation,true);assert.equal(validateSettlementWorldCoverageContinuityExperience({settlement,player,surface,regionId:settlement.regionId,seed:888,hour:13,weather,roadClass:'gateway',roadDistanceMeters:12}).ok,true);frozen(experience,'experience');
const inside=createSettlementWorldCoverageContinuityExperience({settlement,player:{...player,position:settlement.anchor,inSettlement:true},surface,regionId:settlement.regionId,seed:888,hour:21,weather,roadClass:'local',roadDistanceMeters:5,checkpoint:{settlementId:'winterhold',activeService:'house',sequence:9}});assert.equal(inside.mode,'settle');assert.ok(inside.quickCues.some((cue)=>cue.type==='checkpoint'));
const mobile=createSettlementWorldCoverageContinuityExperience({settlement,player,surface,regionId:settlement.regionId,seed:888,hour:13,weather,roadClass:'gateway',roadDistanceMeters:12,mobile:true});assert.ok(mobile.atmosphere.presentation.ambientDensity<experience.atmosphere.presentation.ambientDensity);assert.ok(mobile.road.score<=experience.road.score);
const fogExperience=createSettlementWorldCoverageContinuityExperience({settlement,player,surface,regionId:settlement.regionId,seed:888,hour:2,weather:{type:'fog',visibility:.25,intensity:.85},roadClass:'gateway',roadDistanceMeters:18});assert.ok(fogExperience.atmosphere.presentation.readability<experience.atmosphere.presentation.readability);
for(const seed of [0,1,8,88,888]){const a=createSettlementWorldCoverageContinuityExperience({settlement,player,surface,regionId:settlement.regionId,seed,hour:13,weather,roadClass:'gateway',roadDistanceMeters:12});const b=createSettlementWorldCoverageContinuityExperience({settlement:JSON.parse(JSON.stringify(settlement)),player:JSON.parse(JSON.stringify(player)),surface:JSON.parse(JSON.stringify(surface)),regionId:settlement.regionId,seed,hour:13,weather:JSON.parse(JSON.stringify(weather)),roadClass:'gateway',roadDistanceMeters:12});assert.equal(a.fingerprint,b.fingerprint,`experience replay:${seed}`);}

console.log('Settlement World Coverage Continuity Presentation: PASS');
console.log(JSON.stringify({atmosphere:atmosphere.fingerprint,signage:thresholdSigns.fingerprint,road:clearRoad.fingerprint,experience:experience.fingerprint,weatherTypes:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER.length,timePhases:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES.length}));
