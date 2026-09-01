#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const sky = read('src/3d/sky.js');
const v4 = read('src/3d/auroraRayCurtainV4.js');
const v5 = read('src/3d/auroraNightAtmosphereV5.js');
const night = read('src/3d/nightVisualEnhancement.js');
const lighting = read('src/3d/lighting.js');
const sw = read('service-worker.js');

assert(sky.includes("import { applyAuroraRayCurtainV4 } from './auroraRayCurtainV4.js';"), 'sky.js must import V4 ray curtains.');
assert(sky.includes("import { applyAuroraNightAtmosphereV5 } from './auroraNightAtmosphereV5.js';"), 'sky.js must import V5 atmosphere calibration.');
assert(!sky.includes('applyRealisticAuroraMaterial(') && !sky.includes('applyNaturalAuroraRefinement(') && !sky.includes('applyAuroraCurtainRaysV3('),
	'sky.js must not run superseded shader stages that V4 immediately overwrites.');
const v4Call = sky.indexOf('applyAuroraRayCurtainV4(material);');
const v5Call = sky.indexOf('applyAuroraNightAtmosphereV5(material);');
assert(v4Call >= 0 && v5Call > v4Call, 'V5 must be the final calibration after V4 curtain installation.');
assert(sky.includes('vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;'),
	'camera-follow sky must pass true world position before fragment camera subtraction.');
assert(sky.includes('finalShaderConsumesProfile: true'), 'sky atmosphere policy must declare final-shader ownership.');

for (const token of [
	'patchMask',
	'ray4VerticalField',
	'ray4ArcEdge',
	'ray4CurtainEnvelope',
	'ray4RaySheet',
	'ray4HorizonAirmassVariation',
	'ray4UpperAirVariation',
	'ray4AtmosphericBase',
	'uHorizonHazeStrength',
	'uHorizonVariationStrength',
	'uGroundBounceStrength',
	'uUpperAirStrength',
	'uUpperAirVariationStrength',
	'uBandingDitherStrength',
	"finalAtmosphereProfile = 'camera-relative-horizon-upper-air-v6'",
	"auroraCurtainMorphology = 'broken-asymmetric-ray-sheets-v8-visible-gaps'",
]) assert(v4.includes(token), `V4 final atmosphere/morphology token missing: ${token}`);
assert(!/\bfloat\s+patch\b/.test(v4), 'V4 must not reintroduce reserved GLSL variable `patch`.');
assert(v4.includes('return mix(0.18, 1.0, opening);'), 'V4 dim-gap floor contract missing.');
assert(v4.includes('float quietColumns = 0.14 + raySheet * 0.86;'), 'V4 ray-sheet floor contract missing.');
assert(v4.includes('secondary') && v4.includes('* 0.24'), 'V4 restrained secondary curtain contract missing.');
assert(v4.includes('oxygenGreen') && v4.includes('subduedViolet'), 'V4 natural aurora palette contract missing.');

assert(v5.includes('function replaceRequired('), 'V5 must fail loudly when a required V4 token is missing.');
assert(v5.includes('required V4 token missing'), 'V5 required-token error contract missing.');
assert(v5.includes('vec3(0.050, 0.092, 0.165)'), 'V5 brighter deep-blue horizon floor missing.');
assert(v5.includes('vec3(0.009, 0.020, 0.052)'), 'V5 brighter deep-blue zenith floor missing.');
assert(v5.includes("'finalColor += oxygenGreen * haze * 0.078;'"), 'V5 must target the current V4 haze token.');
assert(v5.includes("'finalColor += oxygenGreen * haze * 0.084;'"), 'V5 calibrated haze output missing.');
assert(v5.includes("auroraNightCalibration = 'required-token-deep-blue-v6'"), 'V5 calibration marker missing.');
assert(night.includes('NIGHT_CINEMATIC_FULL_INTENSITY = 0.72'), 'Gameplay night cinematic fill target drifted.');
assert(lighting.includes('updateNightVisualEnhancement(lights.hemisphere, nightFactor);'), 'Gameplay night enhancement is not driven by canonical nightFactor.');

for (const file of [
	'./src/3d/auroraRayCurtainV4.js',
	'./src/3d/auroraNightAtmosphereV5.js',
	'./src/3d/nightVisualEnhancement.js',
]) {
	assert(sw.includes(`GAME3D_SHELL_FILES.push('${file}');`), `PWA offline shell missing ${file}`);
}

console.log('[checkRun221AuroraFinalContract] PASS: final V4 consumes camera-relative atmosphere with visible broken ray sheets; V5 required-token night calibration, world-direction anchoring and offline PWA dependencies are locked.');
