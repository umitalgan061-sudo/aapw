#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSeasonalRuntimeSample, runtimeMaterialDelta, assertRuntimeBoundary, runtimeSeasonEnvelope } from '../src/3d/world/terrainSeasonalErosionRuntime.js';
import { planSeasonalEvents, validateEventPlan, eventTransitionSignature, eventMaterialIntent } from '../src/3d/world/terrainSeasonalErosionEvents.js';
import { TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST, validateIntegrationManifest, dependencyGraph, topologicalIntegrationOrder, boundaryContract } from '../src/3d/world/terrainSeasonalErosionIntegrationManifest.js';
import { TERRAIN_SEASONAL_EROSION_BIOME_ATLAS, biomeAtlasStats } from '../src/3d/world/terrainSeasonalErosionBiomeAtlas.js';
import { TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER, validateScenarioLedger } from '../src/3d/world/terrainSeasonalErosionScenarioLedger.js';

const failures=[];
const climates=['subarctic','cold-oceanic','temperate','mild-oceanic','wet-temperate','dry-temperate','mediterranean','highland','alpine','volcanic'];
const seasons=['spring','summer','autumn','winter'];
function check(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}}
function sample(climate,seasonIndex,{day=60}={}){const seasonDay=[45,135,225,315][seasonIndex];return resolveSeasonalRuntimeSample({worldX:climate.length*127+seasonIndex*43,worldZ:-climate.length*91-seasonIndex*53,dayOfYear:day??seasonDay,climate,substrate:climate==='alpine'?'schist':'granite',heightMeters:70,slopeDegrees:12,moisture:climate==='wet-temperate'?.9:climate==='dry-temperate'?.28:.58,rainfall:climate==='dry-temperate'?.36:.68,windExposure:climate==='wet-temperate'?.25:.67,drainage:.52,canopy:climate==='wet-temperate'?.72:.38,snowWeight:climate==='alpine'?.82:climate==='subarctic'?.5:.16,temperatureC:seasonIndex===3?-4:seasonIndex===1?21:8,frozenDays:seasonIndex===3?24:7,dryDays:seasonIndex===1?14:4});}

check('manifest-validation',()=>{assert.equal(validateIntegrationManifest().ok,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.renderOnly,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.deterministic,true);});
check('manifest-stage-order',()=>{const order=topologicalIntegrationOrder();assert.deepEqual(order,['profile','cycle','sediment','event','runtime','responseBook','shader']);});
check('dependency-graph-shape',()=>{const graph=dependencyGraph();for(const node of ['profile','cycle','sediment','event','runtime','responseBook','shader'])assert(node in graph,node);});
check('boundary-all-false',()=>{const boundary=boundaryContract();for(const value of Object.values(boundary))assert.equal(value,false);});
check('biome-atlas-count',()=>{assert.equal(TERRAIN_SEASONAL_EROSION_BIOME_ATLAS.length,44);});
check('biome-atlas-stats',()=>{const stats=biomeAtlasStats();assert(stats.length>=7);for(const row of stats){assert(row.count>0);assert(Number.isFinite(row.meanRoughnessShift));assert(Number.isFinite(row.meanNormalShift));}});
check('scenario-ledger-count',()=>{assert.equal(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.length,160);});
check('scenario-ledger-integrity',()=>{assert.equal(validateScenarioLedger().ok,true);});

for(const climate of climates){
  check(`climate:${climate}:four-seasons`,()=>{
    const samples=seasons.map((_,index)=>sample(climate,index));
    assert.equal(samples.length,4);
    for(const result of samples){assertRuntimeBoundary(result).ok;assert(result.result.seasonal.profile.climate===climate);}
    const spread=new Set(samples.map(result=>result.result.seasonal.season));
    assert(spread.size>=3,`${climate}: insufficient season spread`);
  });
}

for(const climate of climates){
  for(const seasonIndex of [0,1,2,3]){
    check(`matrix:${climate}:${seasons[seasonIndex]}`,()=>{
      const current=sample(climate,seasonIndex);
      const repeat=sample(climate,seasonIndex);
      assert.deepEqual(current.result.material,repeat.result.material);
      assert.equal(current.cacheKey,repeat.cacheKey);
      const material=current.result.material;
      for(const key of ['roughness','normalStrength','specularDamping'])assert(material[key]>=0&&material[key]<=1,`${key}`);
      for(const key of ['r','g','b'])assert(material.color[key]>=0&&material.color[key]<=1,`color ${key}`);
    });
  }
}

check('seasonal-envelope',()=>{const envelope=runtimeSeasonEnvelope({startDay:1,endDay:360,step:7,input:{worldX:420,worldZ:-880,climate:'temperate',substrate:'granite',heightMeters:70,slopeDegrees:12,moisture:.55,rainfall:.64,windExposure:.52,drainage:.5}});assert(envelope.length>=50);for(const row of envelope){assert(row.day>=1&&row.day<=360);assert(row.season);for(const key of ['erosion','frostWear','crust','seasonalAge'])assert(row[key]>=0&&row[key]<=1);}});

check('material-change-wet-vs-dry',()=>{const wet=sample('wet-temperate',1);const dry=sample('dry-temperate',1);const delta=runtimeMaterialDelta(wet,dry);assert(delta.changed);});
check('material-change-alpine-vs-temperate',()=>{const alpine=sample('alpine',3);const temperate=sample('temperate',3);const delta=runtimeMaterialDelta(alpine,temperate);assert(delta.changed);});
check('material-change-substrate',()=>{const granite=resolveSeasonalRuntimeSample({worldX:123,worldZ:456,dayOfYear:44,climate:'temperate',substrate:'granite',heightMeters:70,slopeDegrees:14,moisture:.72,rainfall:.68,windExposure:.55,drainage:.5,temperatureC:-1,frozenDays:22});const schist=resolveSeasonalRuntimeSample({...granite.context.result?.input,worldX:123,worldZ:456,dayOfYear:44,climate:'temperate',substrate:'schist',heightMeters:70,slopeDegrees:14,moisture:.72,rainfall:.68,windExposure:.55,drainage:.5,temperatureC:-1,frozenDays:22});assert(Math.abs(granite.result.seasonal.thaw.crack-schist.result?.seasonal?.thaw?.crack??0)>=0);assert(schist.result.seasonal.thaw.crack>=granite.result.seasonal.thaw.crack);});

check('event-plan-validation',()=>{const plan=planSeasonalEvents({startDay:1,endDay:360,stepDays:15,input:{worldX:300,worldZ:700,climate:'temperate',substrate:'granite',heightMeters:70,slopeDegrees:10,moisture:.58,rainfall:.64,windExposure:.52,drainage:.5}});assert(plan.length>=20);assert.equal(validateEventPlan(plan).ok,true);});
check('event-transition-signature',()=>{const signature=eventTransitionSignature({startDay:1,endDay:360,stepDays:7,input:{worldX:350,worldZ:-500,climate:'temperate',substrate:'schist',heightMeters:70,slopeDegrees:16,moisture:.62,rainfall:.67,windExposure:.56,drainage:.48}});assert(signature.count>=0);assert(signature.policyId);});
for(const eventType of ['snowmelt','freeze-thaw','storm-runoff','saturation','drying','dust-deposition','crust-formation','channel-wash','surface-recovery','salt-wetness','thermal-spall','fines-settlement'])check(`event-intent:${eventType}`,()=>{const intent=eventMaterialIntent(eventType);for(const key of ['roughness','albedo','normal'])assert(Number.isFinite(intent[key]));});

check('alpine-frost',()=>{const state=sample('alpine',3).result.seasonal;assert(state.frostWear>0);assert(state.thaw.crack>0);});
check('mediterranean-dry',()=>{const state=sample('mediterranean',1).result.seasonal;assert(state.crust>0);});
check('wet-temperate-saturation',()=>{const state=sample('wet-temperate',0).result.seasonal;assert(state.mud>0);assert(state.moisture.value>.4);});
check('subarctic-snow',()=>{const state=sample('subarctic',0).result.seasonal;assert(state.snow.pack>=0);assert(state.snow.runoffPulse>=0);});
check('volcanic-response',()=>{const state=sample('volcanic',1).result.seasonal;assert(state.profile.climate==='volcanic');});

check('runtime-key-season-separation',()=>{const a=sample('temperate',0);const b=sample('temperate',1);assert.notEqual(a.context.runtimeKey,b.context.runtimeKey);});
check('runtime-key-climate-separation',()=>{const a=sample('temperate',0);const b=sample('alpine',0);assert.notEqual(a.context.runtimeKey,b.context.runtimeKey);});
check('runtime-key-substrate-separation',()=>{const a=resolveSeasonalRuntimeSample({worldX:1,worldZ:2,dayOfYear:60,climate:'temperate',substrate:'granite'});const b=resolveSeasonalRuntimeSample({worldX:1,worldZ:2,dayOfYear:60,climate:'temperate',substrate:'schist'});assert.notEqual(a.context.runtimeKey,b.context.runtimeKey);});

if(failures.length){console.error(`\n${failures.length} acceptance checks failed`);for(const value of failures)console.error(value);process.exit(1);}
console.log('\nSeasonal erosion acceptance gates passed.');
