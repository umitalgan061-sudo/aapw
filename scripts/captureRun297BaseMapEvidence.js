#!/usr/bin/env node
/**
 * Visual evidence for Run297: renders the canonical base map three ways at full source resolution
 * and writes them as PNGs, so the quality change can be judged by eye rather than only by numbers.
 *
 *   run297-base-legacy.png   — nearest-neighbour classification + the sin(dot) white-noise detail,
 *                              i.e. exactly what the nine per-pindex layers produce today
 *   run297-base-hd.png       — the unified HD layer: bilinear sub-cell shoreline + coherent fBm
 *   run297-base-diff.png     — per-pixel absolute difference, amplified 4x, so the shoreline band
 *                              and the grain change are visible on their own
 *
 * Also renders a 6x zoom crop of one coastline region from both, which is where the 16-pixel
 * staircase is most obvious.
 *
 * Rendering happens in the page so the real ES modules and the real import map are used.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run297-pindex-detail-hd');

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch {}
	}
	return null;
}

function contentType(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.html') return 'text/html; charset=utf-8';
	if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
	if (ext === '.json') return 'application/json; charset=utf-8';
	if (ext === '.css') return 'text/css; charset=utf-8';
	if (ext === '.png') return 'image/png';
	return 'application/octet-stream';
}

function startServer() {
	const server = http.createServer((req, res) => {
		const clean = decodeURIComponent(req.url.split('?')[0]);
		const file = path.join(ROOT, clean === '/' ? 'canonical-dev.html' : clean.replace(/^\//, ''));
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': contentType(file) });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function render(page) {
	return page.evaluate(async () => {
		const { WORLD_REFERENCE_BASE_SURFACE_MASK: MASK, classifyReferenceBaseSurface } =
			await import('/src/3d/world/worldReferenceSurfacePindexes.js');
		const { WORLD_REFERENCE_SURFACE_VISUAL_POLICY } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
		const { PINDEX_HD_AMPLITUDES, resolveDetailColor } = await import('/src/3d/world/worldReferencePindexDetailHD.js');

		const THREE = await import('three');
		const W = MASK.sourcePixelWidth;
		const H = MASK.sourcePixelHeight;
		const palette = WORLD_REFERENCE_SURFACE_VISUAL_POLICY.colors;

		// Both paths must be computed in the SAME colour space or the comparison is meaningless.
		// three r160 has ColorManagement on, so `new THREE.Color(hex)` yields LINEAR values — the
		// space the real vertex-colour attribute actually stores. Reading the raw sRGB bytes out of
		// the hex instead would make the legacy side look ~2.4x brighter for no real reason.
		// Everything below therefore works in linear and converts to sRGB only when writing pixels.
		const paletteLinear = Object.fromEntries(Object.entries(palette).map(([surface, hex]) => {
			const color = new THREE.Color(hex);
			return [surface, [color.r, color.g, color.b]];
		}));
		const linearToSrgbByte = (value) => {
			const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
			const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
			return Math.max(0, Math.min(255, Math.round(encoded * 255)));
		};

		function legacyHash01(x, y, a, b, c) {
			const value = Math.sin(x * a + y * b + c) * 43758.5453;
			return value - Math.floor(value);
		}
		const LEGACY_HASH = [
			[12.9898, 78.233, 17.719], [15.371, 61.733, 29.117], [27.911, 47.173, 41.337],
			[39.137, 31.771, 53.911], [47.311, 23.917, 67.113], [55.487, 19.229, 71.559],
			[63.221, 11.483, 79.337], [71.113, 7.759, 83.891], [5.347, 91.223, 33.667],
			[5.347, 91.223, 33.667],
		];

		function renderTo(imageData, mode) {
			const data = imageData.data;
			for (let py = 0; py < H; py += 1) {
				const ny = (py + 0.5) / H;
				for (let px = 0; px < W; px += 1) {
					const nx = (px + 0.5) / W;
					let r;
					let g;
					let b;
					if (mode === 'hd') {
						const resolved = resolveDetailColor(nx, ny);
						r = resolved.r;
						g = resolved.g;
						b = resolved.b;
					} else {
						const surface = classifyReferenceBaseSurface(nx, ny);
						const base = paletteLinear[surface];
						const strip = Math.min(10, Math.floor(nx * 10) + 1);
						const amplitude = PINDEX_HD_AMPLITUDES[strip - 1][surface] ?? 0;
						const [ha, hb, hc] = LEGACY_HASH[strip - 1];
						const noise = (legacyHash01(nx * 1024, ny * 1024, ha, hb, hc) - 0.5) * 2 * amplitude;
						const shade = Math.min(1.15, Math.max(0.85, 1 + noise));
						r = base[0] * shade;
						g = base[1] * shade;
						b = base[2] * shade;
					}
					const offset = (py * W + px) * 4;
					data[offset] = linearToSrgbByte(r);
					data[offset + 1] = linearToSrgbByte(g);
					data[offset + 2] = linearToSrgbByte(b);
					data[offset + 3] = 255;
				}
			}
		}

		const canvas = document.createElement('canvas');
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext('2d');

		const legacyImage = ctx.createImageData(W, H);
		renderTo(legacyImage, 'legacy');
		ctx.putImageData(legacyImage, 0, 0);
		const legacyPng = canvas.toDataURL('image/png');

		const hdImage = ctx.createImageData(W, H);
		renderTo(hdImage, 'hd');
		ctx.putImageData(hdImage, 0, 0);
		const hdPng = canvas.toDataURL('image/png');

		// amplified absolute difference
		const diffImage = ctx.createImageData(W, H);
		let changedPixels = 0;
		let maxDelta = 0;
		for (let i = 0; i < diffImage.data.length; i += 4) {
			let localMax = 0;
			for (let channel = 0; channel < 3; channel += 1) {
				const delta = Math.abs(hdImage.data[i + channel] - legacyImage.data[i + channel]);
				localMax = Math.max(localMax, delta);
				diffImage.data[i + channel] = Math.min(255, delta * 4);
			}
			diffImage.data[i + 3] = 255;
			if (localMax > 0) changedPixels += 1;
			maxDelta = Math.max(maxDelta, localMax);
		}
		ctx.putImageData(diffImage, 0, 0);
		const diffPng = canvas.toDataURL('image/png');

		// 6x zoom on a coastline region, both variants, drawn with smoothing off
		function zoom(sourceImage, sx, sy, sw, sh, scale) {
			const src = document.createElement('canvas');
			src.width = W;
			src.height = H;
			src.getContext('2d').putImageData(sourceImage, 0, 0);
			const dst = document.createElement('canvas');
			dst.width = sw * scale;
			dst.height = sh * scale;
			const dctx = dst.getContext('2d');
			dctx.imageSmoothingEnabled = false;
			dctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
			return dst.toDataURL('image/png');
		}
		// a stretch of the western coastline, in source pixels
		const CROP = { x: 176, y: 400, w: 200, h: 140, scale: 6 };
		const legacyZoom = zoom(legacyImage, CROP.x, CROP.y, CROP.w, CROP.h, CROP.scale);
		const hdZoom = zoom(hdImage, CROP.x, CROP.y, CROP.w, CROP.h, CROP.scale);

		return { legacyPng, hdPng, diffPng, legacyZoom, hdZoom, changedPixels, maxDelta, totalPixels: W * H, crop: CROP };
	});
}

function writeDataUrl(file, dataUrl) {
	fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ serviceWorkers: 'block' });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/canonical-dev.html?worldSource=canonical-dev`,
			{ waitUntil: 'domcontentloaded', timeout: 30000 });
		const result = await render(page);
		if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

		writeDataUrl(path.join(OUT, 'run297-base-legacy.png'), result.legacyPng);
		writeDataUrl(path.join(OUT, 'run297-base-hd.png'), result.hdPng);
		writeDataUrl(path.join(OUT, 'run297-base-diff.png'), result.diffPng);
		writeDataUrl(path.join(OUT, 'run297-coast-zoom-legacy.png'), result.legacyZoom);
		writeDataUrl(path.join(OUT, 'run297-coast-zoom-hd.png'), result.hdZoom);

		console.log('[Run297] base-map visual evidence written to artifacts/run297-pindex-detail-hd/');
		console.log(`  changed pixels : ${result.changedPixels}/${result.totalPixels} (${(result.changedPixels / result.totalPixels * 100).toFixed(1)}%)`);
		console.log(`  max channel delta: ${result.maxDelta}`);
		console.log(`  coast zoom crop: ${JSON.stringify(result.crop)}`);
		await context.close();
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[Run297] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
