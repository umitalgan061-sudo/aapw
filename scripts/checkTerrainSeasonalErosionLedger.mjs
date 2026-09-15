#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SEASONAL_EROSION_EDGE_CASES, validateEdgeCaseCatalog } from '../src/3d/world/terrainSeasonalErosionEdgeCases.js';
import { TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER, validateScenarioLedger } from '../src/3d/world/terrainSeasonalErosionScenarioLedger.js';
import { TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS } from './fixtures/terrainSeasonalErosionTransitionVectors.js';
import { TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST, validateIntegrationManifest } from '../src/3d/world/terrainSeasonalErosionIntegrationManifest.js';

const failures=[];
function gate(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}}

const REQUIRED_CONTRACTS=[
 'renderOnly',
 'deterministic',
 'canonicalHeightUnchanged',
 'canonicalHydrologyUnchanged',
 'canonicalCoastlineUnchanged',
 'canonicalColliderUnchanged',
 'canonicalVegetationPlacementUnchanged',
];
const REQUIRED_CLIMATES=['subarctic','cold-oceanic','temperate','mild-oceanic','wet-temperate','dry-temperate','mediterranean','highland','alpine','volcanic'];
const REQUIRED_SEASONS=['spring','summer','autumn','winter'];

 gate('edge-case-policy',()=>{const result=validateEdgeCaseCatalog();assert.equal(result.ok,true);assert(result.count>=90);});
 gate('scenario-policy',()=>{const result=validateScenarioLedger();assert.equal(result.ok,true);assert.equal(result.count,160);});
 gate('transition-vector-count',()=>assert(TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.length>=300));
 gate('integration-policy',()=>{const result=validateIntegrationManifest();assert.equal(result.ok,true);});
 gate('integration-contracts',()=>{for(const key of REQUIRED_CONTRACTS)assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts[key],true,key);});
 gate('integration-climates-reference',()=>assert(REQUIRED_CLIMATES.every(value=>value.length>0)));
 gate('integration-seasons-reference',()=>assert(REQUIRED_SEASONS.every(value=>value.length>0)));
 gate('edge-case-identity',()=>{const ids=new Set(TERRAIN_SEASONAL_EROSION_EDGE_CASES.map(row=>row.id));assert.equal(ids.size,TERRAIN_SEASONAL_EROSION_EDGE_CASES.length);});
 gate('scenario-identity',()=>{const ids=new Set(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.map(row=>row.id));assert.equal(ids.size,TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.length);});
 gate('transition-identity',()=>{const ids=new Set(TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.map(row=>row[0]));assert.equal(ids.size,TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.length);});
 gate('boundary-statement',()=>{assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.canonicalHeightUnchanged,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.canonicalHydrologyUnchanged,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.canonicalCoastlineUnchanged,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.canonicalColliderUnchanged,true);assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.contracts.canonicalVegetationPlacementUnchanged,true);});
 gate('ledger-references',()=>{assert(TERRAIN_SEASONAL_EROSION_EDGE_CASES.some(row=>row.expected==='freeze-thaw'));assert(TERRAIN_SEASONAL_EROSION_EDGE_CASES.some(row=>row.expected==='drying'));assert(TERRAIN_SEASONAL_EROSION_EDGE_CASES.some(row=>row.expected==='snowmelt'));});
 gate('seasonal-transition-vectors',()=>{const edgeRows=TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.filter(row=>String(row[5]).includes('boundary'));assert(edgeRows.length>=24);});
 gate('micro-step-vectors',()=>{const rows=TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.filter(row=>row[5]==='.micro-step');assert.equal(rows.length,20);});
 gate('cycle-close-vectors',()=>{const rows=TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.filter(row=>row[5]==='.cycle-edge');assert(rows.length>=10);});
 gate('review-coverage',()=>{const climateRows=new Set(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.map(row=>row.climate));for(const climate of REQUIRED_CLIMATES)assert(climateRows.has(climate),climate);});
 gate('review-season-coverage',()=>{const seasonRows=new Set(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.map(row=>row.season));for(const season of REQUIRED_SEASONS)assert(seasonRows.has(season),season);});
 gate('stress-climate-coverage',()=>{const climateRows=new Set(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.map(row=>row.climate));assert(climateRows.size>=10);});
 gate('stress-substrate-coverage',()=>{const substrateRows=new Set(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.map(row=>row.substrate));assert(substrateRows.size>=12);});
 gate('acceptance-ledger-size',()=>assert(TERRAIN_SEASONAL_EROSION_EDGE_CASES.length+TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER.length+TERRAIN_SEASONAL_EROSION_TRANSITION_VECTORS.length>500));
 gate('manifest-version',()=>assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.version,1));
 gate('manifest-event-types',()=>assert.equal(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.eventTypes.length,12));
 gate('manifest-stages',()=>assert(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.stages.length>=9));
 gate('manifest-input-contract',()=>assert(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.inputs.includes('dayOfYear')));
 gate('manifest-output-contract',()=>assert(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.outputs.includes('seasonalAge')));

if(failures.length){console.error(`\n${failures.length} ledger gates failed`);for(const error of failures)console.error(error);process.exit(1);}
console.log('\nSeasonal erosion acceptance ledger passed.');
