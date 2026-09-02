/**
 * Wind grass — the ground cover the player actually walks through.
 *
 * Extracted from `sceneManager.js` in run 366, which had grown past the project's 600-line cap while
 * this was being rebuilt. Behaviour, seeding and the streaming wrapper are carried over verbatim; only
 * the blade geometry changed, and its own comment explains why.
 * @module world/windGrass
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';

// Run 180 / ADR-0201 — bounded deterministic physical grass with shader-only natural wind.
const RUN180_WIND_GRASS_CONFIG = Object.freeze({
	// Run 366: radius pulled in from 350/260 m. The patch budget is fixed, so radius *is* density —
	// 4000 patches spread over a 350 m disc is one patch per 96 m², which is why the first rebuild still
	// rendered as isolated blades standing on bare ground however good each blade had become. At 130 m
	// the same 4000 patches cover 53,000 m² at 15 m² each, i.e. they overlap into continuous turf. The
	// grass given up beyond 130 m was never legible anyway: a 0.5 m blade at 300 m is well under a pixel.
	// Run 418: pulled in again, and this time from a measurement rather than from taste. A frame-cost
	// breakdown of the real scene put this system at **1,536,000 of 2,758,184 rendered triangles — 56%
	// of the entire frame** — while still rendering as separate blades on bare ground. The reason both
	// were true at once is density: 4000 patches of 48 blades over a 130 m disc is 3.6 blades per square
	// metre, and no arrangement of 3.6 blades per square metre is turf.
	//
	// Geometric grass cannot be turf at any budget this project has — real grassland is thousands of
	// shoots per square metre. So the job is split: since run 416 the ground's own texture carries the
	// sward, and these blades are the near-field fringe standing in it. That makes a much smaller radius
	// the right answer rather than a sacrifice, and the triangles saved by shrinking it buy density
	// where the player actually is.
	//
	// `cellMeters` is per tier for the first time, and it has to be: the disc is centred on the *cell*,
	// not on the camera, so the player can stand up to half a cell from its centre. At the old 120 m
	// cell that offset is 60 m, and a 55 m disc would have left the player standing entirely outside
	// their own grass — which is exactly what the first run-418 capture showed, a field of grass off to
	// one side and bare ground underfoot. Half a cell must stay well inside the radius.
	desktop: Object.freeze({ radiusMeters: 72, maxPatches: 3200, cellMeters: 64 }),
	mobile: Object.freeze({ radiusMeters: 52, maxPatches: 900, cellMeters: 48 }),
	/** Fraction of the radius over which blades shrink to nothing, so the disc has no visible rim. */
	edgeFadeFraction: 0.28,
	bladesPerPatch: 72,
	patchRadiusMeters: 1.2,
	roadClearanceMeters: 10,
	seatClearanceMeters: 100,
	shoreMarginMeters: 1.5,
	maxSlopeDegrees: 38,
});

function run180GrassRng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function run180GrassSegmentDistance(px, pz, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const lengthSq = dx * dx + dz * dz;
	if (!lengthSq) return Math.hypot(px - a.x, pz - a.z);
	const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lengthSq));
	return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

function run180GrassAllowed(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
	for (const seat of seats) {
		if (Math.hypot(x - seat.x, z - seat.z) < RUN180_WIND_GRASS_CONFIG.seatClearanceMeters) return false;
	}
	for (const edge of roadEdges) {
		for (let i = 1; i < edge.points.length; i++) {
			if (run180GrassSegmentDistance(x, z, edge.points[i - 1], edge.points[i]) < RUN180_WIND_GRASS_CONFIG.roadClearanceMeters) return false;
		}
	}
	const y = sampleHeightMeters(x, z);
	if (y <= seaLevelMeters + RUN180_WIND_GRASS_CONFIG.shoreMarginMeters) return false;
	const d = 4;
	const dx = sampleHeightMeters(x + d, z) - y;
	const dz = sampleHeightMeters(x, z + d) - y;
	return Math.atan2(Math.max(Math.abs(dx), Math.abs(dz)), d) * 180 / Math.PI <= RUN180_WIND_GRASS_CONFIG.maxSlopeDegrees;
}

/**
 * One grass patch's geometry, shared by every instance.
 *
 * **Why this was rebuilt (run 366).** The first version gave each blade a single flat rectangle — four
 * vertices, no taper — and put ten of them in a 4.5 m patch. At that spacing and that shape they never
 * merged into turf: each card read individually, and from an oblique angle the world looked like green
 * rectangles standing on the ground rather than grass. The owner saw exactly that in the editor.
 *
 * Three changes, all of them free: the geometry is instanced, so it is built once and reused by every
 * patch. Vertex count here costs nothing per instance.
 *
 *   1. **Crossed blades.** Each blade is now two quads at right angles, so it has presence from any
 *      viewing direction instead of vanishing edge-on and flashing broadside.
 *   2. **Tapered and bendable.** Height segments narrowing from base to tip, so a blade is a blade
 *      rather than a card, and the existing `run180Flex` wind term bends it along its length instead of
 *      shearing a rigid rectangle.
 *   3. **Denser, tighter patches.** 48 blades in a 2.2 m patch instead of 10 in 4.5 m — about thirty
 *      times the blades per square metre, which is what turns individual blades into ground cover.
 *
 * **Two things the §8.5 captures caught that reasoning had not.** Neither was visible from the code.
 *
 * *Radius is density.* The first pass fixed only the blade and left the patch budget spread over a
 * 350 m disc — good blades, still isolated, still bare ground between them. See the radius note in
 * `RUN180_WIND_GRASS_CONFIG`.
 *
 * *Width, not height, was making them read as spears.* At eye level the blades looked like reeds even
 * though 0.34-0.74 m is right for grass. The base half-width was 0.055-0.09, i.e. an 11-18 cm wide
 * blade — twenty-odd times life size — so each one read as a leaf. Narrowed to 4-7 cm, with the
 * triangle budget spent on twice as many blades (48 at two segments instead of 32 at three) rather than
 * on curvature nobody can see at 4 cm wide. Per-patch triangle count is unchanged at 384.
 *
 * Vertex colours carry a dark base to a lighter tip plus per-blade variation, so a patch reads as many
 * plants rather than one flat green mass.
 */
function run180GrassGeometry() {
	const positions = [];
	const indices = [];
	const flex = [];
	const phase = [];
	const colors = [];
	const count = RUN180_WIND_GRASS_CONFIG.bladesPerPatch;
	const radius = RUN180_WIND_GRASS_CONFIG.patchRadiusMeters;
	// Run 418: one segment, not two. A blade is 4-7 cm wide; the middle row bought a curve nobody can
	// resolve at that width and cost half the triangles in the whole system. Spending them on 50% more
	// blades instead takes a patch from 384 triangles to 288 and from 48 blades to 72.
	const SEGMENTS = 1;

	for (let i = 0; i < count; i++) {
		// Golden-angle placement, same as before — it spreads blades without clumping.
		const angle = i * 2.3999632297;
		const r = radius * Math.sqrt((i + 0.35) / count);
		const cx = Math.cos(angle) * r;
		const cz = Math.sin(angle) * r;
		// Shorter than run 366's 0.34-0.74 m. At the density this system can afford, a tall blade is a
		// blade you read individually; a short one disappears into the textured ground it stands on.
		const height = 0.22 + 0.26 * ((i * 37 % 101) / 100);
		const baseWidth = 0.021 + 0.013 * ((i * 53 % 97) / 96);
		// A slight lean per blade, so a patch does not look like a comb.
		const lean = ((i * 29 % 71) / 71 - 0.5) * 0.28;
		const tint = (i * 17 % 53) / 53;

		for (let quad = 0; quad < 2; quad++) {
			const bladeAngle = angle + quad * (Math.PI / 2);
			const sideX = Math.cos(bladeAngle + Math.PI / 2);
			const sideZ = Math.sin(bladeAngle + Math.PI / 2);
			const leanX = Math.cos(bladeAngle) * lean;
			const leanZ = Math.sin(bladeAngle) * lean;
			const base = positions.length / 3;

			for (let row = 0; row <= SEGMENTS; row++) {
				const t = row / SEGMENTS;
				// Width tapers to a point; the curve keeps the blade full near the ground.
				const halfWidth = baseWidth * (1 - t * t * 0.92);
				const y = height * t;
				const dx = cx + leanX * t * t;
				const dz = cz + leanZ * t * t;
				positions.push(dx - sideX * halfWidth, y, dz - sideZ * halfWidth);
				positions.push(dx + sideX * halfWidth, y, dz + sideZ * halfWidth);
				// Wind bends the blade along its length rather than shearing it rigidly.
				flex.push(t * t, t * t);
				phase.push(i / count, i / count);
				// Dark at the root, lit at the tip, with per-blade variation. Run 418 lightened and warmed
				// the whole ramp: the old green was far darker and more saturated than the ground it
				// stands on, so every gap between blades read as bare earth showing through and the
				// blades themselves read as dark shards. Grass that sits inside the terrain's own colour
				// disappears into it, which is the entire point of a fringe layer.
				const shade = 0.62 + 0.48 * t;
				const red = (0.30 + 0.13 * tint) * shade;
				const green = (0.47 + 0.17 * tint) * shade;
				const blue = (0.19 + 0.08 * tint) * shade;
				colors.push(red, green, blue);
				colors.push(red, green, blue);
			}
			for (let row = 0; row < SEGMENTS; row++) {
				const a = base + row * 2;
				indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setAttribute('run180Flex', new THREE.Float32BufferAttribute(flex, 1));
	geometry.setAttribute('run180Phase', new THREE.Float32BufferAttribute(phase, 1));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function run180PopulateGrass(mesh, params, cellX, cellZ) {
	const config = params.isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const seed = (params.seed ^ Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663) ^ 0x47524153) >>> 0;
	const random = run180GrassRng(seed);
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const position = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const centerX = cellX * config.cellMeters;
	const centerZ = cellZ * config.cellMeters;
	let placed = 0;
	for (let i = 0; i < config.maxPatches; i++) {
		for (let attempt = 0; attempt < 8; attempt++) {
			const angle = random() * Math.PI * 2;
			const radius = config.radiusMeters * Math.sqrt(random());
			const x = centerX + Math.cos(angle) * radius;
			const z = centerZ + Math.sin(angle) * radius;
			if (!run180GrassAllowed(x, z, params)) continue;
			position.set(x, params.sampleHeightMeters(x, z) + 0.03, z);
			quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
			// Run 418: blades shrink to nothing over the outer band of the disc. At 130 m the boundary
			// was past anything legible; at 55 m a hard rim of full-height grass would be a circle
			// following the player around, which is worse than no grass at all.
			const edgeStart = 1 - RUN180_WIND_GRASS_CONFIG.edgeFadeFraction;
			const edge01 = Math.min(1, Math.max(0, (radius / config.radiusMeters - edgeStart) / RUN180_WIND_GRASS_CONFIG.edgeFadeFraction));
			const uniformScale = (0.78 + random() * 0.47) * (1 - edge01 * edge01 * (3 - 2 * edge01));
			scale.set(uniformScale, uniformScale, uniformScale);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(placed++, matrix);
			break;
		}
	}
	mesh.count = placed;
	mesh.instanceMatrix.needsUpdate = true;
	if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
	mesh.userData.run180Cell = { x: cellX, z: cellZ };
	return placed;
}

export function createWindGrassRun180({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass = false, centerX = 0, centerZ = 0 }) {
	const config = isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const geometry = run180GrassGeometry();
	// Vertex colours carry the root-to-tip shading the geometry writes, so the material stays neutral
	// white rather than flattening every blade to one green.
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
	const mesh = new THREE.InstancedMesh(geometry, material, config.maxPatches);
	mesh.name = 'run180-wind-grass';
	const group = new THREE.Group();
	group.name = 'wind-grass';
	const params = { sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass };
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	mesh.userData.run180FirstFrameSafe = true;
	material.userData.run180WindGrass = Object.freeze({ key: 'run180-wind-grass-v1', radiusMeters: config.radiusMeters, maxPatches: config.maxPatches, bladesPerPatch: RUN180_WIND_GRASS_CONFIG.bladesPerPatch });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uRun180WindTime = { value: 0 };
		shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uRun180WindTime;\nattribute float run180Flex;\nattribute float run180Phase;\nvarying float vRun180GrassVariation;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvec2 run180XZ=instanceMatrix[3].xz;\nfloat run180P=dot(run180XZ,vec2(0.021,0.017))+run180Phase*6.2831853;\nfloat run180Wave=sin(uRun180WindTime*1.05+run180P)+0.35*sin(uRun180WindTime*2.15+run180P*1.73);\ntransformed.xz+=vec2(0.78,0.62)*run180Wave*run180Flex*run180Flex*0.24;\nvRun180GrassVariation=fract(sin(dot(run180XZ,vec2(12.9898,78.233)))*43758.5453);');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRun180GrassVariation;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(0.84,1.10,vRun180GrassVariation);');
		material.userData.run180Shader = shader;
	};
	material.customProgramCacheKey = () => 'run180-wind-grass-v1';
	const initialX = Math.round(centerX / config.cellMeters);
	const initialZ = Math.round(centerZ / config.cellMeters);
	let placed = run180PopulateGrass(mesh, params, initialX, initialZ);
	mesh.onBeforeRender = (_renderer, _scene, camera) => {
		const shader = material.userData.run180Shader;
		if (shader) shader.uniforms.uRun180WindTime.value = performance.now() * 0.001;
		const cellX = Math.round(camera.position.x / config.cellMeters);
		const cellZ = Math.round(camera.position.z / config.cellMeters);
		if (cellX !== mesh.userData.run180Cell.x || cellZ !== mesh.userData.run180Cell.z) {
			placed = run180PopulateGrass(mesh, params, cellX, cellZ);
			group.userData.run180WindGrass.placedCount = placed;
			group.userData.run180WindGrass.centerCell = { x: cellX, z: cellZ };
		}
	};
	group.add(mesh);
	group.userData.run180WindGrass = { active: true, isMobileClass, placedCount: placed, maxPatches: config.maxPatches, radiusMeters: config.radiusMeters, centerCell: { x: initialX, z: initialZ } };
	return { group, mesh };
}
