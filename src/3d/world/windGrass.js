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
import { northernLatitudeSnow } from './terrain.js';
import { normalizedMapPoint } from './worldPropScatter.js';
import { sampleMapGroundColor } from './worldReferenceGroundColorField.js';

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
	//
	// Run 419 spends the card saving on reach and density at once: 64 triangles a patch instead of 288
	// pays for the full 4000/1200 patch allowance the contract permits, over a disc wide enough that
	// grass no longer stops a few strides away.
	desktop: Object.freeze({ radiusMeters: 80, maxPatches: 4000, cellMeters: 68 }),
	mobile: Object.freeze({ radiusMeters: 56, maxPatches: 1200, cellMeters: 48 }),
	/** Fraction of the radius over which cards shrink to nothing, so the disc has no visible rim. */
	edgeFadeFraction: 0.28,
	/** Crossed quads per patch. Each carries about twenty blades in its alpha channel. */
	cardsPerPatch: 16,
	/** What those cards add up to, for the render-contract record: cards x blades drawn per card. */
	bladesPerPatch: 16 * 22,
	patchRadiusMeters: 1.5,
	roadClearanceMeters: 10,
	seatClearanceMeters: 100,
	shoreMarginMeters: 1.5,
	maxSlopeDegrees: 38,
	/**
	 * Run 424 — no summer grass on snow.
	 *
	 * Run 423's northern capture (`artifacts/near-trees/north.png`) shows bright green blades growing
	 * out of deep snow, because this system checks water, roads, seats and slope and has never had any
	 * notion of climate. Two rules, matching the two ways ground turns white:
	 *
	 *   * **Latitude.** `world/terrain.js`'s `northernLatitudeSnow` is the same curve the terrain
	 *     shades itself with — full snow to ny 0.15, gone by 0.30 — so grass stops exactly where the
	 *     ground the player sees turns white, rather than at some second threshold that would drift
	 *     away from it.
	 *   * **Altitude.** Above the snowline nothing grows either, and 470 m is the figure
	 *     `world/worldPropScatter.js` already calls `snowlineMinHeightMeters`.
	 */
	snowLatitudeCeiling: 0.35,
	snowlineMinHeightMeters: 470,
	/**
	 * Run 449 — how far each card's colour is pulled toward the ground it stands on.
	 *
	 * Run 424 gave this system a notion of climate for *placement*; it still had none for *colour*. One
	 * green gradient is baked into the card texture and varied only ±8% per card, so grass is the same
	 * green everywhere. Measured over 646 land samples below the snowline, 313 of them — **48.5%** —
	 * stand on pale khaki ground (red ≈ green, blue below 0.85 × green): dry grassland like
	 * (0.73, 0.73, 0.60) and (0.64, 0.64, 0.44), against a card mid-tone of (0.46, 0.57, 0.29). The
	 * distance between grass and its own ground runs to a median of 0.365 and a p90 of 0.502 in unit
	 * RGB, which is what makes the blades read as dark green confetti scattered on pale steppe rather
	 * than as that steppe's own turf.
	 *
	 * Tinting toward the canonical ground colour fixes it without a second texture or a second draw
	 * call: `InstancedMesh` carries a per-instance colour that three.js multiplies into the same
	 * `vColor` the ±8% variation already rides on. The strength is a blend, not a match — grass pulled
	 * all the way to the ground colour stops being visible as grass at all. At 0.55 a khaki sample
	 * lands near (0.61, 0.66, 0.46), still greener than its ground, while grass already standing on
	 * green farmland moves by under 3% and is left alone.
	 */
	groundTintStrength: 0.55,
	/**
	 * The card texture's own mid-tone, midway along the baked gradient (root 78,104,50 → tip
	 * 156,186,100). The per-instance colour is a *multiplier*, so this is the value it multiplies
	 * against and the tint has to be solved relative to it rather than assigned absolutely.
	 */
	cardMidTone: Object.freeze({ r: 117 / 255, g: 145 / 255, b: 75 / 255 }),
	/**
	 * Clamp on that multiplier, per channel. The card's blue is only 0.29, so a ground blue of 0.60
	 * alone would ask for a 2.07× lift and wash the blades toward grey; bounding the ratio keeps an
	 * extreme ground colour from bleaching the grass instead of tinting it.
	 */
	groundTintMultiplierRange: Object.freeze({ min: 0.65, max: 1.6 }),
	/**
	 * Run 429 — how much of the tuft's shading normal splays outward from straight up.
	 *
	 * A grass card is a vertical quad, and `computeVertexNormals` gives a vertical quad a *horizontal*
	 * normal. With the sun overhead that is the one direction that catches no light at all, so every
	 * blade shades as an unlit wall. Near the camera it does not show, because the lit ground shows
	 * between the cards and the eye averages the two; at forty metres the cards close over the ground
	 * completely and all that is left is the wall. Measured on `artifacts/river-bank/bank-low.png`: the
	 * grass band reads 22 against 64 for the bare terrain a little further off — the same field, three
	 * times darker where it happens to be grassy.
	 *
	 * A grass canopy is not a wall. Seen from any distance it is a rough horizontal surface, lit from
	 * above like the ground it grows out of, which is why a meadow at noon is bright and not black.
	 * So the shading normal is built as a tuft instead: mostly up, splayed outward from the patch
	 * centre by this much, which keeps the near-field cards from all shading identically.
	 *
	 * Costs nothing — the normals are baked once into the shared patch geometry.
	 */
	tuftNormalSplay: 0.35,
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
	if (y - seaLevelMeters >= RUN180_WIND_GRASS_CONFIG.snowlineMinHeightMeters) return false;
	const { ny } = normalizedMapPoint(x, z);
	if (northernLatitudeSnow(ny) >= RUN180_WIND_GRASS_CONFIG.snowLatitudeCeiling) return false;
	const d = 4;
	const dx = sampleHeightMeters(x + d, z) - y;
	const dz = sampleHeightMeters(x, z + d) - y;
	return Math.atan2(Math.max(Math.abs(dx), Math.abs(dz)), d) * 180 / Math.PI <= RUN180_WIND_GRASS_CONFIG.maxSlopeDegrees;
}

/**
 * The blade-cluster texture every grass card carries, drawn once into a canvas.
 *
 * **Why a texture at all (run 419).** Run 418 measured the ceiling on geometric blades: 921,600
 * triangles bought 14 blades per square metre, and grassland is thousands. Every triangle spent on a
 * blade draws exactly one blade. A card draws about twenty for the price of two triangles, because the
 * blades live in the alpha channel instead of in the vertex buffer — which is how every engine that
 * renders convincing grass does it, and the only way this budget reaches a density that reads as turf.
 *
 * Deterministic by construction: an integer-free trig hash, the same family the terrain's own detail
 * atlas uses, so this canvas is byte-identical on every boot. `scripts/checkSeededRandomPolicy.js`
 * forbids `Math.random()` under `src/3d` and this obeys it.
 */
function run180GrassCardTexture() {
	const SIZE = 256;
	const BLADES = 22;
	const canvas = document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const context = canvas.getContext('2d');
	context.clearRect(0, 0, SIZE, SIZE);
	const hash = (n) => {
		const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
		return value - Math.floor(value);
	};
	for (let i = 0; i < BLADES; i += 1) {
		const rootX = SIZE * ((i + 0.5) / BLADES + (hash(i * 3.1) - 0.5) * 0.06);
		const height = SIZE * (0.52 + hash(i * 5.7) * 0.46);
		const lean = SIZE * (hash(i * 7.3) - 0.5) * 0.34;
		const halfWidth = SIZE * (0.010 + hash(i * 11.9) * 0.008);
		const tipY = SIZE - height;
		const controlX = rootX + lean * 0.45;
		const controlY = SIZE - height * 0.55;
		// A blade is drawn as its own outline: up one side on a curve, across the tip, back down the
		// other. Filling a stroked line instead would give a constant width and no taper.
		context.beginPath();
		context.moveTo(rootX - halfWidth, SIZE);
		context.quadraticCurveTo(controlX - halfWidth * 0.55, controlY, rootX + lean, tipY);
		context.quadraticCurveTo(controlX + halfWidth * 0.55, controlY, rootX + halfWidth, SIZE);
		context.closePath();
		// Dark at the root where light does not reach, brighter at the tip. Per-blade hue variation so a
		// card reads as many plants rather than one stencil repeated.
		const tint = hash(i * 13.7);
		const gradient = context.createLinearGradient(0, SIZE, 0, tipY);
		// Lightened after the first capture: at the original values the tufts read as dark bushes
		// scattered over pale ground. Grass that sits inside the terrain's own tone disappears into it,
		// which is the whole job of a fringe layer.
		gradient.addColorStop(0, `rgb(${Math.round(78 + tint * 20)}, ${Math.round(104 + tint * 24)}, ${Math.round(50 + tint * 16)})`);
		gradient.addColorStop(1, `rgb(${Math.round(156 + tint * 36)}, ${Math.round(186 + tint * 30)}, ${Math.round(100 + tint * 28)})`);
		context.fillStyle = gradient;
		context.fill();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	texture.needsUpdate = true;
	return texture;
}

/**
 * One grass patch's geometry, shared by every instance.
 *
 * **The history this replaces.** Run 180 gave each blade one flat untapered rectangle and put ten of
 * them in a 4.5 m patch; from an oblique angle the world looked like green rectangles standing on the
 * ground. Run 366 made each blade two crossed tapered quads, 48 to a 2.2 m patch, and pulled the disc
 * in from 350 m to 130 m after captures showed that radius *is* density. Run 418 measured what that
 * had actually cost — 1,536,000 triangles, 56% of the whole frame — for 3.6 blades per square metre,
 * and cut it to 921,600 for 14.
 *
 * **Run 419 stops paying per blade.** Each card is one quad carrying
 * `run180GrassCardTexture()`'s twenty-odd blades in its alpha channel, crossed with a second quad at
 * right angles so it has presence from any direction. Sixteen crossed cards is 64 triangles a patch
 * against run 418's 288, and roughly 290 apparent blades against 72 — a quarter of the triangles for
 * four times the grass. Alpha *test*, not blending: no sorting, no transparency pass, and grass can
 * still write depth like any opaque surface.
 *
 * Vertex colours are now a mild per-card tint only. The root-to-tip shading that used to live in them
 * is in the texture, where it belongs, and where it costs nothing per vertex.
 */
function run180GrassGeometry() {
	const positions = [];
	const indices = [];
	const flex = [];
	const phase = [];
	const colors = [];
	const uvs = [];
	const count = RUN180_WIND_GRASS_CONFIG.cardsPerPatch;
	const radius = RUN180_WIND_GRASS_CONFIG.patchRadiusMeters;

	for (let i = 0; i < count; i += 1) {
		// Golden-angle placement, same as every version before it — it spreads cards without clumping.
		const angle = i * 2.3999632297;
		const r = radius * Math.sqrt((i + 0.35) / count);
		const cx = Math.cos(angle) * r;
		const cz = Math.sin(angle) * r;
		const width = 0.40 + 0.20 * ((i * 37 % 101) / 100);
		const height = 0.30 + 0.22 * ((i * 53 % 97) / 96);
		const tint = (i * 17 % 53) / 53;
		// Near white: the texture carries the colour, so this only keeps one card from being the exact
		// twin of the next.
		const red = 0.90 + 0.16 * tint;
		const green = 0.92 + 0.14 * tint;
		const blue = 0.86 + 0.18 * tint;

		for (let quad = 0; quad < 2; quad += 1) {
			const cardAngle = angle + quad * (Math.PI / 2);
			const sideX = Math.cos(cardAngle + Math.PI / 2) * width * 0.5;
			const sideZ = Math.sin(cardAngle + Math.PI / 2) * width * 0.5;
			const base = positions.length / 3;
			for (let row = 0; row <= 1; row += 1) {
				const y = height * row;
				positions.push(cx - sideX, y, cz - sideZ);
				positions.push(cx + sideX, y, cz + sideZ);
				uvs.push(0, row, 1, row);
				// Wind moves the top edge and leaves the roots planted.
				flex.push(row, row);
				phase.push(i / count, i / count);
				colors.push(red, green, blue, red, green, blue);
			}
			indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setAttribute('run180Flex', new THREE.Float32BufferAttribute(flex, 1));
	geometry.setAttribute('run180Phase', new THREE.Float32BufferAttribute(phase, 1));
	geometry.setIndex(indices);
	// Run 429: tuft normals, not quad normals. `computeVertexNormals` would give these vertical cards
	// horizontal normals and the field would shade as a wall — see `tuftNormalSplay` for the
	// measurement and the reason. Each vertex leans up, splayed outward from the patch centre.
	const splay = RUN180_WIND_GRASS_CONFIG.tuftNormalSplay;
	const normals = new Float32Array(positions.length);
	for (let v = 0; v < positions.length; v += 3) {
		const outX = positions[v] * splay;
		const outZ = positions[v + 2] * splay;
		const length = Math.hypot(outX, 1, outZ);
		normals[v] = outX / length;
		normals[v + 1] = 1 / length;
		normals[v + 2] = outZ / length;
	}
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	return geometry;
}

/**
 * The per-instance colour for a card at `x, z` — a multiplier that pulls the baked green toward the
 * canonical ground colour there. See `groundTintStrength` for the measurement behind it.
 *
 * Pure: `sampleMapGroundColor` is a function of position alone, so two builds of the same cell produce
 * identical tints, the same way the instance matrices already do (GOVERNANCE §8.9).
 *
 * @param {THREE.Color} target Written in place and returned.
 * @param {number} x
 * @param {number} z
 * @returns {THREE.Color}
 */
function run180GroundTint(target, x, z) {
	const { cardMidTone, groundTintStrength, groundTintMultiplierRange } = RUN180_WIND_GRASS_CONFIG;
	const { nx, ny } = normalizedMapPoint(x, z);
	sampleMapGroundColor(target, nx, ny);
	const channel = (ground, card) => {
		// Blend toward the ground, then express that as the multiplier the card has to be scaled by.
		const blended = card + (ground - card) * groundTintStrength;
		const ratio = card > 1e-4 ? blended / card : 1;
		return Math.min(groundTintMultiplierRange.max, Math.max(groundTintMultiplierRange.min, ratio));
	};
	target.setRGB(
		channel(target.r, cardMidTone.r),
		channel(target.g, cardMidTone.g),
		channel(target.b, cardMidTone.b),
	);
	return target;
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
	const tint = new THREE.Color();
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
			mesh.setColorAt(placed, run180GroundTint(tint, x, z));
			mesh.setMatrixAt(placed++, matrix);
			break;
		}
	}
	mesh.count = placed;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
	mesh.userData.run180Cell = { x: cellX, z: cellZ };
	return placed;
}

export function createWindGrassRun180({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, isMobileClass = false, centerX = 0, centerZ = 0 }) {
	const config = isMobileClass ? RUN180_WIND_GRASS_CONFIG.mobile : RUN180_WIND_GRASS_CONFIG.desktop;
	const geometry = run180GrassGeometry();
	// The blades live in the card texture's alpha, and `alphaTest` cuts them out per fragment. Alpha
	// *test*, not `transparent: true`: a transparent grass field would need back-to-front sorting on
	// thousands of instances every frame and would stop writing depth, so anything behind it would draw
	// through. This way grass stays an ordinary opaque surface that happens to have holes in it.
	const cardTexture = run180GrassCardTexture();
	const material = new THREE.MeshStandardMaterial({
		map: cardTexture,
		alphaTest: 0.4,
		vertexColors: true,
		roughness: 1,
		metalness: 0,
		side: THREE.DoubleSide,
	});
	// `Material.dispose()` does not touch its textures, and every teardown path here goes through the
	// material — so the canvas would outlive the world it was built for without this.
	material.addEventListener('dispose', () => cardTexture.dispose());
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
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRun180GrassVariation;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(0.84,1.10,vRun180GrassVariation);')
			// Run 429, and the tuft normals are worth nothing without it. The cards are DoubleSide, so
			// three.js flips the shading normal on whichever side faces away from you — and half the
			// cards in a crossed pair always do. That flip would point the new up-leaning normal at the
			// ground and hand back exactly the unlit wall it was built to get rid of. A blade has no
			// underside that the sky does not reach, same as the river sheet in run 428.
			.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal.y=abs(normal.y);');
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
