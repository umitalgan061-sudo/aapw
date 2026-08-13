#!/usr/bin/env node
/**
 * Real-browser proof for Günbatımı Ustası G07 Terrain3D LOD0 -> Three.js runtime parity.
 * Loads game3d.html so the production import map resolves bare `three`, then imports the real
 * world/terrain.js sampler used by rendered chunks and gameplay height queries.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
};

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (_) { /* try next */ }
	}
	return null;
}

function startStaticServer() {
	const server = http.createServer((req, res) => {
		try {
			const urlPath = decodeURIComponent(req.url.split('?')[0]);
			const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
			if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(filePath).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function fnv1a(hash, value) {
	hash ^= value & 0xff;
	return Math.imul(hash, 16777619) >>> 0;
}

async function sampleRuntime(page) {
	return page.evaluate(async () => {
		const { createHeightSampler } = await import('/src/3d/world/terrain.js');
		const {
			G07_TERRAIN3D_RUNTIME_PARITY,
			sampleG07Terrain3dRuntimeInfluence,
			applyG07Terrain3dRuntimeParity,
		} = await import('/src/3d/world/g07Terrain3dRuntimeParity.js');
		const { sampleReferenceWaterMask } = await import('/src/3d/world/worldReferenceWaterMask.js');

		const policy = G07_TERRAIN3D_RUNTIME_PARITY;
		const { xMin, xMax, yMin, yMax } = policy.normalizedBounds;
		const toWorld = (n) => (n - 0.5) * policy.worldSpanMeters;
		const sampler = createHeightSampler(1337);
		const samples = [];
		let maxHeightError = 0;
		let minInfluence = 1;
		let canonicalLandSamples = 0;
		for (let gy = 0; gy <= 16; gy += 1) {
			const ny = yMin + (yMax - yMin) * gy / 16;
			for (let gx = 0; gx <= 16; gx += 1) {
				const nx = xMin + (xMax - xMin) * gx / 16;
				const worldX = toWorld(nx);
				const worldZ = toWorld(ny);
				const height = sampler(worldX, worldZ);
				const influence = sampleG07Terrain3dRuntimeInfluence(worldX, worldZ);
				maxHeightError = Math.max(maxHeightError, Math.abs(height - policy.targetHeightMeters));
				minInfluence = Math.min(minInfluence, influence);
				canonicalLandSamples += sampleReferenceWaterMask(nx, ny) ? 0 : 1;
				samples.push(height);
			}
		}

		// A non-G07 point must remain a no-op at the adapter layer.
		const outsideLegacy = 17.25;
		const outsideNx = 0.5;
		const outsideNy = 0.5;
		const outsideWorldX = toWorld(outsideNx);
		const outsideWorldZ = toWorld(outsideNy);
		const outsideAdapterHeight = applyG07Terrain3dRuntimeParity(outsideLegacy, outsideWorldX, outsideWorldZ);

		// Probe the authored east edge and its guard in 1 m increments. A smoothstep guard must not
		// produce a hard GeoCell step even though the QA ownership boundary itself is rectangular.
		const eastBoundaryX = toWorld(xMax);
		const midZ = toWorld((yMin + yMax) * 0.5);
		const guardMeters = policy.guardBandNormalized * policy.worldSpanMeters;
		let maxGuardStep = 0;
		let previous = sampler(eastBoundaryX, midZ);
		for (let offset = 1; offset <= Math.ceil(guardMeters); offset += 1) {
			const current = sampler(eastBoundaryX + offset, midZ);
			maxGuardStep = Math.max(maxGuardStep, Math.abs(current - previous));
			previous = current;
		}

		return {
			policyId: policy.id,
			targetHeightMeters: policy.targetHeightMeters,
			sampleCount: samples.length,
			canonicalLandSamples,
			maxHeightError,
			minInfluence,
			outsideAdapterDelta: outsideAdapterHeight - outsideLegacy,
			maxGuardStep,
			guardMeters,
			heightsMilli: samples.map((height) => Math.round(height * 1000)),
		};
	});
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[SW G07 parity] FAIL: Playwright is required for real Three.js runtime proof.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const first = await sampleRuntime(page);
		const second = await sampleRuntime(page);

		if (first.canonicalLandSamples !== 0) throw new Error(`G07 owner-map water contract drifted; land samples=${first.canonicalLandSamples}`);
		if (first.sampleCount !== 289) throw new Error(`unexpected sample count ${first.sampleCount}`);
		if (first.minInfluence < 0.999999) throw new Error(`G07 interior influence fell below 1: ${first.minInfluence}`);
		if (first.maxHeightError > 1e-9) throw new Error(`runtime/Terrain3D height mismatch: ${first.maxHeightError}`);
		if (Math.abs(first.outsideAdapterDelta) > 1e-12) throw new Error(`adapter changed terrain outside G07 guard: ${first.outsideAdapterDelta}`);
		if (first.maxGuardStep > 2) throw new Error(`runtime guard transition too abrupt: ${first.maxGuardStep}m per 1m`);

		let checksumA = 2166136261;
		let checksumB = 2166136261;
		for (const value of first.heightsMilli) {
			checksumA = fnv1a(checksumA, value); checksumA = fnv1a(checksumA, value >>> 8);
		}
		for (const value of second.heightsMilli) {
			checksumB = fnv1a(checksumB, value); checksumB = fnv1a(checksumB, value >>> 8);
		}
		if (checksumA !== checksumB) throw new Error(`runtime parity is nondeterministic: ${checksumA} != ${checksumB}`);

		const metrics = { ...first, heightsMilli: undefined, checksum: checksumA };
		console.log(`G07_TERRAIN3D_RUNTIME_PARITY_METRICS=${JSON.stringify(metrics)}`);
		console.log('SW_G07_TERRAIN3D_RUNTIME_PARITY_OK');
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[SW G07 parity] FAIL:', error);
	process.exit(1);
});
