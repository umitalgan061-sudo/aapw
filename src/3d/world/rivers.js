/**
 * Deterministic river and waterfall rendering over the canonical terrain sampler.
 * Paths are discovered from the existing height field; this module never carves terrain, moves
 * shorelines, edits hydrology authority or changes colliders. Surface realism is render-only.
 * @module world/rivers
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

const SOURCE_SEARCH_STEP_METERS = 100;
const DESCENT_CANDIDATE_COUNT = 12;
const DESCENT_ANGLE_JITTER_RADIANS = 0.35;
const MAX_STUCK_ESCALATIONS = 4;

const RIVER_POOL_COLOR = new THREE.Color(0x667d77);
const RIVER_COLOR = new THREE.Color(0x4f7f89);
const WATERFALL_PLUNGE_COLOR = new THREE.Color(0x587783);
const WATERFALL_SPLASH_COLOR = new THREE.Color(0xd5e7e9);

RIVER_POOL_COLOR.lerp(new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.riverPool), 0.68);
RIVER_COLOR.lerp(new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.rapid), 0.72);
WATERFALL_PLUNGE_COLOR.lerp(new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.plunge), 0.74);
WATERFALL_SPLASH_COLOR.lerp(new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.splash), 0.78);

const RIVER_BASE_FLOW_SPEED_MPS = 1.2;
const RIVER_GRADE_FLOW_GAIN = 6;
const RIVER_FLOW_WAVENUMBER = 1.0;
const WATERFALL_FLOW_SPEED_MPS = 9;
const WATERFALL_APRON_FLOW_SPEED_MPS = 5.5;
const WATERFALL_MIN_DROP_METERS = 2.5;
const WATERFALL_MIN_SLOPE = 0.06;
const WATERFALL_FOAM_COLOR = new THREE.Color(0xf0f8ff);
WATERFALL_FOAM_COLOR.lerp(new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.foam), 0.82);

export const RIVER_SURFACE_REALISM_POLICY = Object.freeze({
	id: 'river-waterfall-surface-realism-2026-08-31-v2',
	renderOnly: true,
	canonicalTerrainUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
	worldSpaceMultiScaleAlbedo: true,
	worldSpaceNormalVariation: true,
	flowEnergyRoughnessVariation: true,
	bankMineralTransition: true,
	slopeDrivenFoam: true,
	segmentedWaterfallGeometry: true,
	deterministic: true,
});

/**
 * Adds animated downstream foam plus deterministic world-space optical breakup to the stock PBR
 * material. The geometry's baked flow distance/speed/side attributes remain the flow authority.
 */
function attachFlowAnimation(material, cacheKey, foamStrength) {
	const flowUniforms = { uTime: { value: 0 } };
	material.userData.flowUniforms = flowUniforms;
	material.userData.riverSurfaceRealism = RIVER_SURFACE_REALISM_POLICY;
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = flowUniforms.uTime;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute float aFlowDistance;
attribute float aFlowSpeed;
attribute float aFlowSide;
varying float vFlowDistance;
varying float vFlowSpeed;
varying float vFlowSide;
varying vec3 vRiverWorldPosition;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vFlowDistance = aFlowDistance;
vFlowSpeed = aFlowSpeed;
vFlowSide = aFlowSide;
vRiverWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
			);

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float uTime;
varying float vFlowDistance;
varying float vFlowSpeed;
varying float vFlowSide;
varying vec3 vRiverWorldPosition;
float riverSurfaceHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float riverSurfaceNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = riverSurfaceHash(i);
	float b = riverSurfaceHash(i + vec2(1.0, 0.0));
	float c = riverSurfaceHash(i + vec2(0.0, 1.0));
	float d = riverSurfaceHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float riverSurfaceFbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.56;
	for (int octave = 0; octave < 4; octave++) {
		value += riverSurfaceNoise(p) * amplitude;
		p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.07 + vec2(11.3, -7.9);
		amplitude *= 0.45;
	}
	return value / 1.0182;
}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
vec2 riverWorldXZ = vRiverWorldPosition.xz;
float riverMacro = riverSurfaceFbm(riverWorldXZ * 0.015 + vec2(4.7, -12.1));
float riverMeso = riverSurfaceFbm(riverWorldXZ * 0.071 + vec2(-18.4, 7.6));
float riverFine = riverSurfaceNoise(riverWorldXZ * 0.33 + vec2(21.7, 3.9));
float riverFlowEnergy = smoothstep(1.2, 4.5, vFlowSpeed);
float riverBankBias = smoothstep(0.46, 1.0, abs(vFlowSide));
float riverFlowPhase = (vFlowDistance - uTime * vFlowSpeed) * ${RIVER_FLOW_WAVENUMBER.toFixed(4)};
float riverPrimary = sin(riverFlowPhase + (riverMeso - 0.5) * 1.25) * 0.5 + 0.5;
float riverSecondary = sin(riverFlowPhase * 0.41 + vFlowSide * 3.7 + (riverMacro - 0.5) * 2.1) * 0.5 + 0.5;
float riverFoam = pow(riverPrimary * 0.60 + riverSecondary * 0.40, 3.0);
float riverTurbulentBreakup = sin(riverFlowPhase * 1.73 - vFlowSide * 8.1 + sin(riverFlowPhase * 0.23) * 2.4 + riverFine * 2.6) * 0.5 + 0.5;
riverFoam *= mix(0.55, 1.20, smoothstep(0.18, 0.86, riverTurbulentBreakup));
riverFoam *= mix(0.22, 1.0, riverFlowEnergy);
float riverOpticalTone = (riverMacro - 0.5) * 0.065 + (riverMeso - 0.5) * 0.035 + (riverFine - 0.5) * 0.015;
diffuseColor.rgb *= 1.0 + riverOpticalTone;
vec3 riverBankMineral = mix(vec3(0.245, 0.275, 0.250), vec3(0.355, 0.338, 0.286), riverMeso);
float riverBankDeposit = riverBankBias * smoothstep(0.52, 0.82, riverMacro * 0.68 + riverFine * 0.32) * (1.0 - riverFlowEnergy * 0.46);
diffuseColor.rgb = mix(diffuseColor.rgb, riverBankMineral, riverBankDeposit * 0.105);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.94, 0.97), riverFoam * ${foamStrength.toFixed(3)} * mix(0.48, 1.0, riverBankBias));`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
float riverRoughnessTarget = 0.085
	+ riverFlowEnergy * 0.115
	+ riverBankBias * 0.042
	+ riverFoam * 0.072
	+ (riverMeso - 0.5) * 0.055
	+ (riverFine - 0.5) * 0.035;
roughnessFactor = clamp(riverRoughnessTarget, 0.055, 0.34);`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
float riverNormalScale = 0.42 + riverFlowEnergy * 0.34 + riverFoam * 0.18;
vec2 riverNormalP = riverWorldXZ * 0.29 + vec2(riverFlowPhase * 0.035, -riverFlowPhase * 0.021);
float riverNx = riverSurfaceFbm(riverNormalP + vec2(0.21, 0.0)) - riverSurfaceFbm(riverNormalP - vec2(0.21, 0.0));
float riverNz = riverSurfaceFbm(riverNormalP + vec2(0.0, 0.21)) - riverSurfaceFbm(riverNormalP - vec2(0.0, 0.21));
vec3 riverWorldPerturb = vec3(-riverNx, 0.0, -riverNz) * riverNormalScale;
normal = normalize(normal + mat3(viewMatrix) * riverWorldPerturb * 0.12);`,
			);
	};
	material.customProgramCacheKey = () => cacheKey;
	return flowUniforms;
}

export function updateFlowAnimation(mesh, elapsedSeconds) {
	const flowUniforms = mesh?.material?.userData?.flowUniforms;
	if (flowUniforms) flowUniforms.uTime.value = elapsedSeconds;
}

/** Trace a deterministic downhill path over the existing terrain sampler. */
export function generateRiverPath({ seed, sampleHeightMeters, seaLevelMeters, searchRadiusMeters = 2000, maxRiverRadiusMeters = 2800, stepMeters = 40, maxSteps = 400 }) {
	let sourceX = 0;
	let sourceZ = 0;
	let sourceHeight = -Infinity;
	for (let x = -searchRadiusMeters; x <= searchRadiusMeters; x += SOURCE_SEARCH_STEP_METERS) {
		for (let z = -searchRadiusMeters; z <= searchRadiusMeters; z += SOURCE_SEARCH_STEP_METERS) {
			const h = sampleHeightMeters(x, z);
			if (h > sourceHeight) { sourceHeight = h; sourceX = x; sourceZ = z; }
		}
	}
	const rng = mulberry32(seed ^ 0x52495652);
	const points = [new THREE.Vector3(sourceX, sourceHeight, sourceZ)];
	let x = sourceX;
	let z = sourceZ;
	let y = sourceHeight;
	let endReason = 'max-steps';
	for (let step = 0; step < maxSteps; step++) {
		if (y <= seaLevelMeters) { endReason = 'sea'; break; }
		let bestX = x;
		let bestZ = z;
		let bestHeight = y;
		let found = false;
		for (let escalation = 0; escalation <= MAX_STUCK_ESCALATIONS && !found; escalation++) {
			const searchRadius = stepMeters * 2 ** escalation;
			for (let c = 0; c < DESCENT_CANDIDATE_COUNT; c++) {
				const angle = (c / DESCENT_CANDIDATE_COUNT) * Math.PI * 2 + (rng() - 0.5) * DESCENT_ANGLE_JITTER_RADIANS;
				const candidateX = x + Math.cos(angle) * searchRadius;
				const candidateZ = z + Math.sin(angle) * searchRadius;
				const candidateHeight = sampleHeightMeters(candidateX, candidateZ);
				if (candidateHeight < bestHeight) { bestHeight = candidateHeight; bestX = candidateX; bestZ = candidateZ; found = true; }
			}
		}
		if (!found) { endReason = 'local-minimum'; break; }
		if (Math.hypot(bestX, bestZ) > maxRiverRadiusMeters) { endReason = 'bounds'; break; }
		x = bestX; z = bestZ; y = bestHeight;
		points.push(new THREE.Vector3(x, y, z));
	}
	return { points, endReason };
}

export function createRiverMesh(points, widthMeters = 14) {
	if (points.length < 2) return null;
	const halfWidth = widthMeters / 2;
	const verticalOffset = 0.3;
	const positions = new Float32Array(points.length * 2 * 3);
	const colors = new Float32Array(points.length * 2 * 3);
	const flowDistances = new Float32Array(points.length * 2);
	const flowSpeeds = new Float32Array(points.length * 2);
	const flowSides = new Float32Array(points.length * 2);
	const indices = [];
	let arcLengthMeters = 0;
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const prev = points[Math.max(0, i - 1)];
		const next = points[Math.min(points.length - 1, i + 1)];
		const tangentX = next.x - prev.x;
		const tangentZ = next.z - prev.z;
		const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
		const perpX = -tangentZ / tangentLength;
		const perpZ = tangentX / tangentLength;
		if (i > 0) arcLengthMeters += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
		const neighbourhoodRunMeters = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
		const grade = Math.max(0, (prev.y - next.y) / neighbourhoodRunMeters);
		const flowSpeedMps = RIVER_BASE_FLOW_SPEED_MPS + Math.sqrt(grade) * RIVER_GRADE_FLOW_GAIN;
		const rushAmount = THREE.MathUtils.smoothstep(flowSpeedMps, RIVER_BASE_FLOW_SPEED_MPS, 4.5);
		const riverR = THREE.MathUtils.lerp(RIVER_POOL_COLOR.r, RIVER_COLOR.r, rushAmount);
		const riverG = THREE.MathUtils.lerp(RIVER_POOL_COLOR.g, RIVER_COLOR.g, rushAmount);
		const riverB = THREE.MathUtils.lerp(RIVER_POOL_COLOR.b, RIVER_COLOR.b, rushAmount);
		const leftIndex = i * 2;
		const rightIndex = leftIndex + 1;
		flowDistances[leftIndex] = arcLengthMeters;
		flowDistances[rightIndex] = arcLengthMeters;
		flowSpeeds[leftIndex] = flowSpeedMps;
		flowSpeeds[rightIndex] = flowSpeedMps;
		flowSides[leftIndex] = -1;
		flowSides[rightIndex] = 1;
		positions[leftIndex * 3] = point.x + perpX * halfWidth;
		positions[leftIndex * 3 + 1] = point.y + verticalOffset;
		positions[leftIndex * 3 + 2] = point.z + perpZ * halfWidth;
		positions[rightIndex * 3] = point.x - perpX * halfWidth;
		positions[rightIndex * 3 + 1] = point.y + verticalOffset;
		positions[rightIndex * 3 + 2] = point.z - perpZ * halfWidth;
		colors[leftIndex * 3] = colors[rightIndex * 3] = riverR;
		colors[leftIndex * 3 + 1] = colors[rightIndex * 3 + 1] = riverG;
		colors[leftIndex * 3 + 2] = colors[rightIndex * 3 + 2] = riverB;
		if (i > 0) {
			const prevLeft = leftIndex - 2;
			const prevRight = rightIndex - 2;
			indices.push(prevLeft, prevRight, leftIndex, prevRight, rightIndex, leftIndex);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('aFlowDistance', new THREE.BufferAttribute(flowDistances, 1));
	geometry.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flowSpeeds, 1));
	geometry.setAttribute('aFlowSide', new THREE.BufferAttribute(flowSides, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.74, side: THREE.DoubleSide });
	material.userData.opticalProfile = Object.freeze({ calmBedReadable: true, opacity: 0.74, slopeDrivenFoam: true, turbulentFoamBreakup: true, worldSpaceMultiScaleSurface: true, normalVariation: true, roughnessVariation: true, bankMineralTransition: true, referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id });
	attachFlowAnimation(material, 'river-flow-surface-v2', 0.36);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.userData.totalFlowLengthMeters = arcLengthMeters;
	return mesh;
}

export function disposeRiverMesh(riverMesh) { riverMesh.geometry.dispose(); riverMesh.material.dispose(); }

export function detectWaterfalls(points) {
	const waterfalls = [];
	for (let i = 1; i < points.length; i++) {
		const top = points[i - 1];
		const bottom = points[i];
		const horizontalDistance = Math.hypot(bottom.x - top.x, bottom.z - top.z);
		if (horizontalDistance === 0) continue;
		const dropMeters = top.y - bottom.y;
		const slope = dropMeters / horizontalDistance;
		if (dropMeters >= WATERFALL_MIN_DROP_METERS && slope >= WATERFALL_MIN_SLOPE) waterfalls.push({ top, bottom, dropMeters });
	}
	return waterfalls;
}

function waterfallGeometryNoise(top, bottom, side, octave) {
	const phase = top.x * 0.0217 + top.z * 0.0173 + bottom.x * 0.0119 - bottom.z * 0.0131;
	return Math.sin(phase + side * (6.7 + octave * 2.9) + octave * 1.37) * 0.5 + 0.5;
}

export function createWaterfallMesh({ top, bottom, dropMeters }, widthMeters = 14) {
	const flowX = bottom.x - top.x;
	const flowZ = bottom.z - top.z;
	const tangentLength = Math.hypot(flowX, flowZ) || 1;
	const dirX = flowX / tangentLength;
	const dirZ = flowZ / tangentLength;
	const perpX = -dirZ;
	const perpZ = dirX;
	const halfWidth = widthMeters / 2;
	const apronLengthMeters = Math.max(3.5, Math.min(widthMeters * 0.72, dropMeters * 0.9));
	const columnSegments = Math.max(12, Math.min(18, Math.round(widthMeters)));
	const rowCount = 6;
	const columnCount = columnSegments + 1;
	const vertexCount = rowCount * columnCount;
	const positions = new Float32Array(vertexCount * 3);
	const colors = new Float32Array(vertexCount * 3);
	const flowDistances = new Float32Array(vertexCount);
	const flowSpeeds = new Float32Array(vertexCount);
	const flowSides = new Float32Array(vertexCount);
	const indices = [];
	const rowFlowDistance = [0, dropMeters * 0.20, dropMeters * 0.43, dropMeters * 0.70, dropMeters, dropMeters + apronLengthMeters];
	const rowFlowSpeed = [WATERFALL_FLOW_SPEED_MPS, WATERFALL_FLOW_SPEED_MPS, WATERFALL_FLOW_SPEED_MPS, WATERFALL_FLOW_SPEED_MPS, WATERFALL_APRON_FLOW_SPEED_MPS, WATERFALL_APRON_FLOW_SPEED_MPS];
	const aeratedUpper = WATERFALL_PLUNGE_COLOR.clone().lerp(WATERFALL_FOAM_COLOR, 0.62);
	const aeratedLower = WATERFALL_PLUNGE_COLOR.clone().lerp(WATERFALL_SPLASH_COLOR, 0.48);
	const rowColor = [WATERFALL_FOAM_COLOR, aeratedUpper, WATERFALL_PLUNGE_COLOR, aeratedLower, WATERFALL_SPLASH_COLOR, WATERFALL_PLUNGE_COLOR];
	const rowLateralScale = [1.0, 0.91, 0.84, 0.89, 1.03, 1.24];
	const rowForwardFraction = [0.0, 0.06, 0.16, 0.39, 1.0];
	const rowDropFraction = [0.0, 0.20, 0.43, 0.70, 1.0];
	for (let column = 0; column < columnCount; column++) {
		const side = -1 + (column / columnSegments) * 2;
		const edgeFade = Math.max(0, 1 - Math.pow(Math.abs(side), 1.6));
		const lateralNoise = waterfallGeometryNoise(top, bottom, side, 0) - 0.5;
		const sheetNoise = waterfallGeometryNoise(top, bottom, side, 1) - 0.5;
		const foldNoise = waterfallGeometryNoise(top, bottom, side, 2) - 0.5;
		const apronNoise = waterfallGeometryNoise(top, bottom, side, 3) - 0.5;
		const baseLateral = side * halfWidth + lateralNoise * widthMeters * 0.055 * edgeFade;
		for (let row = 0; row < rowCount; row++) {
			const vertex = row * columnCount + column;
			const isApron = row === rowCount - 1;
			const rowLateralWave = (sheetNoise * 0.62 + foldNoise * 0.38) * widthMeters * (0.018 + row * 0.005) * edgeFade;
			const rowLateral = baseLateral * rowLateralScale[row] + rowLateralWave;
			let forward;
			let y;
			if (isApron) {
				forward = tangentLength + apronLengthMeters * (1 + apronNoise * 0.14 * edgeFade);
				y = bottom.y + 0.16 + apronNoise * 0.04 * edgeFade;
			} else {
				const foldAmplitude = Math.min(1.05, dropMeters * 0.075) * (0.22 + row * 0.16);
				forward = tangentLength * rowForwardFraction[row] + (sheetNoise * 0.68 + foldNoise * 0.32) * foldAmplitude * edgeFade;
				y = THREE.MathUtils.lerp(top.y, bottom.y, rowDropFraction[row]) + foldNoise * Math.min(0.38, dropMeters * 0.03) * edgeFade;
				if (row === 0) y += 0.05;
				if (row === rowCount - 2) y = bottom.y + 0.14;
			}
			positions[vertex * 3] = top.x + dirX * forward + perpX * rowLateral;
			positions[vertex * 3 + 1] = y;
			positions[vertex * 3 + 2] = top.z + dirZ * forward + perpZ * rowLateral;
			flowDistances[vertex] = rowFlowDistance[row];
			flowSpeeds[vertex] = rowFlowSpeed[row];
			flowSides[vertex] = side;
			const toneNoise = waterfallGeometryNoise(top, bottom, side, row + 4) - 0.5;
			const aerationTone = 0.94 + toneNoise * 0.16 + (row === 1 || row === 3 || row === 4 ? edgeFade * 0.045 : 0);
			colors[vertex * 3] = Math.min(1, rowColor[row].r * aerationTone);
			colors[vertex * 3 + 1] = Math.min(1, rowColor[row].g * aerationTone);
			colors[vertex * 3 + 2] = Math.min(1, rowColor[row].b * aerationTone);
		}
	}
	for (let row = 0; row < rowCount - 1; row++) {
		for (let column = 0; column < columnSegments; column++) {
			const a = row * columnCount + column;
			const b = a + 1;
			const c = a + columnCount;
			const d = c + 1;
			if ((row + column) % 2 === 0) indices.push(a, c, b, b, c, d);
			else indices.push(a, c, d, a, d, b);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('aFlowDistance', new THREE.BufferAttribute(flowDistances, 1));
	geometry.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flowSpeeds, 1));
	geometry.setAttribute('aFlowSide', new THREE.BufferAttribute(flowSides, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
	material.userData.opticalProfile = Object.freeze({ aerated: true, opacity: 0.82, plungeColor: WATERFALL_PLUNGE_COLOR.getHex(), splashApron: true, singleDrawCall: true, segmentedCascade: true, hangingCurtain: true, turbulentFoamBreakup: true, worldSpaceMultiScaleSurface: true, normalVariation: true, roughnessVariation: true, referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id });
	attachFlowAnimation(material, 'waterfall-flow-splash-v5', 0.68);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.userData.dropMeters = dropMeters;
	mesh.userData.apronLengthMeters = apronLengthMeters;
	mesh.userData.cascadeColumnSegments = columnSegments;
	mesh.userData.cascadeRowCount = rowCount;
	return mesh;
}

export function disposeWaterfallMesh(waterfallMesh) { waterfallMesh.geometry.dispose(); waterfallMesh.material.dispose(); }