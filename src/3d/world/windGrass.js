/**
 * Bounded deterministic physical grass with shader-only natural wind.
 *
 * Extracted from sceneManager so ground cover owns its own placement, climate and GPU-wind policy.
 * The public `createWindGrassRun180` name is kept for compatibility with the established browser
 * regression contract, while the implementation now consumes the shared north ground-cover climate
 * profile directly. Permanent ice therefore has zero ordinary grass; tundra gets sparse, shorter,
 * desaturated cover; temperate regions retain the historical density and scale.
 * @module world/windGrass
 */

import * as THREE from 'three';
import {
	northGroundCoverProfileAtWorldZ,
	NORTH_GROUND_COVER_POLICY,
} from './northGroundCoverClimate.js';
import { resolveTerrainSnowCoverage } from './terrainBiomeShading.js';

export const RUN180_WIND_GRASS_CONFIG = Object.freeze({
	desktop: Object.freeze({ radiusMeters: 350, maxPatches: 4000 }),
	mobile: Object.freeze({ radiusMeters: 260, maxPatches: 1200 }),
	cellMeters: 120,
	bladesPerPatch: 10,
	patchRadiusMeters: 4.5,
	roadClearanceMeters: 10,
	seatClearanceMeters: 100,
	shoreMarginMeters: 1.5,
	maxSlopeDegrees: 38,
	maxPlacementAttempts: 8,
	surfaceProbeMeters: 4,
	// Ordinary blades may poke through patchy snow, but should disappear before the terrain reads as
	// a continuous snow field. This uses the exact render snow-coverage resolver rather than inventing
	// a second altitude/latitude snowline for vegetation.
	snowDensityFadeStart: 0.18,
	snowDensityZeroAt: 0.72,
});

function grassRng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function grassSegmentDistance(px, pz, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const lengthSq = dx * dx + dz * dz;
	if (!lengthSq) return Math.hypot(px - a.x, pz - a.z);
	const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lengthSq));
	return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/** Geometric/gameplay exclusions independent from latitude density thinning. */
export function isWindGrassSurfaceAllowed(x, z, {
	sampleHeightMeters,
	seaLevelMeters,
	seats = [],
	roadEdges = [],
}, outSurface = null) {
	for (const seat of seats) {
		if (Math.hypot(x - seat.x, z - seat.z) < RUN180_WIND_GRASS_CONFIG.seatClearanceMeters) return false;
	}
	for (const edge of roadEdges) {
		for (let i = 1; i < edge.points.length; i++) {
			if (grassSegmentDistance(x, z, edge.points[i - 1], edge.points[i]) < RUN180_WIND_GRASS_CONFIG.roadClearanceMeters) return false;
		}
	}
	const y = sampleHeightMeters(x, z);
	if (y <= seaLevelMeters + RUN180_WIND_GRASS_CONFIG.shoreMarginMeters) return false;
	const d = RUN180_WIND_GRASS_CONFIG.surfaceProbeMeters;
	const dx = sampleHeightMeters(x + d, z) - y;
	const dz = sampleHeightMeters(x, z + d) - y;
	const slopeDegrees = Math.atan2(Math.max(Math.abs(dx), Math.abs(dz)), d) * 180 / Math.PI;
	if (outSurface) {
		outSurface.heightMeters = y;
		outSurface.slopeDegrees = slopeDegrees;
	}
	return slopeDegrees <= RUN180_WIND_GRASS_CONFIG.maxSlopeDegrees;
}

/**
 * Translate the canonical render snow amount into ordinary-grass survival. Patchy snow can retain
 * some vegetation; continuous snow suppresses it completely. Dry temperate ground returns exactly 1
 * so the established southern RNG stream does not consume any additional acceptance roll.
 */
export function windGrassSnowDensityMultiplier({ heightAboveSeaMeters, slopeDegrees, worldZ }) {
	const snow = resolveTerrainSnowCoverage({
		heightAboveSeaMeters,
		slopeDegrees,
		worldZ,
	});
	const start = RUN180_WIND_GRASS_CONFIG.snowDensityFadeStart;
	const end = RUN180_WIND_GRASS_CONFIG.snowDensityZeroAt;
	const raw = clamp01((snow.snowAmount - start) / Math.max(1e-6, end - start));
	const smooth = raw * raw * (3 - 2 * raw);
	return 1 - smooth;
}

export function createWindGrassGeometry() {
	const positions = [];
	const indices = [];
	const flex = [];
	const phase = [];
	const count = RUN180_WIND_GRASS_CONFIG.bladesPerPatch;
	const radius = RUN180_WIND_GRASS_CONFIG.patchRadiusMeters;
	for (let i = 0; i < count; i++) {
		const angle = i * 2.3999632297;
		const r = radius * Math.sqrt((i + 0.35) / count);
		const cx = Math.cos(angle) * r;
		const cz = Math.sin(angle) * r;
		const height = 0.58 + 0.42 * ((i * 37 % 101) / 100);
		const width = 0.11 + 0.07 * ((i * 53 % 97) / 96);
		const sideX = Math.cos(angle + Math.PI / 2) * width;
		const sideZ = Math.sin(angle + Math.PI / 2) * width;
		const base = positions.length / 3;
		positions.push(
			cx - sideX, 0, cz - sideZ,
			cx + sideX, 0, cz + sideZ,
			cx - sideX, height, cz - sideZ,
			cx + sideX, height, cz + sideZ,
		);
		indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
		flex.push(0, 0, 1, 1);
		phase.push(i / count, i / count, i / count, i / count);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('run180Flex', new THREE.Float32BufferAttribute(flex, 1));
	geometry.setAttribute('run180Phase', new THREE.Float32BufferAttribute(phase, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

export function populateWindGrass(mesh, params, cellX, cellZ) {
	const config = params.isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const seed = (params.seed ^ Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663) ^ 0x47524153) >>> 0;
	const random = grassRng(seed);
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const position = new THREE.Vector3();
	const color = new THREE.Color();
	const up = new THREE.Vector3(0, 1, 0);
	const centerX = cellX * RUN180_WIND_GRASS_CONFIG.cellMeters;
	const centerZ = cellZ * RUN180_WIND_GRASS_CONFIG.cellMeters;
	const surface = { heightMeters: 0, slopeDegrees: 0 };
	let placed = 0;
	let climateRejected = 0;
	let snowRejected = 0;

	for (let i = 0; i < config.maxPatches; i++) {
		for (let attempt = 0; attempt < RUN180_WIND_GRASS_CONFIG.maxPlacementAttempts; attempt++) {
			const angle = random() * Math.PI * 2;
			const radius = config.radiusMeters * Math.sqrt(random());
			const x = centerX + Math.cos(angle) * radius;
			const z = centerZ + Math.sin(angle) * radius;
			if (!isWindGrassSurfaceAllowed(x, z, params, surface)) continue;

			const cover = northGroundCoverProfileAtWorldZ(z);
			if (cover.grassDensity <= 0) {
				climateRejected++;
				continue;
			}
			const snowDensity = windGrassSnowDensityMultiplier({
				heightAboveSeaMeters: surface.heightMeters - params.seaLevelMeters,
				slopeDegrees: surface.slopeDegrees,
				worldZ: z,
			});
			if (snowDensity <= 0) {
				snowRejected++;
				continue;
			}
			const grassDensity = cover.grassDensity * snowDensity;
			// Do not consume a new RNG draw on fully accepted ground. This preserves the historical
			// deterministic transform stream exactly where both climate and snow density remain 1.
			if (grassDensity < 1 && random() >= grassDensity) {
				if (snowDensity < 1) snowRejected++;
				else climateRejected++;
				continue;
			}

			position.set(x, surface.heightMeters + 0.03, z);
			quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
			const uniformScale = (0.78 + random() * 0.47) * cover.heightScale;
			scale.set(uniformScale, uniformScale, uniformScale);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(placed, matrix);
			color.setRGB(cover.rgb.r, cover.rgb.g, cover.rgb.b);
			mesh.setColorAt(placed, color);
			placed++;
			break;
		}
	}

	mesh.count = placed;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
	mesh.userData.run180Cell = { x: cellX, z: cellZ };
	mesh.userData.northGroundCover = {
		policyId: NORTH_GROUND_COVER_POLICY.id,
		climateRejected,
		snowRejected,
		snowAware: true,
	};
	return placed;
}

function createWindGrassMaterial(config) {
	const material = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		roughness: 1,
		metalness: 0,
		side: THREE.DoubleSide,
	});
	material.userData.run180WindGrass = Object.freeze({
		key: 'run180-wind-grass-v3-snow-climate',
		radiusMeters: config.radiusMeters,
		maxPatches: config.maxPatches,
		bladesPerPatch: RUN180_WIND_GRASS_CONFIG.bladesPerPatch,
		climatePolicyId: NORTH_GROUND_COVER_POLICY.id,
		snowAware: true,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uRun180WindTime = { value: 0 };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nuniform float uRun180WindTime;\nattribute float run180Flex;\nattribute float run180Phase;\nvarying float vRun180GrassVariation;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvec2 run180XZ=instanceMatrix[3].xz;\nfloat run180P=dot(run180XZ,vec2(0.021,0.017))+run180Phase*6.2831853;\nfloat run180Wave=sin(uRun180WindTime*1.05+run180P)+0.35*sin(uRun180WindTime*2.15+run180P*1.73);\ntransformed.xz+=vec2(0.78,0.62)*run180Wave*run180Flex*run180Flex*0.24;\nvRun180GrassVariation=fract(sin(dot(run180XZ,vec2(12.9898,78.233)))*43758.5453);');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying float vRun180GrassVariation;')
			.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(0.84,1.10,vRun180GrassVariation);');
		material.userData.run180Shader = shader;
	};
	material.customProgramCacheKey = () => 'run180-wind-grass-v3-snow-climate';
	return material;
}

export function createWindGrassRun180({
	sampleHeightMeters,
	seaLevelMeters,
	seed,
	seats,
	roadEdges,
	isMobileClass = false,
	centerX = 0,
	centerZ = 0,
}) {
	const config = isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const geometry = createWindGrassGeometry();
	const material = createWindGrassMaterial(config);
	const mesh = new THREE.InstancedMesh(geometry, material, config.maxPatches);
	const group = new THREE.Group();
	const params = { sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass };
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	mesh.userData.run180FirstFrameSafe = true;

	const initialX = Math.round(centerX / RUN180_WIND_GRASS_CONFIG.cellMeters);
	const initialZ = Math.round(centerZ / RUN180_WIND_GRASS_CONFIG.cellMeters);
	let placed = populateWindGrass(mesh, params, initialX, initialZ);
	mesh.onBeforeRender = (_renderer, _scene, camera) => {
		const shader = material.userData.run180Shader;
		if (shader) shader.uniforms.uRun180WindTime.value = performance.now() * 0.001;
		const cellX = Math.round(camera.position.x / RUN180_WIND_GRASS_CONFIG.cellMeters);
		const cellZ = Math.round(camera.position.z / RUN180_WIND_GRASS_CONFIG.cellMeters);
		if (cellX !== mesh.userData.run180Cell.x || cellZ !== mesh.userData.run180Cell.z) {
			placed = populateWindGrass(mesh, params, cellX, cellZ);
			group.userData.run180WindGrass.placedCount = placed;
			group.userData.run180WindGrass.centerCell = { x: cellX, z: cellZ };
			group.userData.run180WindGrass.climateRejected = mesh.userData.northGroundCover?.climateRejected ?? 0;
			group.userData.run180WindGrass.snowRejected = mesh.userData.northGroundCover?.snowRejected ?? 0;
		}
	};

	group.add(mesh);
	group.userData.run180WindGrass = {
		active: true,
		isMobileClass,
		placedCount: placed,
		maxPatches: config.maxPatches,
		radiusMeters: config.radiusMeters,
		centerCell: { x: initialX, z: initialZ },
		climatePolicyId: NORTH_GROUND_COVER_POLICY.id,
		climateRejected: mesh.userData.northGroundCover?.climateRejected ?? 0,
		snowRejected: mesh.userData.northGroundCover?.snowRejected ?? 0,
		snowAware: true,
	};
	return { group, mesh };
}