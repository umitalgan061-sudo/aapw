/**
 * Shipped full-owner-map terrain source.
 *
 * The historical seeded FBM field is no longer production height authority. Every renderer,
 * collider, river, road, settlement and vegetation consumer already imports this module, so the
 * module itself now projects world coordinates onto the canonical 9000x7000 owner map and derives
 * one deterministic height from the source-anchored Pindex V2 surface, biome and relief fields.
 * GeoCell/Pindex grids remain classification/addressing inputs only; no cell edge is a height term.
 * @module world/terrain
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import { sampleReferencePindexQualityV2 } from './worldReferenceSurfacePindexes.js';
import { sampleWorldReferenceMountainReliefMeters } from './worldReferenceMountainRelief.js';
import { coastWarpOffsets, reliefDetailMeters } from './terrainReliefDetail.js';
import { continentalUpliftMeters } from './terrainContinentalUplift.js';
import { valyriaUpliftMeters, applyValyriaSurface, valyriaInfluence01 } from './worldReferenceValyria.js';
import { createTerrainChunkSkirt, disposeTerrainChunkSkirt } from './terrainChunkSkirt.js';
import {
	TERRAIN_MICRO_SURFACE_POLICY,
	terrainMicroUvAt,
	getSharedTerrainMicroSurfaceTextures,
	applyTerrainMicroSurface,
} from './terrainMicroSurface.js';
import {
	TERRAIN_BIOME_SHADING_POLICY,
	NEUTRAL_DETAIL_GAIN,
	resolveTerrainBiomeColor,
	slopeDegreesFromNeighbours,
	buildNeutralDetailCanvas,
	buildFlatNeutralCanvas,
} from './terrainBiomeShading.js';
import {
	applyGroundRealism,
	curvatureMetersFromNeighbours,
	sunExposure01FromNeighbours,
} from './terrainGroundRealism.js';

// Re-exported so the micro-surface extraction stays invisible to every existing importer and check.
export { TERRAIN_MICRO_SURFACE_POLICY, terrainMicroUvAt, getSharedTerrainMicroSurfaceTextures, applyTerrainMicroSurface };

export const DEFAULT_MAX_HEIGHT_METERS = 24; // compatibility only; production height is map-derived.
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const MAP_WIDTH = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const MAP_HEIGHT = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
/**
 * The Lands of Always Winter — snow laid on the far north by latitude, on top of the canonical mask.
 *
 * The mask carries `snow` only on the glacier cells, so land around and north of the Wall read as
 * `soil` and rendered bright green — at nx 0.175 the northern transect had snowWeight 0 and a
 * (50,78,12) green, the defect the owner reported. The Wall is at ny ~0.16 (`world/theWall.js`) and
 * all north of it is ice, so snow comes from latitude, fading over the Gift so the North proper
 * (Winterfell, ny ~0.285) keeps its cold grassland.
 *
 * **Visual/vegetation snow weight only — never the height terms**, which `snowWeight` also feeds
 * (`+ snowWeight * 12`, relief detail): latitude there would raise the whole north and invalidate
 * every seat, road and skirt measurement. `scripts/checkNorthernIce.js` guards that.
 */
// `fadeNy` 0.30 is map.png's own tail: land whiteness 0.86 at ny 0.04, 0.63 at the Wall, 0.10 at 0.28.
const NORTHERN_SNOW = Object.freeze({ fullNy: 0.15, fadeNy: 0.30 });
const northernLatitudeSnow = (ny) => {
	const t = clamp01((ny - NORTHERN_SNOW.fullNy) / (NORTHERN_SNOW.fadeNy - NORTHERN_SNOW.fullNy));
	return 1 - t * t * (3 - 2 * t); // smoothstep, inlined: its only caller
};

/** Deterministic PRNG retained for roads/rivers and other established callers. */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function random() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const PROTECTED_SEAT_MAP_POINTS = Object.freeze([
	[3885, 5370], [1525, 1750], [1185, 4040], [1095, 4040], [1145, 3990], [1750, 3580], [2100, 3270],
	[1610, 4560], [920, 2900], [1850, 2790], [1650, 1060], [1050, 3360], [6190, 5140], [1400, 300],
]);
const PROTECTED_SEATS = Object.freeze(PROTECTED_SEAT_MAP_POINTS.map(([mapX, mapY]) => Object.freeze({
	x: mapX / MAP_WIDTH,
	y: mapY / MAP_HEIGHT,
})));
const PROTECTION_RADII = referenceProtectionRadiiFromMeters(75, WORLD_SCALE.METERS_PER_MAP_UNIT);

/**
 * Radius around each kingdom seat inside which the coast warp and relief detail
 * (`world/terrainReliefDetail.js`) are faded out, so a seat and its road approaches keep the exact
 * canonical geography the owner map places them on.
 *
 * Sized from a measured failure, not guessed: at full strength the warp pushed Dragonstone's cell
 * into water (its raw height fell 32.2 m -> 7.25 m, the seat-protection floor) while the Eyrie rose to
 * 62.8 m, and the resulting 55 m drop over 1.5 km took the `stannis -> robin` road to 32.6 deg — past
 * `scripts/roadNetworkSafetyCheck.js`'s 20 deg ceiling. 650 m covers a seat's own terrain and the
 * first stretch of every road leaving it, which is where grade ceilings actually bite.
 */
const RELIEF_TAPER_RADII = referenceProtectionRadiiFromMeters(650, WORLD_SCALE.METERS_PER_MAP_UNIT);

/**
 * 0 at a kingdom seat (fully canonical terrain), 1 well away from every seat (full added detail).
 * @param {number} nx
 * @param {number} ny
 * @returns {number}
 */
function seatDetailTaper(nx, ny) {
	let nearest = Infinity;
	for (const seat of PROTECTED_SEATS) {
		const dx = (nx - seat.x) / RELIEF_TAPER_RADII.x;
		const dy = (ny - seat.y) / RELIEF_TAPER_RADII.y;
		const distance = Math.hypot(dx, dy);
		if (distance < nearest) nearest = distance;
		if (nearest <= 0.35) return 0;
	}
	const t = clamp01((nearest - 0.35) / 0.65);
	return t * t * (3 - 2 * t);
}

export const CURRENT_TERRAIN_POLICY = Object.freeze({
	id: 'westeros-full-owner-map-current-terrain-2026-08-15-v1',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	fullOwnerMapCoverage: true,
	legacyProceduralFallback: false,
	mapDerivedHeight: true,
});

/**
 * Asset-first terrain material policy. `overlay.png` is the authored diffuse source referenced by
 * the repository's `assets/textures/yüzey/model.mtl`; it is not used as a new geography authority.
 * Geography, shoreline, relief and gameplay height remain sourced exclusively from map.png-derived
 * terrain data above. The image is projected once over that same owner-map canvas so chunk borders
 * share identical UVs and never expose a repeated tile grid.
 *
 * **Role narrowed (v2).** This asset used to supply the terrain's colour outright, multiplied by a
 * flat `sourceDiffuseFactor` grey. Measuring it showed why the world read as one uniform dark green
 * from shoreline to summit: the image is a saturated green photographic texture (mean saturation
 * 0.42), and grey x that green lands near a linear albedo of (0.015, 0.031, 0.011) everywhere. It is
 * now neutralised at load into a unit-mean luminance multiplier, so it still owns surface *detail*
 * while `world/terrainBiomeShading.js` owns hue per vertex. The asset, its UV projection and its
 * relationship to canonical geography are otherwise unchanged.
 */
export const CURRENT_TERRAIN_ALBEDO_POLICY = Object.freeze({
	id: 'owner-map-aligned-authored-terrain-detail-2026-08-19-v2',
	supersedes: 'owner-map-aligned-authored-terrain-albedo-2026-08-17-v1',
	sourceMapSha256: CURRENT_TERRAIN_POLICY.sourceMapSha256,
	assetPath: 'assets/textures/yüzey/overlay/overlay.png',
	sourceMaterialPath: 'assets/textures/yüzey/model.mtl',
	sourceMeshPath: 'assets/textures/yüzey/model.obj',
	/** Retained for provenance: the flat multiplier this asset was applied through before the role
	 * split. No longer read by any shading path — hue now comes from the per-vertex biome colour. */
	legacySourceDiffuseFactor: 0.588,
	role: 'neutralised-luminance-detail-multiplier',
	hueAuthority: TERRAIN_BIOME_SHADING_POLICY.id,
	mapping: 'full-owner-map-global-uv',
	wrap: 'clamp-to-edge',
	mobileFallback: 'canonical-vertex-color',
	terrainHeightAuthority: CURRENT_TERRAIN_POLICY.id,
});


function currentMapPoint(worldX, worldZ) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const rawMapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const rawMapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	return Object.freeze({
		nx: clamp01(rawMapX / MAP_WIDTH),
		ny: clamp01(rawMapY / MAP_HEIGHT),
		insideOwnerMap: rawMapX >= 0 && rawMapX <= MAP_WIDTH && rawMapY >= 0 && rawMapY <= MAP_HEIGHT,
	});
}

/**
 * Stable map-space UV query shared by terrain chunks and visual QA. V is flipped because image UV
 * origin is bottom-left while the canonical map canvas is addressed top-down.
 */
export function terrainMapUvAt(worldX, worldZ) {
	const point = currentMapPoint(worldX, worldZ);
	return Object.freeze({ u: point.nx, v: 1 - point.ny, insideOwnerMap: point.insideOwnerMap });
}

function canonicalMicroSignal(nx, ny) {
	return 0.50 * Math.sin(TAU * (nx * 13 + ny * 17) + 0.31)
		+ 0.30 * Math.cos(TAU * (nx * 29 - ny * 11) + 1.13)
		+ 0.20 * Math.sin(TAU * (nx * 41 + ny * 37) + 2.07);
}

/**
 * @param {number} worldX
 * @param {number} worldZ
 * @param {{rockWeight: number, snowWeight: number, waterWeight: number}} [outSurface] Optional
 *   caller-owned scratch object filled with the canonical surface weights this height was derived
 *   from. Purely additive: the returned height is bit-identical whether or not it is passed, and no
 *   extra `sampleReferencePindexQualityV2` call is made — the weights are already computed here.
 *   Exists so `createTerrainChunk` can shade a vertex without paying for a second canonical sample
 *   (see `world/terrainBiomeShading.js`); an out-parameter rather than a returned object keeps this
 *   function allocation-free for its hot callers (physics, roads, rivers).
 * @returns {number} Height in metres.
 */
function sampleCanonicalHeightMeters(worldX, worldZ, outSurface) {
	const { nx, ny } = currentMapPoint(worldX, worldZ);
	// Coastline domain-warp: the canonical mask is read at a displaced coordinate so its 96x64 cell
	// grid stops surfacing as a ~138 m rectangular staircase along every shore. The mask's own
	// land/sea decisions are untouched — only where each is read from. See `world/terrainReliefDetail.js`.
	const detailTaper = seatDetailTaper(nx, ny);
	const warp = coastWarpOffsets(nx, ny);
	const wx = clamp01(nx + warp.du * detailTaper);
	const wy = clamp01(ny + warp.dv * detailTaper);
	const sample = sampleReferencePindexQualityV2(wx, wy);
	const seaWeight = clamp01(sample.surfaceWeights.sea ?? 0);
	const lakeWeight = clamp01(sample.surfaceWeights.lake ?? 0);
	const waterWeight = clamp01(seaWeight + lakeWeight);
	const rockWeight = clamp01(sample.surfaceWeights.rock ?? 0);
	const snowWeight = clamp01(sample.surfaceWeights.snow ?? 0);
	const micro = canonicalMicroSignal(nx, ny) * (0.45 + sample.microAmplitude * 12);
	const mountainMeters = sampleWorldReferenceMountainReliefMeters(worldX, worldZ);

	// Continental uplift: inland ground stands hundreds of metres above its own coast, the way a real
	// landmass does. Zero at the waterline by construction, so the canonical coastline from map.png is
	// not displaced by a single metre — see `world/terrainContinentalUplift.js`.
	// Deliberately NOT tapered around seats, unlike the relief detail above. Tapering was tried and
	// measured worse: zeroing uplift in a 650 m disc while the surrounding land keeps climbing builds a
	// steep rim around every seat, and it pushed a fourth road edge (`doran -> ziya`) past the ceiling
	// at 25.6 deg. A smooth continental field must stay smooth.
	const upliftMeters = continentalUpliftMeters(wx, wy);
	const dryRelative = 1.0
		+ upliftMeters
		+ sample.reliefInfluence * 28
		+ sample.biomeInfluence * 7
		+ rockWeight * 8
		+ snowWeight * 12
		+ mountainMeters
		+ micro;
	const wetRelative = -3.0 - waterWeight * 5.25 - sample.reliefInfluence * 0.75 + micro * 0.12;
	let heightMeters = SEA_LEVEL + lerp(dryRelative, wetRelative, waterWeight);

	// Multi-octave land relief: gentle undulation on the plains, ridged crags on the canonical
	// mountain chains. Amplitude-gated so it cannot breach the road-grade or seat-walkability
	// ceilings — see `world/terrainReliefDetail.js`. Added before the seat-protection clamp below so
	// a protected seat still wins over it.
	heightMeters += reliefDetailMeters(wx, wy, {
		heightAboveSeaMeters: heightMeters - SEA_LEVEL,
		reliefInfluence: sample.reliefInfluence,
		rockWeight,
		snowWeight,
		waterWeight,
	}) * detailTaper;

	// Run 372 / ADR-0319 — the Doom of Valyria. Applied after the relief detail and before the
	// seat-protection clamp, on the same footing as every other land-shaping term. It returns 0 off the
	// Valyrian peninsula and 0 at or below the waterline, so the Smoking Sea keeps its shape and no
	// coastline moves; see `world/worldReferenceValyria.js` for the map reading it is built on.
	heightMeters += valyriaUpliftMeters(nx, ny, heightMeters - SEA_LEVEL) * detailTaper;

	// Keep the Pindex V2 coastal blend continuous. `rawWater` is a semantic QA bit and must not
	// reintroduce a binary height cliff after the continuous surface weights have been evaluated.
	const hydrology = sampleSeatSafeReferenceHydrology(nx, ny, PROTECTED_SEATS, PROTECTION_RADII);
	if (hydrology.protectedLand) {
		const minimumLand = SEA_LEVEL + 0.35 + hydrology.protectedLandWeight * 0.9;
		heightMeters = Math.max(heightMeters, minimumLand);
	}
	if (outSurface) {
		outSurface.rockWeight = rockWeight;
		// Far-north latitude snow over the mask's glaciers — land only, so the sea keeps its colour, and
		// applied here rather than above so it never reaches the height. See `NORTHERN_SNOW`.
		outSurface.snowWeight = waterWeight >= 0.5 ? snowWeight : Math.max(snowWeight, northernLatitudeSnow(ny));
		outSurface.waterWeight = waterWeight;
	}
	return heightMeters;
}

function flattenWeight(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
	if (distanceMeters <= innerRadiusMeters) return 1;
	if (distanceMeters >= outerRadiusMeters) return 0;
	const t = 1 - (distanceMeters - innerRadiusMeters) / (outerRadiusMeters - innerRadiusMeters);
	return t * t * (3 - 2 * t);
}

/**
 * Shared render/physics height sampler. `seed`, `fbmOptions` and `maxHeightMeters` remain accepted
 * for API compatibility, but do not alter the canonical production terrain.
 *
 * @param {*} _seed
 * @param {*} _fbmOptions
 * @param {{x: number, z: number, innerRadiusMeters: number, outerRadiusMeters: number, anchorHeightMeters: number}[]} [flattenPads]
 * @param {{sampleValleyHeight: (x: number, z: number, naturalHeightMeters: number) => number}} [valleyField]
 *   Optional river valley carve from `world/terrainValleyCarving.js` (ADR-0307). Applied *before*
 *   settlement pads and the road bed — it is natural landform, not a gameplay override.
 * @param {{sampleCorridorHeight: (x: number, z: number, baseHeightMeters: number) => number}} [roadCorridor]
 *   Optional road cut-and-fill bed from `world/roadCorridorSmoothing.js` (ADR-0304). Applied *after*
 *   settlement pads, because a road approaching a castle must end up on the castle's pad height rather
 *   than carving through it. Passed in rather than imported so this module keeps no dependency on the
 *   road system — terrain does not know what a road is, it is only told where the ground was rebuilt.
 */
export function createHeightSampler(_seed, _fbmOptions, flattenPads = [], roadCorridor = null, valleyField = null) {
	return function sampleHeightMeters(worldX, worldZ, _maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS, outSurface) {
		const canonicalHeightMeters = sampleCanonicalHeightMeters(worldX, worldZ, outSurface);
		// River valleys (ADR-0307) come first, because they are part of the *natural* landscape rather
		// than a gameplay override: a castle's flatten pad and a road's cut-and-fill both still win over
		// the valley they sit in, which is the order those two layers already assume.
		const baseHeightMeters = valleyField
			? valleyField.sampleValleyHeight(worldX, worldZ, canonicalHeightMeters)
			: canonicalHeightMeters;
		let strongestWeight = 0;
		let strongestAnchorMeters = baseHeightMeters;
		for (const pad of flattenPads) {
			const distanceMeters = Math.hypot(worldX - pad.x, worldZ - pad.z);
			const weight = flattenWeight(distanceMeters, pad.innerRadiusMeters, pad.outerRadiusMeters);
			if (weight > strongestWeight) {
				strongestWeight = weight;
				strongestAnchorMeters = pad.anchorHeightMeters;
			}
		}
		const flattened = strongestWeight > 0
			? lerp(baseHeightMeters, strongestAnchorMeters, strongestWeight)
			: baseHeightMeters;
		return roadCorridor ? roadCorridor.sampleCorridorHeight(worldX, worldZ, flattened) : flattened;
	};
}

let sharedTerrainAlbedoTexture = null;
let sharedTerrainAlbedoLoadFailed = false;

function isCoarsePointerDevice() {
	return typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(pointer: coarse)').matches;
}

/** One app-lifetime texture shared by every desktop chunk; mobile keeps the proven lightweight path. */
export function getSharedTerrainAlbedoTexture() {
	if (typeof document === 'undefined' || isCoarsePointerDevice() || sharedTerrainAlbedoLoadFailed) return null;
	if (sharedTerrainAlbedoTexture) return sharedTerrainAlbedoTexture;

	const url = new URL('../../../assets/textures/yüzey/overlay/overlay.png', import.meta.url).href;
	const texture = new THREE.TextureLoader().load(
		url,
		(loaded) => {
			// The authored image is a saturated green photographic texture, not a neutral detail map
			// (measured: mean saturation 0.42 — see `TERRAIN_BIOME_SHADING_POLICY.measured.overlayPng`).
			// Converting it to a unit-mean luminance multiplier here is what lets the per-vertex biome
			// colour own hue while this asset keeps owning surface detail.
			try {
				loaded.image = buildNeutralDetailCanvas(loaded.image);
				loaded.userData.neutralisedDetail = true;
			} catch (error) {
				// Never leave the raw green image on a NoColorSpace sampler — it would be read as raw
				// linear data and tint the entire world. Flat neutral loses detail, keeps colour correct.
				console.warn('[terrain] neutral detail conversion failed, falling back to flat neutral', error);
				loaded.image = buildFlatNeutralCanvas();
				loaded.userData.neutralisedDetail = false;
			}
			loaded.needsUpdate = true;
		},
		undefined,
		() => {
			sharedTerrainAlbedoLoadFailed = true;
			texture.userData.loadFailed = true;
		},
	);
	texture.name = 'owner-map-authored-terrain-detail-neutralised';
	// Deliberately NOT sRGB: this texture carries a ratio, not a colour. See
	// `TERRAIN_BIOME_SHADING_POLICY.detailEncodePivot`.
	texture.colorSpace = THREE.NoColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = 4;
	texture.userData = {
		...texture.userData,
		terrainAlbedoPolicy: CURRENT_TERRAIN_ALBEDO_POLICY.id,
		repositoryAssetPath: CURRENT_TERRAIN_ALBEDO_POLICY.assetPath,
	};
	sharedTerrainAlbedoTexture = texture;
	return texture;
}

/**
 * Builds one chunk from the exact same sampler used by physics and gameplay.
 *
 * Vertex heights are produced by the identical call this function has always made, at the identical
 * world coordinates — the biome-shading pass added here is strictly additive and reads heights, never
 * writes them.
 *
 * **Slope without seams.** Colour now depends on local slope, which needs each vertex's four
 * neighbours. Edge vertices have no in-chunk neighbour, so this samples a one-vertex apron just
 * outside the chunk rather than falling back to a one-sided difference: a one-sided difference would
 * give the two chunks sharing an edge two different slopes for the same ground and draw a visible
 * colour seam along every chunk border. The apron costs `4 * (segments + 3) - 4` extra height samples
 * (264 at the default 64 segments — about 6% on top of the 4,225 vertex samples), and because both
 * neighbouring chunks sample the same world coordinates through the same deterministic field, a
 * shared vertex resolves to the same slope from either side.
 */
export function createTerrainChunk({ chunkX, chunkZ, size = 500, segments = 64, maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS, seed = 1, flattenPads = [], roadCorridor = null, valleyField = null }) {
	const sampleHeightMeters = createHeightSampler(seed, undefined, flattenPads, roadCorridor, valleyField);
	const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
	geometry.rotateX(-Math.PI / 2);
	const position = geometry.attributes.position;
	const uv = geometry.getAttribute('uv');
	const terrainAlbedo = getSharedTerrainAlbedoTexture();
	const colors = new Float32Array(position.count * 3);
	const microUvs = new Float32Array(position.count * 2);
	const blended = new THREE.Color();

	// Apron grid: the chunk's (segments+1)^2 vertices ringed by one extra row/column on every side.
	// Apron index (ai, aj) maps to vertex index (ai-1, aj-1); the ring is filled after the vertex pass.
	const spacingMeters = size / segments;
	const apronCount = segments + 3;
	const apronHeights = new Float32Array(apronCount * apronCount);
	const apronRock = new Float32Array(apronCount * apronCount);
	const apronSnow = new Float32Array(apronCount * apronCount);
	// The vertex grid is axis-aligned and regular, so a vertex's world X depends only on its column
	// and its world Z only on its row. Recording them per column/row lets the ring below be sampled at
	// exactly `vertexCoordinate +/- spacing`, keeping every coordinate derived from the real geometry
	// rather than re-derived arithmetic that could round differently.
	const columnWorldX = new Float64Array(segments + 1);
	const rowWorldZ = new Float64Array(segments + 1);
	const surfaceScratch = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
	const halfSize = size / 2;

	for (let index = 0; index < position.count; index += 1) {
		const localX = position.getX(index);
		const localZ = position.getZ(index);
		const worldX = chunkX * size + localX;
		const worldZ = chunkZ * size + localZ;
		const heightMeters = sampleHeightMeters(worldX, worldZ, maxHeightMeters, surfaceScratch);
		position.setY(index, heightMeters);
		const mapUv = terrainMapUvAt(worldX, worldZ);
		uv.setXY(index, mapUv.u, mapUv.v);
		const microUv = terrainMicroUvAt(worldX, worldZ);
		microUvs[index * 2] = microUv.u;
		microUvs[index * 2 + 1] = microUv.v;

		const column = Math.round((localX + halfSize) / spacingMeters);
		const row = Math.round((localZ + halfSize) / spacingMeters);
		columnWorldX[column] = worldX;
		rowWorldZ[row] = worldZ;
		const apronOffset = (row + 1) * apronCount + (column + 1);
		apronHeights[apronOffset] = heightMeters;
		apronRock[apronOffset] = surfaceScratch.rockWeight;
		apronSnow[apronOffset] = surfaceScratch.snowWeight;
	}

	// Ring pass: every apron cell outside the vertex grid, sampled one spacing beyond the real edge.
	const apronWorldX = (ai) => (ai === 0
		? columnWorldX[0] - spacingMeters
		: ai === apronCount - 1 ? columnWorldX[segments] + spacingMeters : columnWorldX[ai - 1]);
	const apronWorldZ = (aj) => (aj === 0
		? rowWorldZ[0] - spacingMeters
		: aj === apronCount - 1 ? rowWorldZ[segments] + spacingMeters : rowWorldZ[aj - 1]);
	for (let aj = 0; aj < apronCount; aj += 1) {
		const onHorizontalRing = aj === 0 || aj === apronCount - 1;
		for (let ai = 0; ai < apronCount; ai += 1) {
			if (!onHorizontalRing && ai !== 0 && ai !== apronCount - 1) continue;
			const apronOffset = aj * apronCount + ai;
			apronHeights[apronOffset] = sampleHeightMeters(apronWorldX(ai), apronWorldZ(aj), maxHeightMeters, surfaceScratch);
			apronRock[apronOffset] = surfaceScratch.rockWeight;
			apronSnow[apronOffset] = surfaceScratch.snowWeight;
		}
	}

	// Shading pass: slope from the apron, colour from `world/terrainBiomeShading.js`.
	for (let index = 0; index < position.count; index += 1) {
		const localX = position.getX(index);
		const localZ = position.getZ(index);
		const column = Math.round((localX + halfSize) / spacingMeters);
		const row = Math.round((localZ + halfSize) / spacingMeters);
		const apronOffset = (row + 1) * apronCount + (column + 1);
		const heightWest = apronHeights[apronOffset - 1];
		const heightEast = apronHeights[apronOffset + 1];
		const heightNorth = apronHeights[apronOffset - apronCount];
		const heightSouth = apronHeights[apronOffset + apronCount];
		const ownHeight = apronHeights[apronOffset];
		const slopeDegrees = slopeDegreesFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, spacingMeters);
		const heightAboveSeaMeters = ownHeight - SEA_LEVEL;
		const worldX = columnWorldX[column];
		const worldZ = rowWorldZ[row];
		resolveTerrainBiomeColor(blended, {
			heightAboveSeaMeters,
			slopeDegrees,
			rockWeight: apronRock[apronOffset],
			snowWeight: apronSnow[apronOffset],
			worldX,
			worldZ,
		});
		// Run 367 / ADR-0314 — drainage, aspect and scale hierarchy over the biome colour. Render-only:
		// the four neighbours are the same ones the slope above is measured from, so this adds no
		// sampling and touches no height authority. See `world/terrainGroundRealism.js`.
		const valyriaCurvature = curvatureMetersFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, ownHeight, spacingMeters);
		applyGroundRealism(blended, {
			// `spacingMeters` is this chunk's own vertex spacing, and it must be passed: curvature grows
			// with the stencil it is measured over, so a 32-segment chunk and a 128-segment one would
			// otherwise tint the ground they share four times differently and draw a seam along every LOD
			// band boundary. See `curvatureStencilMeters`.
			curvatureMeters: curvatureMetersFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, ownHeight, spacingMeters),
			sunExposure01: sunExposure01FromNeighbours(heightWest, heightEast, heightNorth, heightSouth),
			slopeDegrees,
			heightAboveSeaMeters,
			worldX,
			worldZ,
			// Bare rock and snow have no soil to be wet or dry, so the effect fades out where the biome
			// pass has already committed to them.
			soilCoverage01: 1 - Math.max(apronRock[apronOffset], apronSnow[apronOffset]) * 0.75,
		});
		// Run 372 / ADR-0319 — the Doom, over everything the biome and drainage passes decided. Basalt,
		// ash on the heights, and lava pooling in the same hollows drainage uses, which is why the
		// curvature above is reused rather than resampled.
		{
			const valyriaPoint = currentMapPoint(worldX, worldZ);
			applyValyriaSurface(blended, {
				nx: valyriaPoint.nx,
				ny: valyriaPoint.ny,
				heightAboveSeaMeters,
				curvatureMeters: valyriaCurvature,
			});
		}
		colors[index * 3] = blended.r;
		colors[index * 3 + 1] = blended.g;
		colors[index * 3 + 2] = blended.b;
	}

	position.needsUpdate = true;
	uv.needsUpdate = true;
	geometry.setAttribute('uv1', new THREE.BufferAttribute(microUvs, 2));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		map: terrainAlbedo,
		roughness: TERRAIN_MICRO_SURFACE_POLICY.roughnessBase,
		metalness: 0,
	});
	// The detail map stores a ratio around a mid-grey pivot, so the material carries the reciprocal
	// gain that restores a unit mean. Without a map there is nothing to compensate for.
	//
	// Recorded on `userData` as well as applied, because `world/worldReferenceSurfaceTerrainVisual.js`
	// re-runs over every chunk at load and used to reset `material.color` to flat white — which
	// silently halved the whole world's brightness once this gain existed. That module now restores
	// this value instead of assuming white.
	const terrainDetailGain = terrainAlbedo ? NEUTRAL_DETAIL_GAIN : 1;
	material.color.setScalar(terrainDetailGain);
	material.userData.terrainDetailGain = terrainDetailGain;
	applyTerrainMicroSurface(material);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	mesh.position.set(chunkX * size, 0, chunkZ * size);
	mesh.userData.chunkCoord = { x: chunkX, z: chunkZ };
	mesh.userData.areaKm2 = (size * size) / 1_000_000;
	mesh.userData.currentTerrainPolicy = CURRENT_TERRAIN_POLICY.id;
	mesh.userData.currentTerrainSingleSource = true;
	mesh.userData.currentTerrainAlbedo = Object.freeze({
		policyId: CURRENT_TERRAIN_ALBEDO_POLICY.id,
		assetPath: CURRENT_TERRAIN_ALBEDO_POLICY.assetPath,
		mapAlignedUv: true,
		textureEnabled: Boolean(terrainAlbedo),
		role: CURRENT_TERRAIN_ALBEDO_POLICY.role,
		detailGain: terrainAlbedo ? NEUTRAL_DETAIL_GAIN : 1,
		authoredColorFidelity: Boolean(terrainAlbedo),
		mobileFallback: isCoarsePointerDevice(),
	});
	mesh.userData.currentTerrainBiomeShading = Object.freeze({
		policyId: TERRAIN_BIOME_SHADING_POLICY.id,
		renderOnly: true,
		slopeAware: true,
		apronSampledSlope: true,
	});
	mesh.userData.currentTerrainMicroSurface = material.userData.terrainMicroSurface;
	// Crack skirt (DECISIONS.md ADR-0301). Carried as a child rather than extra vertices on the chunk
	// so this geometry's counts stay exactly 4225/24576 at 64 segments, which every terrain topology
	// contract asserts. Built last, from the finished geometry, so it inherits real heights and colours.
	const skirt = createTerrainChunkSkirt(geometry, { segments, size, roughness: material.roughness });
	if (skirt) {
		mesh.add(skirt);
		mesh.userData.currentTerrainChunkSkirt = skirt.userData.terrainChunkSkirt;
	}
	return mesh;
}

export function disposeTerrainChunk(chunkMesh) {
	for (const child of [...chunkMesh.children]) {
		if (!child.userData?.terrainChunkSkirt) continue;
		chunkMesh.remove(child);
		disposeTerrainChunkSkirt(child);
	}
	chunkMesh.geometry.dispose();
	// The albedo and micro normal/roughness textures are app-lifetime shared resources. Disposing a
	// single chunk must never invalidate texture maps still referenced by neighboring chunk materials.
	chunkMesh.material.dispose();
}
