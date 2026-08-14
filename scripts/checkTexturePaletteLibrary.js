#!/usr/bin/env node
/**
 * checkTexturePaletteLibrary.js — live-browser regression guard for the procedural palette/texture
 * library (`src/3d/materials/`) and the World Editor's auto-dressing action (DECISIONS.md ADR-0267).
 *
 * Runs against the real modules in a real page, because the painters need a genuine 2D canvas and
 * THREE — a Node-side mock would prove nothing about what actually renders.
 *
 * Asserts:
 *   1. Every palette has a registered painter (no palette can silently render nothing).
 *   2. Every palette actually produces a non-blank, non-uniform texture — the failure mode that
 *      matters is a painter that runs but leaves a flat fill, which a "did it throw?" test misses.
 *   3. Generation is deterministic: the same palette+variant yields byte-identical pixels twice.
 *   4. Different variants of one palette really do differ (so two castles are not clones).
 *   5. Texture caching actually shares instances rather than regenerating per call.
 *   6. Turkish/English name matching resolves a representative case set correctly.
 *   7. Auto-dressing an object swaps its material and `restoreOriginalMaterials` puts it back.
 *   8. `disposePaletteCaches()` empties both caches (memory-leak checklist).
 *
 * Usage: node scripts/checkTexturePaletteLibrary.js
 * Exit codes: 0 = PASS, 1 = contract failure, 2 = Playwright unavailable.
 */

const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Representative matcher cases spanning both languages, both scripts, and the tricky ones that
 * actually regressed during development (Turkish dotted/dotless i, agglutinative suffixes, and the
 * "Ana Yol" false positive that once dressed a road as a woman). */
const MATCH_CASES = [
	['Siyah Ejderha', 'dragon-black'], ['Ejderha Kanadı', 'dragon-wing'], ['Kızıl Ejderha', 'dragon-red'],
	['Buz Ejderhası', 'dragon-ice'], ['Altın Ejderha', 'dragon-gold'], ['black dragon', 'dragon-black'],
	['zürafa', 'giraffe'], ['Giraffe', 'giraffe'], ['FİL', 'elephant'], ['KEDİ', 'cat'], ['köpek', 'dog'],
	['At — Doru', 'horse-bay'], ['Atlar', 'horse-bay'], ['horse', 'horse-bay'], ['Kurt', 'wolf'],
	['Kale İşaretçisi', 'castle'], ['Kalesi', 'castle'], ['Buz Hisarı', 'castle-ice'],
	['Ağaç İşaretçisi', 'tree'], ['peasant_girl.fbx', 'peasant'], ['Paladin', 'knight'],
	['Deniz Hücresi', 'sea'], ['Ana Yol Segmenti', 'road-dirt'], ['Taş Yol', 'road-cobble'],
	['Patika', 'path'], ['köprü', 'bridge'], ['Güneş', 'sun'], ['ay', 'moon'], ['ayı', 'bear'],
	['çimen', 'grass'], ['kadın', 'woman'], ['erkek', 'man'], ['taşlar', 'stone'], ['kılıç', 'steel'],
	['karga', 'raven'], ['kar', 'snow'], ['Ev', 'house'], ['mermer', 'marble'],
];

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkTexturePaletteLibrary] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });

	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		const pageErrors = [];
		page.on('pageerror', (e) => pageErrors.push(`page:${e.message}`));
		page.on('console', (m) => {
			if (m.type() !== 'error') return;
			// Same pre-existing optional-directory probe as the response filter below.
			if (m.text().includes('Failed to load resource')) return;
			pageErrors.push(`console:${m.text()}`);
		});
		// Record the URL alongside the failure — a bare "404 Not Found" console line is not actionable.
		// One 404 is expected and pre-existing: editor.html's "Projeyi Tara" feature probes the optional
		// local FBX drop directory, and the dev static server answers directory requests with 404. Verified
		// present on main before this check existed, so it is filtered rather than left to mask real errors.
		page.on('response', (r) => {
			if (r.status() < 400) return;
			if (decodeURIComponent(r.url()).endsWith('/assets/models/fbx_dosyaları/')) return;
			pageErrors.push(`http:${r.status()} ${r.url()}`);
		});
		await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

		const result = await page.evaluate(async (matchCases) => {
			const THREE = await import('three');
			const { PALETTES, PALETTE_IDS, PALETTE_FAMILIES } = await import('/src/3d/materials/palettes.js');
			const factory = await import('/src/3d/materials/textureFactory.js');
			const { matchPalette } = await import('/src/3d/materials/textureMatcher.js');
			const autoTexture = await import('/src/3d/editor/EditorAutoTexture.js');

			const fail = (condition, message) => { if (!condition) throw new Error(message); };

			// 1. Every palette is paintable.
			const unpaintable = factory.findUnpaintablePalettes();
			fail(unpaintable.length === 0, `painter'ı olmayan palet(ler): ${unpaintable.join(', ')}`);

			/** Reads a generated texture's pixels back out of its canvas. */
			const readPixels = (texture) => {
				const image = texture.image;
				const canvas = typeof OffscreenCanvas === 'function' && image instanceof OffscreenCanvas
					? image
					: image;
				const context = canvas.getContext('2d');
				return context.getImageData(0, 0, canvas.width, canvas.height).data;
			};

			// 2. Each palette produces a real, varied image.
			const flat = [];
			for (const id of PALETTE_IDS) {
				const texture = factory.getPaletteTexture(id, { size: 64, variant: 'probe' });
				fail(Boolean(texture), `${id} için doku üretilemedi`);
				const data = readPixels(texture);
				let min = 255;
				let max = 0;
				let sum = 0;
				for (let i = 0; i < data.length; i += 4) {
					const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
					if (luma < min) min = luma;
					if (luma > max) max = luma;
					sum += luma;
				}
				// A painter that ran but produced a flat fill has zero spread — that is the bug this
				// catches, and it would pass any "did it throw" style check.
				if (max - min < 6) flat.push(`${id}(spread=${(max - min).toFixed(1)})`);
				fail(sum > 0, `${id} tamamen siyah`);
			}
			fail(flat.length === 0, `düz/boş doku üreten palet(ler): ${flat.join(', ')}`);

			// 3. Determinism: same inputs, identical pixels.
			factory.disposePaletteCaches();
			const first = Array.from(readPixels(factory.getPaletteTexture('dragon-black', { size: 64, variant: 'a' })));
			factory.disposePaletteCaches();
			const second = Array.from(readPixels(factory.getPaletteTexture('dragon-black', { size: 64, variant: 'a' })));
			fail(first.length === second.length, 'determinizm: boyut farkı');
			for (let i = 0; i < first.length; i += 1) {
				fail(first[i] === second[i], `determinizm bozuldu: byte ${i}`);
			}

			// 4. Different variants genuinely differ.
			const other = Array.from(readPixels(factory.getPaletteTexture('dragon-black', { size: 64, variant: 'b' })));
			let differing = 0;
			for (let i = 0; i < first.length; i += 1) if (first[i] !== other[i]) differing += 1;
			fail(differing > first.length * 0.02, `varyantlar birbirinin aynısı (fark ${differing})`);

			// 4b. Per-morph dragon scale shape (Run 322): each `dragon-scales` variant must resolve its
			// own scale geometry, not share one lattice recoloured. `dragon-black` is the deliberate
			// baseline (no profile entry) — everything else must differ from it and from each other.
			const dragonTextures = await import('/src/3d/materials/dragonTextures.js');
			const dragonPaletteIds = PALETTE_IDS.filter((id) => PALETTES[id].pattern === 'dragon-scales');
			fail(dragonPaletteIds.length >= 7, `beklenenden az ejderha pul deseni: ${dragonPaletteIds.length}`);
			const baseline = dragonTextures.resolveScaleDetail('dragon-black');
			fail(baseline === dragonTextures.DRAGON_DETAIL, 'dragon-black varsayılan lekeyi kullanmalı (profil yok)');
			const seenShapes = new Set();
			for (const id of dragonPaletteIds) {
				const detail = dragonTextures.resolveScaleDetail(id);
				const shapeKey = JSON.stringify(detail);
				fail(!seenShapes.has(shapeKey), `${id} başka bir ejderhayla aynı pul geometrisini paylaşıyor`);
				seenShapes.add(shapeKey);
				// resolveScaleDetail must be pure/deterministic — same id, same shape object contents twice.
				fail(JSON.stringify(dragonTextures.resolveScaleDetail(id)) === shapeKey, `${id} için tutarsız pul geometrisi`);
			}

			// 5. Cache shares instances.
			const t1 = factory.getPaletteTexture('castle', { size: 64, variant: 'x' });
			const t2 = factory.getPaletteTexture('castle', { size: 64, variant: 'x' });
			fail(t1 === t2, 'doku önbelleği paylaşmıyor');

			// 6. Matcher.
			const matchFailures = [];
			for (const [name, expected] of matchCases) {
				const match = matchPalette({ name });
				if (match.paletteId !== expected) matchFailures.push(`${name} -> ${match.paletteId} (beklenen ${expected})`);
			}
			fail(matchFailures.length === 0, `eşleşme hataları: ${matchFailures.join('; ')}`);

			// 7. Auto-dress + restore round trip on a real object.
			const originalMaterial = new THREE.MeshStandardMaterial({ color: 0x123456 });
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), originalMaterial);
			const group = new THREE.Group();
			group.name = 'Siyah Ejderha';
			group.add(mesh);

			const applied = autoTexture.autoTextureObject(group);
			fail(applied.ok, `otomatik giydirme başarısız: ${applied.error}`);
			fail(applied.paletteId === 'dragon-black', `yanlış palet: ${applied.paletteId}`);
			fail(mesh.material !== originalMaterial, 'materyal değişmedi');
			fail(Boolean(mesh.material.map), 'giydirilen materyalde doku yok');

			const restored = autoTexture.restoreOriginalMaterials(group);
			fail(restored === 1, `geri yükleme mesh sayısı ${restored}`);
			fail(mesh.material === originalMaterial, 'özgün materyal geri gelmedi');

			// 7b. Part-based kit dressing — the reason this system exists: a figure is many materials.
			const { surveyParts, classifyPart } = await import('/src/3d/materials/meshPartClassifier.js');
			const { FIGURE_KITS, resolveKit } = await import('/src/3d/materials/figureKits.js');
			const { createLayeredMaterial } = await import('/src/3d/materials/layeredMaterial.js');

			// Classification must survive the real naming conventions in this project's assets, which
			// were read off the actual models rather than assumed.
			const slotCases = [
				[{ materialName: 'Wolf Eyes' }, 'eye'],
				[{ materialName: 'Wolf Teeth' }, 'tooth'],
				[{ materialName: 'Wolf_claws' }, 'claw'],
				[{ materialName: 'Wolf_Fur' }, 'fur'],
				[{ meshName: 'Paladin_J_Nordstrom_Helmet' }, 'helmet'],
				[{ materialName: 'EYES.001' }, 'eye'],
				[{ meshName: 'Wolf3_eyes_0' }, 'eye'],
				[{ materialName: 'Sag_Boynuz' }, 'horn'],
				[{ materialName: 'cizme_deri' }, 'boot'],
				[{ materialName: 'govde_gomlek' }, 'tunic'],
			];
			for (const [input, expected] of slotCases) {
				const got = classifyPart(input)?.slot || null;
				fail(got === expected, `slot sınıflandırma: ${JSON.stringify(input)} -> ${got} (beklenen ${expected})`);
			}
			// A genuinely uninformative name must return null, not a confident wrong guess.
			fail(classifyPart({ materialName: 'Material.002', meshName: 'mesh_node' }) === null,
				'anlamsız isim için null dönmeliydi');

			// A multi-material mesh must be surveyed per material slot — the dragon is one mesh with
			// five materials, so per-mesh surveying would flatten its eyes into its body scales.
			const multiMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), [
				new THREE.MeshStandardMaterial({ name: 'Game_dragon.002' }),
				new THREE.MeshStandardMaterial({ name: 'EYES.001' }),
			]);
			const multiRoot = new THREE.Group();
			multiRoot.name = 'Siyah Ejderha';
			multiRoot.add(multiMesh);
			fail(surveyParts(multiRoot).length === 2, 'çok materyalli mesh materyal başına taranmalı');

			const dragonApplied = autoTexture.autoTextureObject(multiRoot);
			fail(dragonApplied.ok && dragonApplied.kit === 'dragon', `ejderha kiti seçilmedi: ${dragonApplied.kit}`);
			fail(dragonApplied.named >= 1, 'ejderha gözü adlandırılmış parça olarak giydirilmeliydi');
			fail(Array.isArray(multiMesh.material) && multiMesh.material.length === 2, 'materyal dizisi korunmalı');
			fail(multiMesh.material[0] !== multiMesh.material[1],
				'göz ve gövde aynı materyali paylaşmamalı — parçalara ayırmanın tüm amacı bu');

			// An unnamed single-material figure must come out dressed by height, not one flat colour.
			const plainMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.4, 4, 8), new THREE.MeshStandardMaterial());
            plainMesh.name = '';
			const plainRoot = new THREE.Group();
			plainRoot.name = 'Köylü';
			plainRoot.add(plainMesh);
			const banded = autoTexture.autoTextureObject(plainRoot);
			fail(banded.ok && banded.kit === 'human', `insan kiti seçilmedi: ${banded.kit}`);
			fail(banded.banded === 1, `katmanlı gövde beklendi, alınan: ${JSON.stringify(banded)}`);
			fail(Array.isArray(plainMesh.material?.userData?.layeredBands) && plainMesh.material.userData.layeredBands.length >= 4,
				'katmanlı materyal en az 4 bant taşımalı (çizme/pantolon/tunik/ten)');

			// Individuals must differ deterministically: two peasants, different tunic/skin choices.
			const kitA = resolveKit(FIGURE_KITS.human, 11);
			const kitB = resolveKit(FIGURE_KITS.human, 12);
			const kitA2 = resolveKit(FIGURE_KITS.human, 11);
			fail(JSON.stringify(kitA) === JSON.stringify(kitA2), 'aynı seed farklı sonuç verdi');
			fail(JSON.stringify(kitA) !== JSON.stringify(kitB), 'farklı seed aynı sonucu verdi');
			// The band fallback must follow the variant choice, or a named part and an unnamed one on
			// the same figure would wear different tunics.
			fail(kitA.bands.some((band) => band.palette === kitA.slots.tunic),
				'bantlar varyant seçimini takip etmiyor');

			// A palette with no part structure (stone) must keep the plain whole-object path.
			const stoneMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
			const stoneRoot = new THREE.Group();
			stoneRoot.name = 'Kaya';
			stoneRoot.add(stoneMesh);
			const stoneApplied = autoTexture.autoTextureObject(stoneRoot);
			fail(stoneApplied.ok && !stoneApplied.kit, `kaya için kit olmamalıydı: ${stoneApplied.kit}`);

			// 8. Dispose empties both caches.
			factory.getPaletteTexture('grass', { size: 64 });
			const before = factory.getPaletteCacheStats();
			fail(before.textures > 0, 'dispose öncesi önbellek boş');
			factory.disposePaletteCaches();
			const after = factory.getPaletteCacheStats();
			fail(after.textures === 0 && after.materials === 0, `dispose sonrası önbellek dolu: ${JSON.stringify(after)}`);

			return {
				paletteCount: PALETTE_IDS.length,
				familyCount: PALETTE_FAMILIES.length,
				families: PALETTE_FAMILIES,
				dragonCount: PALETTE_IDS.filter((id) => PALETTES[id].family === 'Ejderha').length,
				matchCases: matchCases.length,
				variantDifferingBytes: differing,
				slotCases: slotCases.length,
				kitCount: Object.keys(FIGURE_KITS).length,
				partPalettes: PALETTE_IDS.filter((id) => PALETTES[id].family === 'Parça').length,
			};
		}, MATCH_CASES);

		// The editor page must also expose the buttons themselves.
		for (const id of ['we-auto-texture', 'we-auto-texture-all', 'we-restore-texture']) {
			const exists = await page.$(`#${id}`);
			assert(exists, `editor.html'de #${id} butonu yok`);
		}

		if (pageErrors.length) throw new Error(`konsol/sayfa hatası: ${pageErrors.join('\n')}`);

		console.log(
			`[checkTexturePaletteLibrary] PASS: ${result.paletteCount} palet / ${result.familyCount} aile ` +
			`(${result.families.join(', ')}), ${result.dragonCount} ejderha varyantı, ` +
			`${result.matchCases}/${result.matchCases} TR-EN eşleşme, ${result.slotCases}/${result.slotCases} parça-slot sınıflandırma, ` +
			`${result.kitCount} figür kiti, ${result.partPalettes} parça paleti; determinizm + varyant + önbellek + ` +
			'çok-materyal + katmanlı gövde + giydir/geri-al + dispose doğrulandı, 3/3 editör butonu mevcut.',
		);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkTexturePaletteLibrary] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
