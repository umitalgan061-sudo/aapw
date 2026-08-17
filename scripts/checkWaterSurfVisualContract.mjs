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

need(!/smoothstep\(\s*0\.22\s*,\s*0\.0\s*,\s*(?:vDepthFactor|fragmentDepth)\s*\)/.test(source), 'reversed-edge GLSL smoothstep returned');
need(source.includes('float shallowMask = 1.0 - smoothstep(0.0, 0.22, fragmentDepth);'), 'defined inverse shallow-depth mask missing or surf envelope drifted');
need(source.includes('shallowMask *= shorelineGradientMask(vWorldPosition.xz);'), 'surf must require a real bathymetry shoreline gradient');
need(source.includes('float foam = clamp(shallowMask * surge, 0.0, 1.0);'), 'foam must remain shoreline/depth gated');
need(source.includes('smoothstep(120.0, 420.0, distance(uCameraPosition, vWorldPosition))'), 'fine ripple distance anti-aliasing drifted');
need(source.includes('smoothstep(1500.0, 1950.0, localEdgeDistance)'), 'near swell must blend to zero before the dense mesh edge'); need(source.includes('new THREE.PlaneGeometry(WATER_FULL_WORLD_EXTENT_METERS, WATER_FULL_WORLD_EXTENT_METERS, 1, 1)'), 'two-triangle full-world far-water coverage missing'); need(source.includes('float fragmentDepth = sampleFragmentDepth(vWorldPosition.xz);'), 'far water must sample canonical bathymetry per fragment');

const waterExtent = numberFrom(source, /export const WATER_FULL_WORLD_EXTENT_METERS = ([0-9.]+);/, 'full-world water extent');
const worldWidth = numberFrom(configSource, /WORLD_WIDTH_METERS:\s*([0-9.]+)/, 'world width');
const worldDepth = numberFrom(configSource, /WORLD_DEPTH_METERS:\s*([0-9.]+)/, 'world depth');
const worldDiagonal = Math.hypot(worldWidth, worldDepth);
need(waterExtent >= worldDiagonal, `far-water plane ${waterExtent}m cannot cover full-world diagonal ${worldDiagonal.toFixed(2)}m`); need(source.includes('fullWorld: true'), 'runtime water coverage telemetry must mark full-world adoption');

const component = (name) => {
	const match = source.match(new RegExp(`float ${name} = sin\\(dot\\(vWorldPosition\\.xz, vec2\\(([-0-9.]+), ([-0-9.]+)\\)\\) ([+-]) uTime \\* ([0-9.]+)\\);`));
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
need(source.includes('float surge = clamp(0.62 + 0.22 * surfA + 0.16 * surfB, 0.18, 1.0);'), 'bounded mixed surge contract drifted');

console.log('WATER_SURF_VISUAL_CONTRACT_OK', JSON.stringify({
	periodA: Number(period(a).toFixed(3)),
	periodB: Number(period(b).toFixed(3)),
	directionCross: Number(cross.toFixed(6)),
	depthEnvelope: 0.22,
	waterExtent,
	worldDiagonal: Number(worldDiagonal.toFixed(3)),
}));