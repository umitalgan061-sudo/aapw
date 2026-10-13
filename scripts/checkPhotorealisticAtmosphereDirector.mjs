import assert from 'node:assert/strict';
import { deriveAtmosphereWeatherProfile, validateAtmosphereWeatherProfile } from '../src/3d/world/photorealisticAtmosphereDirector.js';
const x = deriveAtmosphereWeatherProfile({ heightAboveSeaMeters: 760, moisture: 0.62, snowlineFactor: 0.76, cameraDistanceMeters: 1800 }, { cloudCover: 0.58, precipitation: 0.44, windStrength: 0.7, horizonWarmth: 0.34 });
assert.equal(validateAtmosphereWeatherProfile(x).valid, true);
assert.equal(x.cameraRelativeSky, true);
assert.equal(x.blackSkyGuard, true);
console.log(JSON.stringify({ policy: x.policyId, weatherClass: x.weatherClass }));
