import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const EPSILON_METERS = 1e-5;

function expectedSampleCount(segments) {
	return (segments + 1) ** 2 + (4 * (segments + 3) - 4);
}

const previewChunks = 23 ** 2;
const nearChunks = 3 ** 2;
const midChunks = 9 ** 2 - nearChunks;
const farChunks = previewChunks - 9 ** 2;
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
assert.ok(lodSamples < legacySamples * 0.45);

const playwright = loadPlaywright();
if (!playwright) process.exit(2);
const server = await startStaticServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });

try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
	const page = await context.newPage();
	await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
	const result = await page.evaluate(async ({ epsilon }) => {
		const [{ ChunkManager, DESKTOP_TERRAIN_DETAIL_LOD }, THREE] = await Promise.all([
			import('/src/3d/world/chunkManager.js'),
			import('/src/3d/vendor/three/three.module.js'),
		]);
		const edgeHeights = (mesh, side, segments) => {
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
		};
		const edgeError = (fine, coarse) => {
			let maxSharedError = 0;
			let maxMidpointError = 0;
			for (let i = 0; i < coarse.length; i += 1) {
				const fi = i * 2;
				maxSharedError = Math.max(maxSharedError, Math.abs(fine[fi] - coarse[i]));
				if (i === coarse.length - 1) continue;
				const midpoint = (coarse[i] + coarse[i + 1]) * 0.5;
				maxMidpointError = Math.max(maxMidpointError, Math.abs(fine[fi + 1] - midpoint));
			}
			return { maxSharedError, maxMidpointError, pass: maxSharedError <= epsilon && maxMidpointError <= epsilon };
		};

		const scene = new THREE.Scene();
		const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: 1337, flattenPads: [] });
		manager.desktopTerrainDetailLodEnabled = true;
		manager.desktopTerrainDetailLodCenter = { x: 0, z: 0 };
		const near = manager.loadChunk(1, 0);
		const mid = manager.loadChunk(2, 0);
		const far = manager.loadChunk(5, 0);
		const mid64 = manager.loadChunk(4, 4);
		const far32 = manager.loadChunk(5, 4);
		const seam128to64 = edgeError(edgeHeights(near, 'right', 128), edgeHeights(mid, 'left', 64));
		const seam64to32 = edgeError(edgeHeights(mid64, 'right', 64), edgeHeights(far32, 'left', 32));
		const payload = {
			coarsePointer: window.matchMedia('(pointer: coarse)').matches,
			policy: DESKTOP_TERRAIN_DETAIL_LOD,
			near: {
				segments: near.userData.desktopTerrainLodSegments,
				vertices: near.geometry.getAttribute('position').count,
				spacing: near.userData.desktopTerrainVertexSpacingMeters,
			},
			mid: { segments: mid.userData.desktopTerrainLodSegments, vertices: mid.geometry.getAttribute('position').count },
			far: { segments: far.userData.desktopTerrainLodSegments, vertices: far.geometry.getAttribute('position').count },
			seam128to64,
			seam64to32,
		};
		manager.disposeAll();
		return payload;
	}, { epsilon: EPSILON_METERS });

	assert.equal(result.coarsePointer, false, 'desktop proof accidentally ran as coarse-pointer/mobile');
	assert.deepEqual(result.policy, {
		NEAR_SEGMENTS: 128,
		MID_SEGMENTS: 64,
		FAR_SEGMENTS: 32,
		NEAR_RADIUS_CHUNKS: 1,
		MID_RADIUS_CHUNKS: 4,
	});
	assert.deepEqual(result.near, { segments: 128, vertices: 129 ** 2, spacing: 3.90625 });
	assert.deepEqual(result.mid, { segments: 64, vertices: 65 ** 2 });
	assert.deepEqual(result.far, { segments: 32, vertices: 33 ** 2 });
	assert.equal(result.seam128to64.pass, true, JSON.stringify(result.seam128to64));
	assert.equal(result.seam64to32.pass, true, JSON.stringify(result.seam64to32));

	console.log(JSON.stringify({
		ok: true,
		previewChunks,
		bands: { nearChunks, midChunks, farChunks },
		legacySamples,
		lodSamples,
		sampleReductionRatio: Number((1 - lodSamples / legacySamples).toFixed(6)),
		nearVertexSpacingMeters: result.near.spacing,
		seams: { '128:64': result.seam128to64, '64:32': result.seam64to32 },
	}, null, 2));
} finally {
	await browser.close();
	server.close();
}
