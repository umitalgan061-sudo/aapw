import assert from 'node:assert/strict';
import { deriveAtmosphereWeatherProfile } from '../src/3d/world/photorealisticAtmosphereDirector.js';
import { applyAtmosphereWeatherProfile, validateAtmosphereWeatherApplication } from '../src/3d/world/atmosphereWeatherRuntimeAdapter.js';

const scene = { fog: { density: 0, near: 0, far: 0 }, userData: {} };
const renderer = { toneMappingExposure: 1 };
const profile = deriveAtmosphereWeatherProfile(
  { heightAboveSeaMeters: 760, moisture: 0.62, snowlineFactor: 0.76, cameraDistanceMeters: 1800 },
  { cloudCover: 0.58, precipitation: 0.44, windStrength: 0.7, horizonWarmth: 0.34 },
);
const result = applyAtmosphereWeatherProfile({ scene, renderer }, profile);
assert.equal(validateAtmosphereWeatherApplication(result).valid, true);
assert.equal(result.applied, true);
assert.equal(scene.fog.density, profile.fogDensity);
assert.equal(scene.userData.atmosphereWeather.cameraRelativeSky, true);
assert.equal(renderer.toneMappingExposure, result.toneMappingExposure);
assert.equal(result.canonicalMutation, false);
console.log(JSON.stringify({ applied: result.applied, exposure: result.toneMappingExposure }));
