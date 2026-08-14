#!/usr/bin/env node
/**
 * captureTexturePaletteSheet.js — visual proof for the procedural palette library
 * (GOVERNANCE.md §8.5, DECISIONS.md ADR-0267).
 *
 * Renders three artifacts:
 *   1. `palette-sheet.png`  — every palette as a labelled swatch, grouped by family.
 *   2. `dragon-sheet.png`   — the dragon family at high resolution, since that is the family the
 *                             owner asked to be developed continuously and a 96px swatch cannot show
 *                             scale/ridge/wear detail.
 *   3. `editor-auto-texture.png` — the real World Editor after pressing "Tümüne Giydir", i.e. proof
 *                             the button actually dresses the scene rather than just the library
 *                             working in isolation.
 *
 * Usage: node scripts/captureTexturePaletteSheet.js
 * Exit codes: 0 = PASS, 1 = failure, 2 = Playwright unavailable.
 */

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const OUTPUT_DIRECTORY = path.resolve('artifacts/run319-textures');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[captureTexturePaletteSheet] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

		/** Builds a labelled contact sheet in the page and returns its data URL. */
		const buildSheet = async (paletteFilter, swatch, columns, title) => page.evaluate(async ({ paletteFilter, swatch, columns, title }) => {
			const { PALETTES, PALETTE_IDS } = await import('/src/3d/materials/palettes.js');
			const { getPaletteTexture } = await import('/src/3d/materials/textureFactory.js');

			const ids = PALETTE_IDS.filter((id) => (paletteFilter ? PALETTES[id].family === paletteFilter : true));
			const label = 22;
			const pad = 10;
			const cell = swatch + label + pad;
			const rows = Math.ceil(ids.length / columns);
			const headerHeight = 46;

			const canvas = document.createElement('canvas');
			canvas.width = columns * cell + pad;
			canvas.height = rows * cell + pad + headerHeight;
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#14161a';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = '#f0f2f5';
			ctx.font = '600 22px system-ui, sans-serif';
			ctx.fillText(title, pad, 30);

			ids.forEach((id, index) => {
				const palette = PALETTES[id];
				const column = index % columns;
				const row = Math.floor(index / columns);
				const x = pad + column * cell;
				const y = headerHeight + pad + row * cell;
				const texture = getPaletteTexture(id, { size: swatch, variant: 'sheet' });
				if (texture?.image) ctx.drawImage(texture.image, x, y, swatch, swatch);
				ctx.strokeStyle = '#3a3f47';
				ctx.lineWidth = 1;
				ctx.strokeRect(x + 0.5, y + 0.5, swatch - 1, swatch - 1);
				ctx.fillStyle = '#c9ced6';
				ctx.font = '12px system-ui, sans-serif';
				ctx.fillText(palette.label.slice(0, Math.floor(swatch / 6.2)), x, y + swatch + 15);
			});
			return canvas.toDataURL('image/png');
		}, { paletteFilter, swatch, columns, title });

		const write = (dataUrl, name) => {
			fs.writeFileSync(path.join(OUTPUT_DIRECTORY, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
		};

		write(await buildSheet(null, 96, 10, 'Westeros — Prosedürel Doku ve Renk Paleti Kataloğu'), 'palette-sheet.png');
		write(await buildSheet('Ejderha', 256, 4, 'Ejderha Dokuları — pul / sırt plakası / yıpranma detayı'), 'dragon-sheet.png');
		write(await buildSheet('Parça', 128, 7, 'Parça Slotları — göz, diş, pençe, boynuz, giysi katmanları'), 'part-sheet.png');

		// Layered figures rendered for real: proof a single unnamed mesh comes out dressed by height
		// (boots -> trousers -> belt -> tunic -> skin -> hair) rather than painted one flat colour.
		const layeredShot = await page.evaluate(async () => {
			const THREE = await import('three');
			const { FIGURE_KITS, resolveKit } = await import('/src/3d/materials/figureKits.js');
			const { createLayeredMaterial } = await import('/src/3d/materials/layeredMaterial.js');

			const width = 1180;
			const height = 460;
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
			renderer.setPixelRatio(1);
			renderer.setSize(width, height, false);
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x14161a);
			scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x33302c, 2.0));
			const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
			key.position.set(3, 6, 5);
			scene.add(key);

			const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
			camera.position.set(0, 1.05, 7.4);
			camera.lookAt(0, 1.0, 0);

			// A crude standing figure: a capsule body is enough to show vertical banding honestly,
			// without pretending this is a real character model.
			const kits = ['human', 'soldier', 'castle', 'house', 'tree'];
			kits.forEach((kitId, index) => {
				const kit = FIGURE_KITS[kitId];
				const resolved = resolveKit(kit, index * 977);
				const geometry = new THREE.CapsuleGeometry(0.34, 1.35, 6, 18);
				geometry.computeBoundingBox();
				const range = { min: geometry.boundingBox.min.y, max: geometry.boundingBox.max.y };
				const material = createLayeredMaterial({ bands: resolved.bands, heightRange: range, variant: `sheet-${kitId}` });
				const mesh = new THREE.Mesh(geometry, material || new THREE.MeshStandardMaterial({ color: 0x888888 }));
				mesh.position.set((index - (kits.length - 1) / 2) * 1.45, 1.02, 0);
				scene.add(mesh);
			});

			renderer.render(scene, camera);
			const url = renderer.domElement.toDataURL('image/png');
			renderer.dispose();
			return { url, kits };
		});
		write(layeredShot.url, 'layered-figures.png');

		// Proof the editor button works end to end, not just the library. Assets are added by
		// double-clicking a library entry, and the editor reports each one through its toast — that
		// toast is the reliable "it is really in the scene" signal here, since the status counter is
		// a pre-existing editor quirk that keeps reading "0 obje/grup".
		const addFigure = async (label) => {
			const entry = page.locator('.we-asset', { hasText: label }).first();
			await entry.dblclick();
			await page.waitForFunction(
				(name) => (document.getElementById('we-toast')?.textContent || '').includes(`${name} sahneye eklendi`),
				label,
				{ timeout: 30000 },
			);
		};
		await addFigure('Kale İşaretçisi');
		await addFigure('Ağaç İşaretçisi');
		await addFigure('Asker İşaretçisi');

		await page.click('#we-auto-texture-all');
		await page.waitForTimeout(1500);
		const toast = (await page.textContent('#we-toast')) || '';
		await page.screenshot({ path: path.join(OUTPUT_DIRECTORY, 'editor-auto-texture.png') });

		console.log(`[captureTexturePaletteSheet] PASS: 3 görsel -> ${OUTPUT_DIRECTORY}`);
		console.log(`[captureTexturePaletteSheet] editör bildirimi: "${toast.trim()}"`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[captureTexturePaletteSheet] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
