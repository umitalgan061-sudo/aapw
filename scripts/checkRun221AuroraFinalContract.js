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
const v4Call = sky.indexOf('applyAuroraRayCurtainV4(material);');
const v5Call = sky.indexOf('applyAuroraNightAtmosphereV5(material);');
assert(v4Call >= 0 && v5Call > v4Call, 'V5 must be the final atmospheric layer after V4 curtain installation.');
assert(v4.includes('patchMask'), 'V4 must use compile-safe patchMask identifier.');
assert(!/\bfloat\s+patch\b/.test(v4), 'V4 must not reintroduce reserved GLSL variable `patch`.');
assert(v4.includes('ray4VerticalField'), 'V4 vertical ray field missing.');
assert(v4.includes('ray4ArcEdge'), 'V4 irregular arc edge missing.');
assert(v4.includes('secondary') && v4.includes('* 0.24'), 'V4 restrained secondary curtain contract missing.');
assert(v4.includes('oxygenGreen') && v4.includes('subduedViolet'), 'V4 natural aurora palette contract missing.');
assert(v5.includes('vec3(0.050, 0.092, 0.165)'), 'V5 brighter deep-blue horizon floor missing.');
assert(v5.includes('vec3(0.009, 0.020, 0.052)'), 'V5 brighter deep-blue zenith floor missing.');
assert(night.includes('NIGHT_CINEMATIC_FULL_INTENSITY = 0.72'), 'Gameplay night cinematic fill target drifted.');
assert(lighting.includes('updateNightVisualEnhancement(lights.hemisphere, nightFactor);'), 'Gameplay night enhancement is not driven by canonical nightFactor.');

for (const file of [
	'./src/3d/auroraRealism.js',
	'./src/3d/nightVisualEnhancement.js',
	'./src/3d/auroraRayCurtainV4.js',
	'./src/3d/auroraNightAtmosphereV5.js',
]) {
	assert(sw.includes(`GAME3D_SHELL_FILES.push('${file}');`), `PWA offline shell missing ${file}`);
}

console.log('[checkRun221AuroraFinalContract] PASS: V4 irregular ray curtains + V5 brighter night atmosphere + canonical night-factor lighting + offline PWA cache are locked.');
