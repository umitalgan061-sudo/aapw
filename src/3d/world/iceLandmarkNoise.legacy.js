import * as THREE from 'three';

/**
 * Deterministic value-noise helpers and the procedural ice surface texture generator used by
 * `iceLandmarks.js`. Split out of that file (Altın Kural 7, 600-line cap) as pure, one-directional
 * config/utility: this module imports only `three`, never `iceLandmarks.js`, so the split cannot
 * introduce an import cycle. `clamp01`, `hash2D` and `valueNoise2D` are re-exported because
 * `iceLandmarks.js` also calls them directly outside texture generation (wall/cave geometry noise);
 * `smoothstep` and `fbm2D` stay private here since nothing outside this file uses them.
 */

export function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

export function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((y | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

export function valueNoise2D(x, y, seed) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smoothstep(0, 1, x - x0);
	const ty = smoothstep(0, 1, y - y0);
	const a = hash2D(x0, y0, seed);
	const b = hash2D(x0 + 1, y0, seed);
	const c = hash2D(x0, y0 + 1, seed);
	const d = hash2D(x0 + 1, y0 + 1, seed);
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	return top + (bottom - top) * ty;
}

function fbm2D(x, y, seed) {
	let amplitude = 0.56;
	let frequency = 1;
	let total = 0;
	let weight = 0;
	for (let octave = 0; octave < 4; octave += 1) {
		total += valueNoise2D(x * frequency, y * frequency, seed + octave * 97) * amplitude;
		weight += amplitude;
		frequency *= 2.03;
		amplitude *= 0.48;
	}
	return total / weight;
}

export function createIceSurfaceTextures(seed) {
	const width = 128;
	const height = 256;
	const scalar = new Float32Array(width * height);
	const colorBytes = new Uint8Array(width * height * 4);
	const roughnessBytes = new Uint8Array(width * height * 4);
	const normalBytes = new Uint8Array(width * height * 4);

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const u = x / (width - 1);
			const v = y / (height - 1);
			const broad = fbm2D(u * 5.5, v * 1.2, seed + 13);
			const fine = fbm2D(u * 18, v * 3.0, seed + 71);
			const flowPhase = u * 56 + broad * 5.2 + Math.sin(v * Math.PI * 2.2) * 0.7;
			const flow = 0.5 + 0.5 * Math.sin(flowPhase * Math.PI * 2);
			const vein = Math.pow(1 - Math.abs(flow * 2 - 1), 3.2);
			const diagonal = Math.abs(Math.sin((u * 12.0 + v * 3.8 + fine * 1.6) * Math.PI));
			const crack = 1 - smoothstep(0.018, 0.085, diagonal);
			const frost = clamp01(0.22 + vein * 0.42 + (fine - 0.5) * 0.34 + (1 - v) * 0.08);
			const depth = clamp01(0.34 + broad * 0.38 - crack * 0.22);
			const heightSignal = 0.45 + vein * 0.18 + (fine - 0.5) * 0.18 - crack * 0.16;
			scalar[y * width + x] = heightSignal;

			const index = (y * width + x) * 4;
			const deep = [53, 111, 126];
			const mid = [107, 167, 177];
			const frostRgb = [194, 219, 218];
			const midMix = clamp01(depth);
			const r0 = deep[0] + (mid[0] - deep[0]) * midMix;
			const g0 = deep[1] + (mid[1] - deep[1]) * midMix;
			const b0 = deep[2] + (mid[2] - deep[2]) * midMix;
			colorBytes[index] = Math.round(r0 + (frostRgb[0] - r0) * frost);
			colorBytes[index + 1] = Math.round(g0 + (frostRgb[1] - g0) * frost);
			colorBytes[index + 2] = Math.round(b0 + (frostRgb[2] - b0) * frost);
			colorBytes[index + 3] = 255;

			const roughness = clamp01(0.36 + frost * 0.28 + crack * 0.22 - vein * 0.08);
			const roughByte = Math.round(roughness * 255);
			roughnessBytes[index] = roughByte;
			roughnessBytes[index + 1] = roughByte;
			roughnessBytes[index + 2] = roughByte;
			roughnessBytes[index + 3] = 255;
		}
	}

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const left = scalar[y * width + Math.max(0, x - 1)];
			const right = scalar[y * width + Math.min(width - 1, x + 1)];
			const down = scalar[Math.max(0, y - 1) * width + x];
			const up = scalar[Math.min(height - 1, y + 1) * width + x];
			const dx = (right - left) * 2.4;
			const dy = (up - down) * 1.7;
			const length = Math.hypot(dx, dy, 1) || 1;
			const index = (y * width + x) * 4;
			normalBytes[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 3] = 255;
		}
	}

	const colorMap = new THREE.DataTexture(colorBytes, width, height, THREE.RGBAFormat);
	colorMap.colorSpace = THREE.SRGBColorSpace;
	const roughnessMap = new THREE.DataTexture(roughnessBytes, width, height, THREE.RGBAFormat);
	const normalMap = new THREE.DataTexture(normalBytes, width, height, THREE.RGBAFormat);
	for (const texture of [colorMap, roughnessMap, normalMap]) {
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.needsUpdate = true;
	}
	return { colorMap, roughnessMap, normalMap };
}
