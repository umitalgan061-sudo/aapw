#!/usr/bin/env python3
"""Apply Run 135 mobile vegetation geometry LOD as additive-only changes."""
from pathlib import Path


def append_once(path: str, marker: str, text: str) -> None:
    p = Path(path)
    current = p.read_text()
    if marker in current:
        raise SystemExit(f"marker already present in {path}: {marker}")
    p.write_text(current + text)


append_once(
    "src/3d/world/vegetation.js",
    "MOBILE_VEGETATION_LOD_RUN135",
    r'''

// Run 135 / ADR-0159 — mobile-only vegetation geometry LOD. The deterministic placement, species
// rolls, instance transforms, materials, and desktop geometry above remain untouched. On coarse-
// pointer devices only, this wrapper swaps each already-built InstancedMesh geometry for a lower-
// segment equivalent while preserving the exact instance matrices/counts. Old geometries are
// disposed immediately so the lower-detail path does not create a retained GPU-memory duplicate.
const MOBILE_VEGETATION_LOD_RUN135 = Object.freeze({
	trunkRadialSegments: 4,
	coneRadialSegments: 5,
	sphereWidthSegments: 5,
	sphereHeightSegments: 4,
});

function geometryTriangleCountRun135(geometry) {
	if (geometry.index) return geometry.index.count / 3;
	const positions = geometry.getAttribute('position');
	return positions ? positions.count / 3 : 0;
}

function buildMobileVegetationGeometryRun135(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = new THREE.CylinderGeometry(
		trunk.radiusTop,
		trunk.radiusBottom,
		trunk.height,
		MOBILE_VEGETATION_LOD_RUN135.trunkRadialSegments,
	);
	trunkGeometry.translate(0, trunk.height / 2, 0);

	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = new THREE.ConeGeometry(
			foliage.radius,
			foliage.height,
			MOBILE_VEGETATION_LOD_RUN135.coneRadialSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(
			foliage.radius,
			MOBILE_VEGETATION_LOD_RUN135.sphereWidthSegments,
			MOBILE_VEGETATION_LOD_RUN135.sphereHeightSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown mobile LOD foliage kind "${foliage.kind}" for species "${species.id}"`);
	}
	return { trunkGeometry, foliageGeometry };
}

const _createVegetationBeforeMobileLodRun135 = createVegetation;
createVegetation = function createVegetationWithMobileLodRun135(options) {
	const result = _createVegetationBeforeMobileLodRun135(options);
	const isMobileCoarsePointer = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
	if (!isMobileCoarsePointer || result.group.children.length === 0) return result;

	let desktopTriangles = 0;
	let mobileTriangles = 0;
	for (let speciesIndex = 0; speciesIndex < SPECIES.length; speciesIndex++) {
		const trunkMesh = result.group.children[speciesIndex * 2];
		const foliageMesh = result.group.children[speciesIndex * 2 + 1];
		const instanceCount = trunkMesh.count;
		desktopTriangles += geometryTriangleCountRun135(trunkMesh.geometry) * instanceCount;
		desktopTriangles += geometryTriangleCountRun135(foliageMesh.geometry) * foliageMesh.count;

		const oldTrunkGeometry = trunkMesh.geometry;
		const oldFoliageGeometry = foliageMesh.geometry;
		const mobileGeometry = buildMobileVegetationGeometryRun135(SPECIES[speciesIndex]);
		trunkMesh.geometry = mobileGeometry.trunkGeometry;
		foliageMesh.geometry = mobileGeometry.foliageGeometry;
		oldTrunkGeometry.dispose();
		oldFoliageGeometry.dispose();

		mobileTriangles += geometryTriangleCountRun135(trunkMesh.geometry) * instanceCount;
		mobileTriangles += geometryTriangleCountRun135(foliageMesh.geometry) * foliageMesh.count;
	}

	result.group.userData.mobileVegetationLodRun135 = Object.freeze({
		active: true,
		desktopTriangles,
		mobileTriangles,
		reductionRatio: desktopTriangles > 0 ? 1 - mobileTriangles / desktopTriangles : 0,
		placedCount: result.placedCount,
	});
	return result;
};

/** Read-only diagnostics used by the mobile vegetation regression gate. */
export function getMobileVegetationLodStatsRun135(group) {
	return group?.userData?.mobileVegetationLodRun135 ?? null;
}
''',
)

Path("scripts/checkMobileVegetationLod.js").write_text(r'''#!/usr/bin/env node
/** Runtime regression gate for Run 135 mobile vegetation geometry LOD. */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkMobileVegetationLod] FAIL: Playwright is unavailable.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		isMobile: true,
		hasTouch: true,
		userAgent: 'WesterosPWA-MobileVegetationLodGate/1.0',
	});
	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));

	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			{ timeout: 60000, polling: 250 },
		);
		const result = await page.evaluate(async () => {
			const vegetation = await import('./src/3d/world/vegetation.js');
			const created = vegetation.createVegetation({
				sampleHeightMeters: () => 20,
				seaLevelMeters: 6,
				seed: 1337,
				seats: [],
				roadEdges: [],
				radiusMeters: 1000,
				densityPerKm2: 30,
			});
			const stats = vegetation.getMobileVegetationLodStatsRun135(created.group);
			const counts = created.group.children.map((mesh) => mesh.count);
			vegetation.disposeVegetation(created.group);
			return { stats, counts, coarse: matchMedia('(pointer: coarse)').matches };
		});

		if (!result.coarse) throw new Error('coarse-pointer mobile path was not active');
		if (!result.stats?.active) throw new Error(`mobile vegetation LOD metadata missing: ${JSON.stringify(result)}`);
		if (!(result.stats.mobileTriangles < result.stats.desktopTriangles)) {
			throw new Error(`triangle reduction missing: ${JSON.stringify(result.stats)}`);
		}
		if (result.stats.reductionRatio < 0.25) {
			throw new Error(`vegetation triangle reduction too small: ${JSON.stringify(result.stats)}`);
		}
		if (!result.counts.length || result.counts.some((count) => count < 0)) {
			throw new Error(`invalid instance counts: ${JSON.stringify(result.counts)}`);
		}
		if (consoleErrors.length || pageErrors.length) {
			throw new Error(`console/page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
		}
		console.log(`[checkMobileVegetationLod] sample ${JSON.stringify(result)}`);
		console.log('[checkMobileVegetationLod] PASS: coarse-pointer vegetation keeps instances but lowers geometry triangles.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobileVegetationLod] FAIL:', error.message || error);
	process.exit(1);
});
''')

Path("scripts/captureRun135MobileVegetationEvidence.js").write_text(r'''#!/usr/bin/env node
/** Two-angle mobile visual evidence for Run 135 vegetation LOD. */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const outDir = path.resolve(__dirname, '..', 'artifacts', 'run135-mobile-vegetation-lod');
	fs.mkdirSync(outDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), { timeout: 60000 });
		await page.waitForTimeout(1500);
		await page.screenshot({ path: path.join(outDir, 'mobile-near.png'), fullPage: true });
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(1000);
		await page.screenshot({ path: path.join(outDir, 'mobile-f4-far.png'), fullPage: true });
		console.log('[captureRun135MobileVegetationEvidence] PASS: 2 mobile views captured.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}
main().catch((error) => { console.error(error); process.exit(1); });
''')

append_once(
    "GOVERNANCE.md",
    "## 26. Mobil Vegetation Geometry-LOD Kapısı",
    r'''

## 26. Mobil Vegetation Geometry-LOD Kapısı

Mobil World Coverage büyütme programında terrain LOD'den sonraki vegetation adımı ölçümlü ve
regresyon-korumalı ilerler:

- Coarse-pointer mobil yolunda deterministik ağaç yerleşimi, tür dağılımı, instance transformları ve
  materyaller korunur; yalnız primitive geometrisinin segment sayısı düşürülebilir.
- Masaüstü vegetation geometrisi aynı kalır. Mobil optimizasyon masaüstü görsel kalitesini azaltamaz.
- Geometry değiştirildiğinde eski geometry aynı işlemde `dispose()` edilmelidir; ikinci bir tam
  geometry kopyası GPU belleğinde tutulamaz.
- `scripts/checkMobileVegetationLod.js` gerçek mobile/touch Chromium context'inde çalışmalı; mobil
  LOD'nin aktif olduğunu, instance sayılarının korunduğunu ve vegetation triangle yükünün desktop
  geometrisine göre en az %25 düştüğünü doğrulamalıdır.
- Bu kapı `scripts/checkMobilePerfBudget.js` ile birlikte PASS olmadan vegetation optimizasyonu veya
  sonraki mobil radius artışı DONE sayılamaz.
- Görsel doğrulama en az iki mobil açıyla yapılır; belirgin silhouette kaybı/bozuk mesh varsa daha
  yüksek segment seviyesi seçilir.
''',
)

append_once(
    "DECISIONS.md",
    "## ADR-0159 — Mobile vegetation geometry LOD",
    r'''

## ADR-0159 — Mobile vegetation geometry LOD

**Risk Seviyesi:** LOW

**Karar:** Coarse-pointer mobil cihazlarda procedural vegetation'ın deterministik yerleşim ve
instance matrisi aynen korunurken trunk/foliage primitive segmentleri daha düşük geometriyle
çizilecek. Pine/round türleri, renkler, materyaller ve tree count değişmeyecek; desktop yolu mevcut
geometriyi kullanmaya devam edecek.

**Neden:** Run 134 terrain distance-LOD mobil triangle yükünü düşürdü ve bir sonraki governance
adımı vegetation optimizasyonu olarak kaydedildi. Mevcut vegetation zaten InstancedMesh kullandığı
için draw-call tarafı ucuz; en anlamlı yeni kazanç mesh başına vertex/triangle azaltımıdır.

**Alternatifler:** (1) Ağaç yoğunluğunu düşürmek reddedildi; dünya görsel içeriğini/seed çıktısının
sayısal yerleşimini değiştirir. (2) Billboard/impostor texture eklemek ertelendi; yeni asset/cache/
texture-memory yükü ve daha büyük blast radius getirir. (3) Per-instance her-frame distance
compaction şimdilik ertelendi; ilk güvenli adım statik mobile geometry LOD ile ölçülür.

**Sonuç:** Mobilde aynı ağaçlar ve aynı yerleşim daha düşük triangle maliyetiyle çizilir. Eski
geometry swap sırasında dispose edilir. `checkMobileVegetationLod.js` gerçek Chromium mobile/touch
context'inde en az %25 vegetation triangle azaltımını regresyon kapısı yapar.

**Etkilenen sistemler:** `world/vegetation.js`, mobil render bütçesi, görsel doğrulama. Terrain,
roads, settlements, gameplay, 2D oyun ve PWA cache içeriği değişmez.

**Geri alma planı:** Run 135'in additive wrapper'ını devre dışı bırakan yeni bir additive override
ile `_createVegetationBeforeMobileLodRun135` davranışına dön; mevcut satırları silme/değiştirme.
''',
)

print("Run 135 additive mobile vegetation LOD changes staged.")
