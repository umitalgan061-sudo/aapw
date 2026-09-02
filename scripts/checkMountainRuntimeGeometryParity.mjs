#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = Object.freeze({
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.glb': 'model/gltf-binary',
	'.fbx': 'application/octet-stream',
});

function startServer() {
	const server = http.createServer((request, response) => {
		try {
			const rawPath = decodeURIComponent((request.url || '/').split('?')[0]);
			const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
			const filePath = path.resolve(ROOT, relativePath);
			if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				response.writeHead(404);
				response.end('Not found');
				return;
			}
			response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(response);
		} catch (error) {
			response.writeHead(500);
			response.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try {
			return requireFromEsm(id);
		} catch {
			// Try the next CI/local installation.
		}
	}
	return null;
}

function requireFromEsm(id) {
	return globalThis.__mountainRequire(id);
}

const { createRequire } = await import('node:module');
globalThis.__mountainRequire = createRequire(import.meta.url);

const playwright = loadPlaywright();
if (!playwright) {
	console.error('MOUNTAIN_RUNTIME_GEOMETRY_PARITY_SKIP playwright unavailable');
	process.exit(2);
}

const server = await startServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
let result;
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
		waitUntil: 'domcontentloaded',
		timeout: 90000,
	});
	result = await page.evaluate(async () => {
		const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
		const { createHeightSampler, createTerrainChunk, disposeTerrainChunk } = await import('/src/3d/world/terrain.js');
		const {
			REFERENCE_RELIEF_CHAINS,
			normalizedMapToWorldXZ,
		} = await import('/src/3d/world/worldReferenceMap.js');
		const {
			WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
			sampleWorldReferenceMountainReliefMeters,
		} = await import('/src/3d/world/worldReferenceMountainRelief.js');

		const chunkSize = 500;
		const segments = 14;
		const sampler = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
		const chains = [];
		let globalMaxGeometryDelta = 0;
		let globalMountainVertices = 0;
		let globalVertices = 0;

		for (const chain of REFERENCE_RELIEF_CHAINS) {
			const middleIndex = Math.floor((chain.points.length - 1) / 2);
			const a = chain.points[middleIndex];
			const b = chain.points[middleIndex + 1];
			const normalizedX = (a[0] + b[0]) * 0.5;
			const normalizedY = (a[1] + b[1]) * 0.5;
			const world = normalizedMapToWorldXZ(normalizedX, normalizedY);
			const chunkX = Math.round(world.x / chunkSize);
			const chunkZ = Math.round(world.z / chunkSize);
			const mesh = createTerrainChunk({
				chunkX,
				chunkZ,
				size: chunkSize,
				segments,
				seed: WORLD_DEFAULTS.WORLD_SEED,
			});
			const position = mesh.geometry.attributes.position;
			let maxGeometryDelta = 0;
			let mountainVertices = 0;
			let reliefPeak = 0;
			let renderedPeak = -Infinity;
			let renderedMin = Infinity;

			for (let index = 0; index < position.count; index += 1) {
				const worldX = mesh.position.x + position.getX(index);
				const worldZ = mesh.position.z + position.getZ(index);
				const geometryHeight = position.getY(index);
				const sampledHeight = sampler(worldX, worldZ);
				const delta = Math.abs(geometryHeight - sampledHeight);
				maxGeometryDelta = Math.max(maxGeometryDelta, delta);
				globalMaxGeometryDelta = Math.max(globalMaxGeometryDelta, delta);
				const relief = sampleWorldReferenceMountainReliefMeters(worldX, worldZ);
				if (relief > 0.01) mountainVertices += 1;
				reliefPeak = Math.max(reliefPeak, relief);
				renderedPeak = Math.max(renderedPeak, geometryHeight);
				renderedMin = Math.min(renderedMin, geometryHeight);
			}

			globalMountainVertices += mountainVertices;
			globalVertices += position.count;
			chains.push({
				id: chain.id,
				chunkX,
				chunkZ,
				vertices: position.count,
				mountainVertices,
				reliefPeak,
				renderedPeak,
				renderedMin,
				maxGeometryDelta,
			});
			disposeTerrainChunk(mesh);
		}

		return {
			policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
			chainCount: chains.length,
			globalVertices,
			globalMountainVertices,
			globalMaxGeometryDelta,
			chains,
		};
	});
} finally {
	await browser.close();
	server.close();
}

assert(result, 'browser did not return mountain runtime parity evidence');
assert.match(result.policyId, /v10-ridge-local-landform-breakup/, 'browser loaded stale mountain relief policy');
assert.equal(result.chainCount, 4, 'unexpected canonical mountain chain count');
assert(result.globalVertices >= 800, 'runtime parity sampled too few terrain vertices');
assert(result.globalMountainVertices >= 40, 'runtime parity did not exercise enough mountain vertices');
assert(result.globalMaxGeometryDelta <= 1e-9, `render geometry / canonical sampler drift ${result.globalMaxGeometryDelta}`);

for (const chain of result.chains) {
	assert(chain.vertices >= 200, `${chain.id}: terrain chunk has insufficient vertices`);
	assert(chain.mountainVertices > 0, `${chain.id}: selected runtime chunk missed canonical mountain relief`);
	assert(chain.reliefPeak > 5, `${chain.id}: runtime chunk has negligible mountain relief`);
	assert(Number.isFinite(chain.renderedPeak) && Number.isFinite(chain.renderedMin), `${chain.id}: non-finite geometry height`);
	assert(chain.renderedPeak > chain.renderedMin, `${chain.id}: rendered terrain chunk is flat`);
	assert(chain.maxGeometryDelta <= 1e-9, `${chain.id}: mesh/collider sampler parity drift`);
}

console.log('MOUNTAIN_RUNTIME_GEOMETRY_PARITY_OK', JSON.stringify(result));
