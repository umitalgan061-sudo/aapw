/**
 * Unified, seam-free micro-surface detail for all ten canonical owner-map pindexes.
 *
 * This supersedes the nine per-pindex copies (`worldReferencePindex01Detail.js` ..
 * `worldReferencePindex09Detail.js`) with one parameterized layer, and completes the pass by
 * covering Pindex-10. Those nine modules are left in place and untouched; nothing imports them
 * from here. The five defects this layer exists to fix were each measured before it was written:
 *
 *   1. **Longitudinal amplitude seams.** The nine tuned tables differ per strip (soil runs 0.060
 *      at Pindex-01 down to 0.034 at Pindex-09), and each strip applied its own table with a hard
 *      cut at the boundary. That put nine north-south discontinuities across the map. Amplitude is
 *      now interpolated with a quintic fade across a +/-0.008 normalized-X band at each boundary,
 *      making it C1-continuous end to end. Strip centres keep their approved values exactly.
 *
 *   2. **Cells that straddle a boundary.** 96 mask columns do not divide into 10 strips, so
 *      columns 9, 19, 28, 38, 57, 67, 76 and 86 physically span two pindexes and had two different
 *      amplitudes inside one cell. Boundary blending removes that too.
 *
 *   3. **White-noise grain.** `sin(dot)*43758` measured a lag-1 autocorrelation of 0.0405 at one
 *      sample per mask cell — statistically indistinguishable from static. Replaced with coherent
 *      fBm value noise from `worldReferenceBaseFieldHD.js`, which measures 0.767 at the same rate.
 *
 *   4. **Staircase edges.** One mask cell covers 16x16 source pixels, so every surface boundary
 *      rendered as hard 16-pixel steps — 927 of 6144 cells sit on a land/water interface alone.
 *      Shading now crossfades across *every* interface (soil/rock and rock/snow as well as the
 *      coastline) using bilinear per-class weights, which are one-hot at every cell centre — so the
 *      canonical classification is shaded faithfully and only the space *between* centres blends.
 *
 *   5. **Per-call BigInt decoding.** Classification went through a 288-bit BigInt hex parse per
 *      vertex (~470 ns). This layer reads the decoded table instead (~50 ns, ~9x).
 *
 * Idempotency: output colour is a pure function of world position. The layer derives its base
 * colour from the canonical semantic palette rather than from whatever is currently in the colour
 * attribute, so applying it twice — or applying it after the nine legacy layers — yields the exact
 * same result instead of compounding darkening.
 *
 * Additive boundary: owns no geometry and allocates no material. It writes the existing colour
 * attribute of meshes it is handed, exactly as the legacy detail layers did.
 *
 * @module world/worldReferencePindexDetailHD
 */

import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { WORLD_REFERENCE_SURFACE_VISUAL_POLICY } from './worldReferenceSurfaceTerrainVisual.js';
import {
	sampleBaseSurfaceFast,
	sampleMicroDetailSigned,
	sampleSurfaceWeights,
} from './worldReferenceBaseFieldHD.js';

/**
 * Per-pindex amplitudes carried forward verbatim from the nine approved per-pindex ADRs
 * (ADR-RUN277/278/281/282/292/293/294/295/296), plus a Pindex-10 entry continuing that tuned
 * progression. Pindex-10 was surveyed before the values were chosen: 316 sea, 232 soil, 92 rock,
 * 0 lake, 0 snow — rock-bearing, snow-free, so its rock amplitude is meaningful and its snow
 * amplitude is carried only for completeness.
 *
 * NOTE: the west-to-east decline in these numbers is an artefact of the order the strips were
 * authored in, not a property of the terrain. Keeping it is the conservative choice and is logged
 * as an open owner question rather than silently re-levelled here.
 */
export const PINDEX_HD_AMPLITUDES = Object.freeze([
	Object.freeze({ pindex: 1, sea: 0.015, lake: 0.015, soil: 0.06, rock: 0.05, snow: 0.025 }),
	Object.freeze({ pindex: 2, sea: 0.012, lake: 0.012, soil: 0.055, rock: 0.065, snow: 0.03 }),
	Object.freeze({ pindex: 3, sea: 0.01, lake: 0.01, soil: 0.05, rock: 0.06, snow: 0.025 }),
	Object.freeze({ pindex: 4, sea: 0.009, lake: 0.009, soil: 0.045, rock: 0.045, snow: 0.02 }),
	Object.freeze({ pindex: 5, sea: 0.008, lake: 0.008, soil: 0.043, rock: 0.043, snow: 0.02 }),
	Object.freeze({ pindex: 6, sea: 0.0075, lake: 0.0075, soil: 0.04, rock: 0.04, snow: 0.018 }),
	Object.freeze({ pindex: 7, sea: 0.007, lake: 0.007, soil: 0.038, rock: 0.048, snow: 0.022 }),
	Object.freeze({ pindex: 8, sea: 0.0065, lake: 0.0065, soil: 0.036, rock: 0.046, snow: 0.02 }),
	Object.freeze({ pindex: 9, sea: 0.006, lake: 0.006, soil: 0.034, rock: 0.038, snow: 0.017 }),
	Object.freeze({ pindex: 10, sea: 0.0055, lake: 0.0055, soil: 0.032, rock: 0.036, snow: 0.016 }),
]);

export const PINDEX_DETAIL_HD_POLICY = Object.freeze({
	id: 'owner-map-pindex-detail-hd-2026-08-12-v1',
	supersedes: Object.freeze([
		'owner-map-pindex01-detail-2026-08-11-v1',
		'owner-map-pindex02-detail-2026-08-11-v1',
		'owner-map-pindex03-detail-2026-08-11-v1',
		'owner-map-pindex04-detail-2026-08-11-v1',
		'owner-map-pindex05-detail-2026-08-12-v1',
		'owner-map-pindex06-detail-2026-08-12-v1',
		'owner-map-pindex07-detail-2026-08-12-v1',
		'owner-map-pindex08-detail-2026-08-12-v1',
		'owner-map-pindex09-detail-2026-08-12-v1',
	]),
	/** Half-width, in normalized X, of the amplitude crossfade centred on each pindex boundary. */
	seamBlendHalfWidth: 0.008,
	/** Deterministic seed for the shared fBm field. One field for the whole map, by design. */
	noiseSeed: 0x5eed10,
	/** Shading clamp, matching the legacy layers so no vertex can be pushed outside their range. */
	shadeMin: 0.85,
	shadeMax: 1.15,
	/** How strongly the interface crossfade pulls colour across ANY surface boundary. */
	interfaceBlendStrength: 1,
});

const PALETTE = Object.freeze(Object.fromEntries(
	Object.entries(WORLD_REFERENCE_SURFACE_VISUAL_POLICY.colors).map(([surface, hex]) => [surface, new THREE.Color(hex)]),
));

const SURFACE_BY_CODE = Object.freeze(['soil', 'rock', 'snow', 'sea', 'lake']);

function quinticFade(t) {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Amplitude for one surface at one normalized X, crossfaded across pindex boundaries.
 *
 * Outside a blend band this returns the strip's own approved value bit-for-bit. Inside one it
 * returns a quintic blend of the two neighbouring strips, hitting exactly the midpoint on the
 * boundary itself.
 */
export function amplitudeAt(normalizedX, surface) {
	const x = normalizedX < 0 ? 0 : normalizedX > 1 ? 1 : normalizedX;
	const { seamBlendHalfWidth } = PINDEX_DETAIL_HD_POLICY;
	const strip = Math.min(10, Math.floor(x * 10) + 1);
	const own = PINDEX_HD_AMPLITUDES[strip - 1][surface] ?? 0;

	const lowerBoundary = (strip - 1) / 10;
	const upperBoundary = strip / 10;

	if (strip > 1 && x < lowerBoundary + seamBlendHalfWidth) {
		const neighbour = PINDEX_HD_AMPLITUDES[strip - 2][surface] ?? 0;
		// t: 0 at the far edge of the band below the boundary, 1 at the far edge above it.
		const t = quinticFade((x - (lowerBoundary - seamBlendHalfWidth)) / (seamBlendHalfWidth * 2));
		return neighbour + (own - neighbour) * t;
	}
	if (strip < 10 && x > upperBoundary - seamBlendHalfWidth) {
		const neighbour = PINDEX_HD_AMPLITUDES[strip][surface] ?? 0;
		const t = quinticFade((x - (upperBoundary - seamBlendHalfWidth)) / (seamBlendHalfWidth * 2));
		return own + (neighbour - own) * t;
	}
	return own;
}

/**
 * Projects a world XZ point onto normalized canonical-map space.
 * Deliberately does not classify: `resolveDetailColor` needs the surface anyway, and computing it
 * here too would sample the mask twice per vertex.
 */
function normalizedForWorld(worldX, worldZ) {
	const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
	return mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
}

/**
 * Resolves the final linear-space RGB for one normalized map point.
 * Exported so offline checks can assert exact colours without building a mesh.
 * @returns {{r:number,g:number,b:number,surface:string,amplitude:number,occupancy:number}}
 */
export function resolveDetailColor(normalizedX, normalizedY) {
	const surface = sampleBaseSurfaceFast(normalizedX, normalizedY);
	const weights = sampleSurfaceWeights(normalizedX, normalizedY);

	// Weighted palette mix across every surface present in the 2x2 cell-centre neighbourhood.
	// At a cell centre the weights are one-hot, so this reduces to exactly that cell's canonical
	// palette colour; between centres it softens the interface, whatever kind of interface it is.
	let mixedR = 0;
	let mixedG = 0;
	let mixedB = 0;
	for (const key of SURFACE_BY_CODE) {
		const weight = weights[key];
		if (weight === 0) continue;
		const colour = PALETTE[key];
		mixedR += colour.r * weight;
		mixedG += colour.g * weight;
		mixedB += colour.b * weight;
	}

	// Strength lerps between the hard classified colour and the fully mixed one. Because both are
	// identical at a cell centre, the canonical-fidelity guarantee holds at any strength.
	const strength = PINDEX_DETAIL_HD_POLICY.interfaceBlendStrength;
	const own = PALETTE[surface];
	const baseR = own.r + (mixedR - own.r) * strength;
	const baseG = own.g + (mixedG - own.g) * strength;
	const baseB = own.b + (mixedB - own.b) * strength;
	const occupancy = weights.sea + weights.lake;

	const amplitude = amplitudeAt(normalizedX, surface);
	const noise = sampleMicroDetailSigned(normalizedX, normalizedY, PINDEX_DETAIL_HD_POLICY.noiseSeed);
	const shade = THREE.MathUtils.clamp(
		1 + noise * amplitude,
		PINDEX_DETAIL_HD_POLICY.shadeMin,
		PINDEX_DETAIL_HD_POLICY.shadeMax,
	);

	return {
		r: THREE.MathUtils.clamp(baseR * shade, 0, 1),
		g: THREE.MathUtils.clamp(baseG * shade, 0, 1),
		b: THREE.MathUtils.clamp(baseB * shade, 0, 1),
		surface,
		amplitude,
		occupancy,
	};
}

/**
 * Applies the unified HD detail to one terrain mesh, covering every pindex it contains.
 * @returns immutable per-mesh stats.
 */
export function applyPindexDetailHDToTerrainMesh(mesh) {
	const position = mesh?.geometry?.getAttribute?.('position');
	const color = mesh?.geometry?.getAttribute?.('color');
	if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

	const pindexCounts = Array.from({ length: 10 }, () => 0);
	let coastVertices = 0;
	for (let index = 0; index < position.count; index += 1) {
		const worldX = mesh.position.x + position.getX(index);
		const worldZ = mesh.position.z + position.getZ(index);
		const { x: normalizedX, y: normalizedY } = normalizedForWorld(worldX, worldZ);
		const resolved = resolveDetailColor(normalizedX, normalizedY);
		color.setXYZ(index, resolved.r, resolved.g, resolved.b);
		pindexCounts[Math.min(10, Math.floor(normalizedX * 10) + 1) - 1] += 1;
		if (resolved.occupancy > 0 && resolved.occupancy < 1) coastVertices += 1;
	}
	color.needsUpdate = true;

	const summary = Object.freeze({
		policyId: PINDEX_DETAIL_HD_POLICY.id,
		touchedVertices: position.count,
		coastVertices,
		pindexCounts: Object.freeze([...pindexCounts]),
	});
	mesh.userData.run297PindexDetailHD = summary;
	return summary;
}

/** Applies the unified HD detail to a canonical terrain group. */
export function applyPindexDetailHDToTerrainGroup(terrainGroup) {
	if (!Array.isArray(terrainGroup?.children)) throw new TypeError('canonical terrain group is required');
	const pindexCounts = Array.from({ length: 10 }, () => 0);
	let touchedVertices = 0;
	let coastVertices = 0;
	for (const mesh of terrainGroup.children) {
		const meshSummary = applyPindexDetailHDToTerrainMesh(mesh);
		touchedVertices += meshSummary.touchedVertices;
		coastVertices += meshSummary.coastVertices;
		for (let i = 0; i < 10; i += 1) pindexCounts[i] += meshSummary.pindexCounts[i];
	}
	const summary = Object.freeze({
		policyId: PINDEX_DETAIL_HD_POLICY.id,
		touchedVertices,
		coastVertices,
		meshCount: terrainGroup.children.length,
		pindexCounts: Object.freeze([...pindexCounts]),
	});
	terrainGroup.userData.run297PindexDetailHD = summary;
	return summary;
}
