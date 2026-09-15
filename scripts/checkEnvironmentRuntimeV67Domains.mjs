import assert from 'node:assert/strict';
import { buildHydrologyFieldV67, validateHydrologyV67 } from '../src/3d/world/environmentRuntimeHydrologyV67.js';
import { buildWeatherFieldV67, validateWeatherV67, forecastWeatherV67 } from '../src/3d/world/environmentRuntimeWeatherV67.js';
import { buildSurfaceFieldV67, validateSurfaceV67 } from '../src/3d/world/environmentRuntimeSurfaceV67.js';
import { buildAtmosphereFieldV67, validateAtmosphereV67 } from '../src/3d/world/environmentRuntimeAtmosphereV67.js';
import { buildWildlifeFieldV67, validateWildlifeV67 } from '../src/3d/world/environmentRuntimeWildlifeV67.js';
import { buildHazardFieldV67, validateHazardsV67 } from '../src/3d/world/environmentRuntimeHazardsV67.js';
import { buildNavigationFieldV67, validateNavigationV67 } from '../src/3d/world/environmentRuntimeNavigationV67.js';
import { buildVegetationFieldV67, validateVegetationV67 } from '../src/3d/world/environmentRuntimeVegetationV67.js';
import { buildClimateFieldV67, validateClimateV67 } from '../src/3d/world/environmentRuntimeClimateV67.js';
import { buildAcousticFieldV67, validateAcousticsV67 } from '../src/3d/world/environmentRuntimeAcousticsV67.js';
import { buildResonanceFieldV67, validateResonanceV67 } from '../src/3d/world/environmentRuntimeResonanceV67.js';
import { buildContinuityFieldV67, validateContinuityV67 } from '../src/3d/world/environmentRuntimeContinuityV67.js';
import { buildShelterFieldV67, validateShelterV67 } from '../src/3d/world/environmentRuntimeShelterV67.js';
import { buildVisibilityFieldV67, validateVisibilityV67 } from '../src/3d/world/environmentRuntimeVisibilityV67.js';
import { buildCouplingFieldV67, validateCouplingV67 } from '../src/3d/world/environmentRuntimeWeatherCouplingV67.js';
import { synthesizeEnvironmentEventsV67, validateEventsV67 } from '../src/3d/world/environmentRuntimeEventsV67.js';
import { buildGeologyFieldV67, validateGeologyV67 } from '../src/3d/world/environmentRuntimeGeologyV67.js';

const samples=Array.from({length:14},(_,i)=>({
  id:`domain-${i}`,
  elevation:250+i*90,
  slope:5+i*5,
  moisture:.28+(i%5)*.13,
  temperature:-2+(i%8)*4.2,
  humidity:.46+(i%4)*.1,
  wind:5+i*1.7,
  visibility:.3+(i%7)*.1,
  rain:.08+(i%6)*.12,
  canopy:.14+(i%6)*.13,
  waterDistance:15+i*24,
  humanPressure:i%5===0?.72:.14,
  biome:['forest','temperate','grassland','taiga'][i%4],
}));

const hydrology=buildHydrologyFieldV67(samples);
const weather=buildWeatherFieldV67(samples,'domain-seed');
const surface=buildSurfaceFieldV67(samples);
const atmosphere=buildAtmosphereFieldV67(samples);
const wildlife=buildWildlifeFieldV67(samples);
const hazards=buildHazardFieldV67(samples);
const navigation=buildNavigationFieldV67(samples.map((s,i)=>({...s,hazard:hazards[i].risk,traction:surface[i].traction})));
const vegetation=buildVegetationFieldV67(samples,175);
const climate=buildClimateFieldV67(samples,175);
const acoustics=buildAcousticFieldV67(samples);
const resonance=buildResonanceFieldV67(samples);
const continuity=buildContinuityFieldV67(samples);
const shelter=buildShelterFieldV67(samples);
const visibility=buildVisibilityFieldV67(samples);
const coupling=buildCouplingFieldV67(samples,{precipitation:.3});
const events=synthesizeEnvironmentEventsV67(samples,{dayOfYear:175,seed:'domain-seed'});
const geology=buildGeologyFieldV67(samples);

assert.equal(validateHydrologyV67(hydrology).ok,true);
assert.equal(validateWeatherV67(weather).ok,true);
assert.equal(validateSurfaceV67(surface).ok,true);
assert.equal(validateAtmosphereV67(atmosphere).ok,true);
assert.equal(validateWildlifeV67(wildlife).ok,true);
assert.equal(validateHazardsV67(hazards).ok,true);
assert.equal(validateNavigationV67(navigation).ok,true);
assert.equal(validateVegetationV67(vegetation).ok,true);
assert.equal(validateClimateV67(climate).ok,true);
assert.equal(validateAcousticsV67(acoustics).ok,true);
assert.equal(validateResonanceV67(resonance).ok,true);
assert.equal(validateContinuityV67(continuity).ok,true);
assert.equal(validateShelterV67(shelter).ok,true);
assert.equal(validateVisibilityV67(visibility).ok,true);
assert.equal(validateCouplingV67(coupling).ok,true);
assert.equal(validateEventsV67(events).ok,true);
assert.equal(validateGeologyV67(geology).ok,true);
assert.equal(hydrology.length,14);
assert.equal(weather.length,14);
assert.equal(surface.length,14);
assert.equal(atmosphere.length,14);
assert.equal(wildlife.length,14);
assert.equal(hazards.length,14);
assert.equal(navigation.length,14);
assert.equal(vegetation.length,14);
assert.equal(climate.length,14);
assert.equal(acoustics.length,14);
assert.equal(resonance.length,14);
assert.equal(continuity.length,13);
assert.equal(shelter.length,14);
assert.equal(visibility.length,14);
assert.equal(coupling.length,14);
assert.ok(events.activeCount>=0);
assert.equal(geology.length,14);
assert.equal(forecastWeatherV67({samples,seed:'domain-seed',horizon:4}).length,4);
console.log('V67 domain regression PASS');
