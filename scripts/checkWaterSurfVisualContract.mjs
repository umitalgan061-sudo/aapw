#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/world/water.js'), 'utf8');
const configSource = fs.readFileSync(path.join(ROOT, 'src/3d/config.js'), 'utf8');
const fail = (message) => { throw new Error(`[checkWaterSurfVisualContract] ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const numberFrom = (text, pattern, label) => {
	const match = text.match(pattern);
	need(match, `${label} missing or unparsable`);
	return Number(match[1]);
};
const requirePattern = (pattern, message) => need(pattern.test(source), message);

need(!/smoothstep\(\s*0\.22\s*,\s*0\.0\s*,\s*(?:vDepthFactor|fragmentDepth)\s*\)/.test(source), 'reversed-edge GLSL smoothstep returned');
requirePattern(/float\s+shallowMask\s*=\s*1\.0\s*-\s*smoothstep\(\s*0\.0\s*,\s*0\.22\s*,\s*fragmentDepth\s*\)\s*;/, 'defined inverse shallow-depth mask missing or surf envelope drifted');
requirePattern(/shallowMask\s*\*=\s*shorelineGradientMask\(\s*vWorldPosition\.xz\s*\)\s*\*\s*waterCoverage\s*;/, 'surf must require a real bathymetry shoreline gradient and canonical water coverage');
requirePattern(/float\s+foam\s*=\s*clamp\(\s*shallowMask\s*\*\s*surge\s*,\s*0\.0\s*,\s*1\.0\s*\)\s*;/, 'foam must remain shoreline/depth gated');
requirePattern(/1\.0\s*-\s*smoothstep\(\s*90\.0\s*,\s*360\.0\s*,\s*distance\(\s*uCameraPosition\s*,\s*vWorldPosition\s*\)\s*\)/, 'fine ripple near-field anti-moire fade drifted');
requirePattern(/float\s+swellShadingFade\s*=\s*1\.0\s*-\s*smoothstep\(\s*700\.0\s*,\s*1800\.0\s*,\s*distance\(\s*uCameraPosition\s*,\s*vWorldPosition\s*\)\s*\)\s*;/, 'long-swell normal must fade before far/orthographic views can resolve stripe bands');
requirePattern(/swellSlope\s*\*\s*swellShadingFade\s*\+\s*rippleSlope\(\s*vWorldPosition\.xz\s*,\s*uTime\s*\)\s*\*\s*rippleFade/, 'water normal must apply the independent swell and ripple distance fades');
// Run 389: the swell slope must be evaluated per fragment. Interpolating it from the vertices (the
// old `varying vec2 vSwellSlope`) made the shading normal piecewise-linear across 12.5 m quads, so
// the sea broke into flat polygonal facets. Only the scalar envelope may be a varying.
requirePattern(/vec2\s+swellSlope\s*=\s*swellAt\(\s*vWorldPosition\.xz\s*,\s*uTime\s*\)\.yz\s*\*\s*vAmplitudeScale\s*;/, 'swell slope must be evaluated per fragment, not interpolated from vertices');
need(!/varying\s+vec2\s+vSwellSlope\s*;/.test(source), 'per-vertex swell slope varying returned; shading normal would facet across quads again');
requirePattern(/smoothstep\(\s*1500\.0\s*,\s*1950\.0\s*,\s*localEdgeDistance\s*\)/, 'near swell must blend to zero before the dense mesh edge');
requirePattern(/new\s+THREE\.PlaneGeometry\(\s*WATER_FULL_WORLD_EXTENT_METERS\s*,\s*WATER_FULL_WORLD_EXTENT_METERS\s*,\s*1\s*,\s*1\s*\)/, 'two-triangle full-world far-water coverage missing');
// Run 388 widened this field from vec2 to vec3: .z now carries baked optical depth so the body
// colour can be a real per-channel Beer-Lambert extinction rather than a depth-factor lerp. The
// contract is still "one canonical field sampled per fragment", so it pins the third channel too
// instead of merely tolerating the wider type.
requirePattern(/vec3\s+waterField\s*=\s*sampleWaterField\(\s*vWorldPosition\.xz\s*\)\s*;/, 'far water must sample canonical depth, wet/dry coverage and optical depth per fragment');
requirePattern(/float\s+opticalDepthMeters\s*=\s*waterField\.z\s*\*\s*uFullOpticalDepthMeters\s*;/, 'optical depth channel must be decoded into metres');
requirePattern(/vec3\s+transmittance\s*=\s*exp\(\s*-extinctionPerMeter\s*\*\s*opticalDepthMeters\s*\)\s*;/, 'water body colour must come from per-channel Beer-Lambert extinction');
// Run 392: the coefficient varies with latitude, so a polar sea reads grey-green instead of the same
// turquoise as Dorne. Pinned so the north cannot silently revert to one global coefficient, and so the
// cold-water band stays tied to the snow line's own latitude numbers.
requirePattern(/vec3\s+extinctionPerMeter\s*=\s*mix\(\s*uExtinctionPerMeter\s*,\s*uPolarExtinctionPerMeter\s*,\s*polar\s*\)\s*;/, 'polar extinction must blend in by latitude');
requirePattern(/float\s+polar\s*=\s*1\.0\s*-\s*smoothstep\(\s*\$\{glslFloat\(POLAR_FULL_NY\)\}\s*,\s*\$\{glslFloat\(POLAR_FADE_NY\)\}\s*,\s*mapLatitude\s*\)\s*;/, 'the cold-water band must be driven by the POLAR_*_NY constants, formatted as GLSL floats');
// Every number interpolated into GLSL must go through glslFloat: a whole number emits an int literal
// and `float / int` does not compile, which renders the water invisible rather than wrong. Found by
// the swell gate's GPU read-back (0.00% pixels changed); the source-only contracts all passed.
need(!/\$\{MAP_LATITUDE_[A-Z_]+\}/.test(source), 'raw latitude constant interpolated into GLSL without glslFloat');
// Assert the two modules actually agree rather than that a number appears: the snow line and the
// cold-water line must begin at the same latitude, or the shore carries ice with tropical water
// lapping at it. Compared numerically against terrain.js's own NORTHERN_SNOW.
const terrainSource = fs.readFileSync(path.join(ROOT, 'src/3d/world/terrain.js'), 'utf8');
const snowBand = terrainSource.match(/NORTHERN_SNOW\s*=\s*Object\.freeze\(\{\s*fullNy:\s*([0-9.]+)\s*,\s*fadeNy:\s*([0-9.]+)/);
need(snowBand, 'terrain.js NORTHERN_SNOW missing or unparsable');
const latitudeSource = fs.readFileSync(path.join(ROOT, 'src/3d/world/waterLatitude.js'), 'utf8');
const waterFullNy = numberFrom(latitudeSource, /const\s+POLAR_FULL_NY\s*=\s*([0-9.]+)\s*;/, 'water POLAR_FULL_NY');
const waterFadeNy = numberFrom(latitudeSource, /const\s+POLAR_FADE_NY\s*=\s*([0-9.]+)\s*;/, 'water POLAR_FADE_NY');
need(
	waterFullNy === Number(snowBand[1]) && waterFadeNy === Number(snowBand[2]),
	`cold-water band (${waterFullNy}, ${waterFadeNy}) has drifted from terrain.js NORTHERN_SNOW (${snowBand[1]}, ${snowBand[2]})`,
);
requirePattern(/float\s+waterCoverage\s*=\s*smoothstep\(\s*0\.08\s*,\s*0\.72\s*,\s*waterField\.y\s*\)\s*;/, 'canonical wet/dry coverage shoreline fade drifted');
requirePattern(/if\s*\(\s*waterCoverage\s*<=\s*0\.01\s*\)\s*discard\s*;/, 'dry-land fragment discard missing');
requirePattern(/alpha\s*\*=\s*waterCoverage\s*;/, 'shoreline opacity must remain coverage-bounded');

// A backtick inside a GLSL template literal silently ends the template, and the resulting file still
// passes `node --check` because the backticks stay balanced -- it only fails in the browser, with an
// error naming whatever identifier followed. That cost a debugging round in run 388 and again in 392,
// both times from writing a module name in backticks inside a shader comment. Cheaper to forbid it.
{
	let inGlsl = false;
	source.split('\n').forEach((line, index) => {
		const opens = line.includes('/* glsl */ `');
		const closes = line.trim() === '`;';
		// Scoped to GLSL *comment* lines, which is where both incidents happened. A backtick inside a
		// ${...} interpolation is legitimate (the swell calls are generated that way), so flagging every
		// backtick would be a false positive on this file's own code.
		if (inGlsl && !closes && line.trim().startsWith('//') && line.includes('`')) {
			fail(`backtick in a GLSL comment at water.js:${index + 1} -- it ends the template early and only fails in the browser`);
		}
		if (opens) inGlsl = true;
		if (closes) inGlsl = false;
	});
}

const waterExtent = numberFrom(source, /export\s+const\s+WATER_FULL_WORLD_EXTENT_METERS\s*=\s*([0-9.]+)\s*;/, 'full-world water extent');
const worldWidth = numberFrom(configSource, /WORLD_WIDTH_METERS:\s*([0-9.]+)/, 'world width');
const worldDepth = numberFrom(configSource, /WORLD_DEPTH_METERS:\s*([0-9.]+)/, 'world depth');
const worldDiagonal = Math.hypot(worldWidth, worldDepth);
need(waterExtent >= worldDiagonal, `far-water plane ${waterExtent}m cannot cover full-world diagonal ${worldDiagonal.toFixed(2)}m`);
requirePattern(/fullWorld\s*:\s*true/, 'runtime water coverage telemetry must mark full-world adoption');

const component = (name) => {
	const match = source.match(new RegExp(`float\\s+${name}\\s*=\\s*sin\\(\\s*dot\\(\\s*vWorldPosition\\.xz\\s*,\\s*vec2\\(\\s*([-0-9.]+)\\s*,\\s*([-0-9.]+)\\s*\\)\\s*\\)\\s*([+-])\\s*uTime\\s*\\*\\s*([0-9.]+)\\s*\\)\\s*;`));
	need(match, `${name} component missing or unparsable`);
	return { x: Number(match[1]), z: Number(match[2]), timeSign: match[3], speed: Number(match[4]) };
};

const a = component('surfA');
const b = component('surfB');
const magnitude = (v) => Math.hypot(v.x, v.z);
const period = (v) => (Math.PI * 2) / magnitude(v);
const cross = Math.abs(a.x * b.z - a.z * b.x) / (magnitude(a) * magnitude(b));

need(period(a) >= 220 && period(b) >= 220, `surf spatial period too short: ${period(a).toFixed(1)}m/${period(b).toFixed(1)}m`);
need(cross >= 0.35, `surf directions too parallel; normalized cross=${cross.toFixed(4)}`);
need(a.timeSign !== b.timeSign, 'surf components should not march in the same temporal direction');
need(a.speed > 0 && b.speed > 0, 'surf animation speeds must stay positive');
requirePattern(/float\s+surge\s*=\s*clamp\(\s*0\.62\s*\+\s*0\.22\s*\*\s*surfA\s*\+\s*0\.16\s*\*\s*surfB\s*,\s*0\.18\s*,\s*1\.0\s*\)\s*;/, 'bounded mixed surge contract drifted');

console.log('WATER_SURF_VISUAL_CONTRACT_OK', JSON.stringify({
	periodA: Number(period(a).toFixed(3)),
	periodB: Number(period(b).toFixed(3)),
	directionCross: Number(cross.toFixed(6)),
	depthEnvelope: 0.22,
	rippleFadeMeters: [90, 360],
	swellShadingFadeMeters: [700, 1800],
	waterExtent,
	worldDiagonal: Number(worldDiagonal.toFixed(3)),
}));