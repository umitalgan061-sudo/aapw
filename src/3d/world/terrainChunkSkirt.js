/**
 * Terrain chunk skirts — the vertical ribbon that closes the gap where two chunks of *different*
 * mesh resolution meet.
 *
 * **The defect this fixes.** Run 134 / ADR-0158 gave coarse-pointer devices distance LOD: terrain
 * inside Chebyshev radius 1 keeps 64 subdivisions, radius 2 drops to 32 and radius 3 to 16. Nothing
 * stitches those seams. A coarse chunk's edge is a straight line between vertices up to 31 m apart,
 * while the fine chunk it abuts follows the height field every 7.8 m — so wherever the ground is not
 * planar across that span, the two edges disagree and the player sees a T-junction crack: a sliver of
 * void or sky cut through the ground. It is a live rendering bug on mobile today, not a hypothetical.
 *
 * **Why a skirt rather than stitching.** Index stitching (snapping the fine edge's odd vertices onto
 * the coarse edge's chord) is exact, but it makes a chunk's geometry depend on its neighbours' LOD
 * bands, so a chunk has to be rebuilt when a *neighbour* changes band — not just when its own band
 * changes. A skirt has no such coupling: each chunk hangs a short wall from its own perimeter, and
 * any mismatch on either side is covered no matter what the neighbour did, or whether a neighbour is
 * even loaded yet during streaming. That independence is the whole point.
 *
 * **Why a child mesh rather than extra vertices on the chunk.** Appending the ribbon to the chunk's
 * own `BufferGeometry` would change its vertex and index counts, which
 * `scripts/checkTerrainVisualContract.js`, `scripts/checkMobileTerrainLod.js` and the runtime-parity
 * evidence checks all assert exactly. Carrying the skirt as a separate child mesh keeps the terrain
 * geometry byte-for-byte what it was — 4225 vertices / 24576 indices at 64 segments — so this run is
 * purely additive, and `camera.js`'s ground raycast (`intersectObjects(collidables, false)`, i.e.
 * non-recursive) and `world/worldReferenceSurfaceTerrainVisual.js` (which is handed the chunk mesh
 * itself) both keep seeing exactly the surface they saw before.
 *
 * **Determinism.** Positions and colours are copied from the chunk geometry that was already built by
 * the seeded sampler. Nothing here samples, randomises or allocates per frame.
 * @module world/terrainChunkSkirt
 */

import * as THREE from 'three';

export const TERRAIN_CHUNK_SKIRT_POLICY = Object.freeze({
	id: 'terrain-chunk-skirt-2026-08-19-v1',
	/**
	 * The coarsest mesh resolution any neighbour can have — run 134 / ADR-0158's `FAR` band. A chunk
	 * cannot know which LOD its neighbours will be built at (they may not even be loaded yet during
	 * streaming), so it sizes its skirt for the worst neighbour it could ever get.
	 */
	coarsestNeighbourSegments: 16,
	/** Added to the measured worst mismatch, to absorb the sub-vertex wobble a chord comparison at
	 * vertex positions cannot see. */
	marginMeters: 1.5,
	/** Floor, so a perfectly flat chunk still hangs enough ribbon to cover float noise at the seam. */
	minDepthMeters: 2,
	/**
	 * Hard ceiling, as a backstop against a pathological edge dragging one chunk's wall absurdly deep.
	 * `scripts/measureTerrainChunkSkirtDepth.js` measures the true worst mismatch anywhere in the world
	 * at 60.74 m (a 64-vs-16 seam on chunk (6,0)'s west edge), so this clears reality with room spare
	 * and never actually binds today — see DECISIONS.md ADR-0301.
	 */
	maxDepthMeters: 96,
});

/**
 * How deep *this* chunk's ribbon has to hang, derived from its own perimeter.
 *
 * **Why per-chunk rather than one constant.** Measuring every shared edge in the world showed the
 * mismatch distribution is extremely long-tailed: the mean gap is 0.8 m at a 64-vs-32 seam and 1.6 m
 * at 64-vs-16, but the worst single edge in the world reaches 60.74 m. A global constant would have to
 * be sized for that one mountain edge, and a 61 m wall hanging off all 567 chunks is precisely the
 * failure this module's `depthMeters` note warns about — it stops being hidden behind the ground it
 * hangs from and starts peeking out on steep downslopes, trading a crack for a smear.
 *
 * A chunk already knows its own edge heights, so it can measure the exact chord a coarsest-case
 * neighbour would draw across them and hang precisely that far. Flat chunks get a 2 m lip; the one
 * mountain chunk gets its 61 m wall, where it is genuinely load-bearing. No extra height sampling —
 * this reads the geometry that was just built.
 *
 * The comparison is exact rather than an estimate: neighbouring LOD levels are powers of two of each
 * other, so a coarse chunk's edge vertices sit at a subset of the fine chunk's edge positions, and the
 * chord between them is exactly the geometry the neighbour will draw.
 *
 * @param {Float64Array} loopHeights Perimeter heights in loop order, `4 * segments` of them.
 * @param {number} segments
 * @returns {number} Depth in metres.
 */
function adaptiveSkirtDepthMeters(loopHeights, segments) {
	const { coarsestNeighbourSegments, marginMeters, minDepthMeters, maxDepthMeters } = TERRAIN_CHUNK_SKIRT_POLICY;
	const step = Math.max(1, Math.round(segments / coarsestNeighbourSegments));
	let worst = 0;
	// Each of the four edges spans `segments + 1` loop positions, the last shared with the next edge.
	for (let edge = 0; edge < 4; edge += 1) {
		const start = edge * segments;
		for (let offset = 0; offset < segments; offset += step) {
			const chordStart = loopHeights[(start + offset) % loopHeights.length];
			const chordEndOffset = Math.min(offset + step, segments);
			const chordEnd = loopHeights[(start + chordEndOffset) % loopHeights.length];
			const span = chordEndOffset - offset;
			for (let inner = 1; inner < span; inner += 1) {
				const t = inner / span;
				const chord = chordStart * (1 - t) + chordEnd * t;
				const gap = Math.abs(loopHeights[(start + offset + inner) % loopHeights.length] - chord);
				if (gap > worst) worst = gap;
			}
		}
	}
	return Math.min(maxDepthMeters, Math.max(minDepthMeters, worst + marginMeters));
}

/**
 * Walks a chunk grid's perimeter once, in loop order, returning the vertex index of each cell.
 *
 * The chunk's vertex grid is regular and axis-aligned, so a vertex's column and row are recoverable
 * from its own local coordinates — the same derivation `world/terrain.js`'s shading pass uses, rather
 * than assuming `PlaneGeometry`'s internal ordering.
 *
 * @param {import('three').BufferAttribute} position
 * @param {number} segments
 * @param {number} size Chunk edge length in metres.
 * @returns {Int32Array | null} `4 * segments` vertex indices, or null if the grid is not complete.
 */
function perimeterLoop(position, segments, size) {
	const stride = segments + 1;
	const spacingMeters = size / segments;
	const halfSize = size / 2;
	const grid = new Int32Array(stride * stride).fill(-1);
	for (let index = 0; index < position.count; index += 1) {
		const column = Math.round((position.getX(index) + halfSize) / spacingMeters);
		const row = Math.round((position.getZ(index) + halfSize) / spacingMeters);
		if (column < 0 || row < 0 || column >= stride || row >= stride) return null;
		grid[row * stride + column] = index;
	}

	const loop = new Int32Array(4 * segments);
	let cursor = 0;
	const push = (column, row) => {
		const index = grid[row * stride + column];
		if (index < 0) return false;
		loop[cursor] = index;
		cursor += 1;
		return true;
	};
	// Around the edge exactly once: top row left-to-right, right column downward, bottom row back
	// right-to-left, left column upward — stopping one short each time so no corner repeats.
	for (let column = 0; column <= segments; column += 1) if (!push(column, 0)) return null;
	for (let row = 1; row <= segments; row += 1) if (!push(segments, row)) return null;
	for (let column = segments - 1; column >= 0; column -= 1) if (!push(column, segments)) return null;
	for (let row = segments - 1; row >= 1; row -= 1) if (!push(0, row)) return null;
	return cursor === loop.length ? loop : null;
}

/**
 * Builds the skirt for one already-generated terrain chunk.
 *
 * Expects `geometry` to be the finished chunk geometry — positions displaced to their real heights
 * and the `color` attribute already written — so the ribbon can inherit the exact ground colour of
 * the edge it hangs from and stay invisible even in the frame where it is doing its job.
 *
 * @param {import('three').BufferGeometry} geometry Finished chunk geometry, in chunk-local space.
 * @param {object} options
 * @param {number} options.segments Subdivisions per chunk edge.
 * @param {number} options.size Chunk edge length in metres.
 * @param {number} [options.roughness] Matched to the chunk material so the wall is not a shiny band.
 * @returns {import('three').Mesh | null} A mesh in the same local space as `geometry`, ready to be
 *   added as a child of the chunk mesh, or null if the geometry is not a complete chunk grid.
 */
export function createTerrainChunkSkirt(geometry, { segments, size, roughness = 1 }) {
	const position = geometry?.getAttribute?.('position');
	if (!position || !Number.isInteger(segments) || segments < 2) return null;
	const loop = perimeterLoop(position, segments, size);
	if (!loop) return null;

	const sourceColor = geometry.getAttribute('color');
	const ringCount = loop.length;
	const vertexCount = ringCount * 2;
	const positions = new Float32Array(vertexCount * 3);
	const colors = new Float32Array(vertexCount * 3);
	const loopHeights = new Float64Array(ringCount);
	for (let k = 0; k < ringCount; k += 1) loopHeights[k] = position.getY(loop[k]);
	const depthMeters = adaptiveSkirtDepthMeters(loopHeights, segments);

	for (let k = 0; k < ringCount; k += 1) {
		const source = loop[k];
		const x = position.getX(source);
		const y = position.getY(source);
		const z = position.getZ(source);
		// Top copy then bottom copy, interleaved so a quad's four vertices stay adjacent in memory.
		const top = k * 2;
		const bottom = top + 1;
		positions[top * 3] = x;
		positions[top * 3 + 1] = y;
		positions[top * 3 + 2] = z;
		positions[bottom * 3] = x;
		positions[bottom * 3 + 1] = y - depthMeters;
		positions[bottom * 3 + 2] = z;
		if (sourceColor) {
			const r = sourceColor.getX(source);
			const g = sourceColor.getY(source);
			const b = sourceColor.getZ(source);
			colors[top * 3] = r;
			colors[top * 3 + 1] = g;
			colors[top * 3 + 2] = b;
			// The lower lip is darkened: it only ever shows through a crack or from below, and reading
			// as ground-in-shadow there is far less conspicuous than a lit band of grass hanging in air.
			colors[bottom * 3] = r * 0.55;
			colors[bottom * 3 + 1] = g * 0.55;
			colors[bottom * 3 + 2] = b * 0.55;
		}
	}

	const indices = new Uint16Array(ringCount * 6);
	for (let k = 0; k < ringCount; k += 1) {
		const next = (k + 1) % ringCount;
		const topK = k * 2;
		const bottomK = topK + 1;
		const topNext = next * 2;
		const bottomNext = topNext + 1;
		const offset = k * 6;
		indices[offset] = topK;
		indices[offset + 1] = topNext;
		indices[offset + 2] = bottomNext;
		indices[offset + 3] = topK;
		indices[offset + 4] = bottomNext;
		indices[offset + 5] = bottomK;
	}

	const skirtGeometry = new THREE.BufferGeometry();
	skirtGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	if (sourceColor) skirtGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	skirtGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
	skirtGeometry.computeVertexNormals();
	skirtGeometry.computeBoundingBox();
	skirtGeometry.computeBoundingSphere();

	const material = new THREE.MeshStandardMaterial({
		vertexColors: Boolean(sourceColor),
		roughness,
		metalness: 0,
		// The ribbon is a one-sided wall whose outward direction depends on which chunk edge it sits on
		// and which side the crack opens from. Rendering both faces costs 256 extra triangles' worth of
		// fill at 64 segments and removes an entire class of "the patch is itself invisible" bug.
		side: THREE.DoubleSide,
	});

	const mesh = new THREE.Mesh(skirtGeometry, material);
	// A skirt must not participate in shadows in either direction: casting would draw a dark rim around
	// every chunk, and receiving would shade it differently from the ground it is impersonating.
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.userData.terrainChunkSkirt = Object.freeze({
		policyId: TERRAIN_CHUNK_SKIRT_POLICY.id,
		depthMeters,
		segments,
		ringVertices: ringCount,
	});
	return mesh;
}

/**
 * Disposes a skirt's own geometry and material. Its parent chunk's shared textures are untouched —
 * the skirt never references them.
 * @param {import('three').Mesh} skirtMesh
 */
export function disposeTerrainChunkSkirt(skirtMesh) {
	skirtMesh.geometry?.dispose?.();
	skirtMesh.material?.dispose?.();
}
