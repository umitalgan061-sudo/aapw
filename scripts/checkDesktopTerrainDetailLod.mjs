import assert from 'node:assert/strict';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import { CHUNK_CONFIG } from '../src/3d/config.js';
import { ChunkManager, DESKTOP_TERRAIN_DETAIL_LOD } from '../src/3d/world/chunkManager.js';

const EPSILON_METERS = 1e-5;
const CHUNK_SIZE = CHUNK_CONFIG.CHUNK_SIZE_METERS;

function expectedSampleCount(segments) {
	// createTerrainChunk samples every mesh vertex plus the one-vertex slope apron.
	return (segments + 1) ** 2 + (4 * (segments + 3) - 4);
}

function edgeHeights(mesh, side, segments) {
	const position = mesh.geometry.getAttribute('position');
	const width = segments + 1;
	const values = [];
	for (let i = 0; i <= segments; i += 1) {
		let index;
		if (side === 'left') index = i * width;
		else if (side === 'right') index = i * width + segments;
		else if (side === 'top') index = i;
		else index = segments * width + i;
		values.push(position.getY(index));
	}
	return values;
}

function assertFineCoarseEdge(fine, coarse, label) {
	assert.equal(fine.length, coarse.length * 2 - 1, `${label}: expected 2:1 edge topology`);
	for (let coarseIndex = 0; coarseIndex < coarse.length; coarseIndex += 1) {
		const fineIndex = coarseIndex * 2;
		assert.ok(
			Math.abs(fine[fineIndex] - coarse[coarseIndex]) <= EPSILON_METERS,
			`${label}: coincident vertex ${coarseIndex} drifted by ${Math.abs(fine[fineIndex] - coarse[coarseIndex])}m`,
		);
		if (coarseIndex === coarse.length - 1) continue;
		const expectedMidpoint = (coarse[coarseIndex] + coarse[coarseIndex + 1]) * 0.5;
		assert.ok(
			Math.abs(fine[fineIndex + 1] - expectedMidpoint) <= EPSILON_METERS,
			`${label}: morphed midpoint ${coarseIndex} is not coarse-edge linear`,
		);
	}
}

assert.deepEqual(DESKTOP_TERRAIN_DETAIL_LOD, {
	NEAR_SEGMENTS: 128,
	MID_SEGMENTS: 64,
	FAR_SEGMENTS: 32,
	NEAR_RADIUS_CHUNKS: 1,
	MID_RADIUS_CHUNKS: 4,
});
assert.equal(CHUNK_SIZE / DESKTOP_TERRAIN_DETAIL_LOD.NEAR_SEGMENTS, 3.90625, 'near vertex spacing must be 3.90625m');
assert.equal(CHUNK_SIZE / DESKTOP_TERRAIN_DETAIL_LOD.MID_SEGMENTS, 7.8125, 'mid vertex spacing must stay 7.8125m');
assert.equal(CHUNK_SIZE / DESKTOP_TERRAIN_DETAIL_LOD.FAR_SEGMENTS, 15.625, 'far vertex spacing must be 15.625m');

// Full desktop preview is radius 11 = 23x23 = 529 chunks. The new layout is 3x3 near,
// the rest of 9x9 mid, and the remaining full preview far. This must be cheaper than the old
// 529 chunks all at 64, otherwise we would recreate Claude's measured boot regression.
const previewDiameter = CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS * 2 + 1;
const previewChunks = previewDiameter ** 2;
const nearChunks = (DESKTOP_TERRAIN_DETAIL_LOD.NEAR_RADIUS_CHUNKS * 2 + 1) ** 2;
const midDiscChunks = (DESKTOP_TERRAIN_DETAIL_LOD.MID_RADIUS_CHUNKS * 2 + 1) ** 2;
const midChunks = midDiscChunks - nearChunks;
const farChunks = previewChunks - midDiscChunks;
const lodSamples = nearChunks * expectedSampleCount(128)
	+ midChunks * expectedSampleCount(64)
	+ farChunks * expectedSampleCount(32);
const legacySamples = previewChunks * expectedSampleCount(64);
assert.equal(previewChunks, 529);
assert.equal(nearChunks, 9);
assert.equal(midChunks, 72);
assert.equal(farChunks, 448);
assert.equal(lodSamples, 1_026_457);
assert.equal(legacySamples, 2_374_681);
assert.ok(lodSamples < legacySamples * 0.45, `LOD boot field sampling did not fall enough: ${lodSamples}/${legacySamples}`);

// Exercise the real createTerrainChunk path through ChunkManager. We intentionally enable the
// desktop LOD flag directly so this test does not have to build all 529 preview chunks just to
// inspect one band boundary.
const scene = new THREE.Scene();
const manager = new ChunkManager({ scene, chunkSizeMeters: CHUNK_SIZE, seed: 1337, flattenPads: [] });
manager.desktopTerrainDetailLodEnabled = true;
manager.desktopTerrainDetailLodCenter = { x: 0, z: 0 };

const nearEast = manager.loadChunk(1, 0); // Chebyshev distance 1 => 128
const midEast = manager.loadChunk(2, 0);  // distance 2 => 64
const farEast = manager.loadChunk(5, 0);  // distance 5 => 32
assert.equal(nearEast.userData.desktopTerrainLodSegments, 128);
assert.equal(midEast.userData.desktopTerrainLodSegments, 64);
assert.equal(farEast.userData.desktopTerrainLodSegments, 32);
assert.equal(nearEast.userData.desktopTerrainVertexSpacingMeters, 3.90625);
assert.equal(nearEast.geometry.getAttribute('position').count, 129 ** 2);
assert.equal(midEast.geometry.getAttribute('position').count, 65 ** 2);
assert.equal(farEast.geometry.getAttribute('position').count, 33 ** 2);

// Chunks 1 and 2 touch at world X=750m. The 128 edge must land exactly on the 64 edge at every
// shared sample, and every in-between fine vertex must have been morphed onto the coarse line.
assertFineCoarseEdge(
	edgeHeights(nearEast, 'right', 128),
	edgeHeights(midEast, 'left', 64),
	'near128-mid64 east boundary',
);

// Build a 64↔32 pair with a shifted LOD center so the same edge-morph rule is proved for the
// second boundary too without relying on source-text assertions.
manager.desktopTerrainDetailLodCenter = { x: 3, z: 0 };
manager.unloadChunk(4, 1);
manager.unloadChunk(5, 1);
const midBoundary = manager.loadChunk(4, 1); // distance 1 => 128 with this center, so shift again below
manager.unloadChunk(4, 1);
manager.desktopTerrainDetailLodCenter = { x: 0, z: 0 };
const midNorth = manager.loadChunk(4, 4); // distance 4 => 64
const farNorth = manager.loadChunk(5, 4); // distance 5 => 32
assertFineCoarseEdge(
	edgeHeights(midNorth, 'right', 64),
	edgeHeights(farNorth, 'left', 32),
	'mid64-far32 east boundary',
);

manager.disposeAll();
console.log(JSON.stringify({
	ok: true,
	previewChunks,
	nearChunks,
	midChunks,
	farChunks,
	legacySamples,
	lodSamples,
	sampleReductionRatio: Number((1 - lodSamples / legacySamples).toFixed(6)),
	nearVertexSpacingMeters: CHUNK_SIZE / 128,
	seams: ['128:64', '64:32'],
}, null, 2));
