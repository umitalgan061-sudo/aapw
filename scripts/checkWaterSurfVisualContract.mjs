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
requirePattern(/vSwellSlope\s*\*\s*swellShadingFade\s*\+\s*rippleSlope\(\s*vWorldPosition\.xz\s*,\s*uTime\s*\)\s*\*\s*rippleFade/, 'water normal must apply the independent swell and ripple distance fades');
requirePattern(/smoothstep\(\$\{WATER_LAYER_TRANSITION_POLICY\.featherStartMeters\.toFixed\(1\)\},\s*\$\{WATER_LAYER_TRANSITION_POLICY\.featherEndMeters\.toFixed\(1\)\},\s*localEdgeDistance\)/, 'near swell must derive its fade from WATER_LAYER_TRANSITION_POLICY before the dense mesh edge');
requirePattern(/new\s+THREE\.PlaneGeometry\(\s*WATER_FULL_WORLD_EXTENT_METERS\s*,\s*WATER_FULL_WORLD_EXTENT_METERS\s*,\s*1\s*,\s*1\s*\)/, 'two-triangle full-world far-water coverage missing');
requirePattern(/vec2\s+waterField\s*=\s*sampleWaterField\(\s*vWorldPosition\.xz\s*\)\s*;/, 'far water must sample canonical depth and wet/dry coverage per fragment');
requirePattern(/float\s+waterCoverage\s*=\s*smoothstep\(\s*0\.08\s*,\s*0\.72\s*,\s*waterField\.y\s*\)\s*;/, 'canonical wet/dry coverage shoreline fade drifted');
requirePattern(/if\s*\(\s*waterCoverage\s*<=\s*0\.01\s*\)\s*discard\s*;/, 'dry-land fragment discard missing');
requirePattern(/alpha\s*\*=\s*waterCoverage\s*;/, 'shoreline opacity must remain coverage-bounded');

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
