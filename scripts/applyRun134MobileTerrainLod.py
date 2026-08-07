#!/usr/bin/env python3
from pathlib import Path


def append_once(path, marker, text):
    p = Path(path)
    current = p.read_text()
    if marker in current:
        raise SystemExit(f"marker already present in {path}: {marker}")
    p.write_text(current + text)


chunk_patch = r'''

// Run 134 / ADR-0158 — mobile terrain distance LOD. This is deliberately layered after run 130's
// bounded-streaming wrapper so the proven radius-3 eviction behavior stays untouched. On coarse-
// pointer devices, terrain inside Chebyshev radius 1 keeps the original 64x64 subdivision density,
// radius 2 uses 32x32, and radius 3 uses 16x16. When the streaming center crosses a chunk boundary,
// resident chunks whose LOD band changed are rebuilt from the exact same seeded height sampler and
// flatten pads, then the old geometry/material are disposed immediately. Desktop loadChunk/
// streamTowards behavior remains byte-for-byte delegated to the pre-run-134 implementation.
const MOBILE_TERRAIN_LOD_SEGMENTS_RUN134 = Object.freeze({ NEAR: 64, MID: 32, FAR: 16 });

function isMobileCoarsePointerRun134() {
	return typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
}

function mobileTerrainLodSegmentsRun134(chunkX, chunkZ, centerX, centerZ) {
	const distance = Math.max(Math.abs(chunkX - centerX), Math.abs(chunkZ - centerZ));
	if (distance <= 1) return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.NEAR;
	if (distance === 2) return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.MID;
	return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.FAR;
}

function createMobileTerrainLodChunkRun134(manager, chunkX, chunkZ, segments) {
	const mesh = createTerrainChunk({
		chunkX,
		chunkZ,
		size: manager.chunkSizeMeters,
		segments,
		seed: manager.seed,
		flattenPads: manager.flattenPads,
	});
	mesh.userData.mobileTerrainLodSegmentsRun134 = segments;
	return mesh;
}

const _loadChunkBeforeMobileTerrainLodRun134 = ChunkManager.prototype.loadChunk;
ChunkManager.prototype.loadChunk = function loadChunkWithMobileTerrainLodRun134(chunkX, chunkZ) {
	if (!isMobileCoarsePointerRun134()) return _loadChunkBeforeMobileTerrainLodRun134.call(this, chunkX, chunkZ);
	const key = chunkKey(chunkX, chunkZ);
	const existing = this.loaded.get(key);
	if (existing) return existing;
	const center = this.mobileTerrainLodCenterRun134 ?? { x: 0, z: 0 };
	const segments = mobileTerrainLodSegmentsRun134(chunkX, chunkZ, center.x, center.z);
	const mesh = createMobileTerrainLodChunkRun134(this, chunkX, chunkZ, segments);
	this.scene.add(mesh);
	this.loaded.set(key, mesh);
	this.everGenerated.add(key);
	return mesh;
};

const _streamTowardsBeforeMobileTerrainLodRun134 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithMobileTerrainLodRun134(centerChunkX, centerChunkZ, radius) {
	if (!isMobileCoarsePointerRun134()) {
		return _streamTowardsBeforeMobileTerrainLodRun134.call(this, centerChunkX, centerChunkZ, radius);
	}
	this.mobileTerrainLodCenterRun134 = { x: centerChunkX, z: centerChunkZ };
	_streamTowardsBeforeMobileTerrainLodRun134.call(this, centerChunkX, centerChunkZ, radius);

	for (const [key, mesh] of [...this.loaded.entries()]) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		const desiredSegments = mobileTerrainLodSegmentsRun134(chunkX, chunkZ, centerChunkX, centerChunkZ);
		if (mesh.userData.mobileTerrainLodSegmentsRun134 === desiredSegments) continue;
		const replacement = createMobileTerrainLodChunkRun134(this, chunkX, chunkZ, desiredSegments);
		this.scene.remove(mesh);
		disposeTerrainChunk(mesh);
		this.scene.add(replacement);
		this.loaded.set(key, replacement);
	}
};
'''
append_once('src/3d/world/chunkManager.js', 'MOBILE_TERRAIN_LOD_SEGMENTS_RUN134', chunk_patch)


test_js = r'''#!/usr/bin/env node
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await context.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		const result = await page.evaluate(async () => {
			const [{ ChunkManager }, THREE] = await Promise.all([
				import('/src/3d/world/chunkManager.js'),
				import('/src/3d/vendor/three/three.module.js'),
			]);
			const scene = new THREE.Scene();
			const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: 1337 });
			manager.streamTowards(0, 0, 2);
			const sample = (x, z) => {
				const mesh = manager.getLoadedChunkMesh(x, z);
				return {
					segments: mesh?.userData.mobileTerrainLodSegmentsRun134 ?? null,
					vertices: mesh?.geometry.attributes.position.count ?? 0,
				};
			};
			const initial = { loaded: manager.loadedCount, near: sample(0, 0), mid: sample(2, 0), far: sample(3, 0) };
			manager.streamTowards(3, 0, 2);
			const moved = { loaded: manager.loadedCount, newNear: sample(3, 0), oldCenterNowFar: sample(0, 0) };
			const segmentHistogram = {};
			for (const mesh of manager.loaded.values()) {
				const segments = mesh.userData.mobileTerrainLodSegmentsRun134;
				segmentHistogram[segments] = (segmentHistogram[segments] ?? 0) + 1;
			}
			manager.disposeAll();
			return { coarse: window.matchMedia('(pointer: coarse)').matches, initial, moved, segmentHistogram, remaining: manager.loadedCount };
		});
		await context.close();
		const ok = result.coarse &&
			result.initial.loaded === 49 && result.moved.loaded === 49 &&
			result.initial.near.segments === 64 && result.initial.near.vertices === 4225 &&
			result.initial.mid.segments === 32 && result.initial.mid.vertices === 1089 &&
			result.initial.far.segments === 16 && result.initial.far.vertices === 289 &&
			result.moved.newNear.segments === 64 && result.moved.newNear.vertices === 4225 &&
			result.moved.oldCenterNowFar.segments === 16 && result.moved.oldCenterNowFar.vertices === 289 &&
			result.segmentHistogram['64'] === 9 && result.segmentHistogram['32'] === 16 && result.segmentHistogram['16'] === 24 &&
			result.remaining === 0;
		if (!ok) {
			console.error('[mobile-terrain-lod] FAIL', JSON.stringify(result));
			process.exit(1);
		}
		console.log(`[mobile-terrain-lod] PASS: 49 resident chunks = 9 near@64 + 16 mid@32 + 24 far@16; center-crossing regrades LOD; dispose=0.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[mobile-terrain-lod] FAIL:', error);
	process.exit(1);
});
'''
Path('scripts/checkMobileTerrainLod.js').write_text(test_js)


visual_js = r'''#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const out = path.resolve('artifacts/run134-mobile-lod');
	fs.mkdirSync(out, { recursive: true });
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await context.newPage();
		page.on('pageerror', (e) => errors.push(`page:${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), { timeout: 60000 });
		await page.screenshot({ path: path.join(out, 'mobile-near.png'), fullPage: true });
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.keyboard.down('KeyW');
		await page.waitForTimeout(1400);
		await page.keyboard.up('KeyW');
		await page.screenshot({ path: path.join(out, 'mobile-f4-far.png'), fullPage: true });
		await context.close();
		if (errors.length) throw new Error(errors.join('\n'));
		console.log(`[run134-visual] PASS: 2 mobile screenshots at ${out}; zero console/page errors.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[run134-visual] FAIL:', error);
	process.exit(1);
});
'''
Path('scripts/captureRun134MobileLodEvidence.js').write_text(visual_js)


governance = r'''

## 25. Mobil Terrain Mesafe-LOD Kapısı (run 134)

Mobil/coarse-pointer terrain resident alanı büyütülmeden önce aktif radius içindeki geometry yükü
mesafeye göre kademelendirilir. Run 134 referans politikası: streaming merkezine Chebyshev uzaklığı
0-1 chunk olan yakın halka 64 segment/kenar ile mevcut tam terrain ayrıntısını korur; uzaklık 2 olan
orta halka 32 segment/kenar; uzaklık 3 olan dış halka 16 segment/kenar kullanır. Oyuncu chunk sınırı
geçtiğinde halkası değişen resident chunk aynı deterministik seed + flatten-pad sampler ile yeniden
üretilir ve eski geometry/material hemen dispose edilir. Böylece collider/height sampler gerçeği
değişmez, yalnız render mesh tessellation maliyeti düşer. Desktop davranışı bu LOD katmanından
etkilenmez. Her LOD değişikliği `checkMobileTerrainLod.js`, `checkMobileChunkStreaming.js`, gerçek
mobil render bütçesi kapısı (§24), 34+ browser smoke ve iki mobil görsel kanıtı birlikte geçmelidir.
Belirgin pop-in veya yakın halkada geometri kaybı görülürse sonraki radius artışı yapılmaz; önce LOD
bantları yeniden değerlendirilir. Bu optimizasyon coverage yüzdesini tek başına yükseltmez; radius
3'ün yaklaşık %8.9 resident footprint'ini daha düşük GPU/triangle maliyetiyle güvenli tutarak sonraki
radius artışı için performans marjı üretir.
'''
append_once('GOVERNANCE.md', '## 25. Mobil Terrain Mesafe-LOD Kapısı (run 134)', governance)


decision = r'''

## ADR-0158 — Mobil terrain için mesafe tabanlı tessellation LOD (Run 134)

**Risk Seviyesi: LOW**

**Karar:** Coarse-pointer mobil terrain'de radius-3 resident kare korunurken, streaming merkezine
Chebyshev uzaklığı 0-1 olan chunk'lar 64, uzaklık 2 olanlar 32, uzaklık 3 olanlar 16 segment/kenar
ile üretilir. Merkez chunk değiştirdiğinde LOD bandı değişen resident chunk aynı seed/flatten-pad
parametreleriyle yeniden üretilir; eski geometry/material dispose edilir. Desktop yolu değişmez.

**Neden:** Run 132 gerçek mobil render ölçümü radius 3'te bütçe marjı olduğunu gösterdi; run 133'ün
radius 4 denemesi ise performanstan değil, mevcut additive-only regresyon testinin 49-chunk literal
sözleşmesinden dolayı bırakıldı. GOVERNANCE §23'ün sırası radius zorlamak yerine önce terrain/vegetation
LOD ve culling ister. `createTerrainChunk` zaten `segments` parametresini desteklediği için yeni bir
terrain algoritması icat etmeden aynı deterministik yüzeyi daha ucuz tessellation ile çizmek mümkün.

**Alternatifler:** (1) Radius 4'e doğrudan geçmek: run 133'te additive-only test sözleşmesi nedeniyle
reddedildi. (2) Bütün mobil chunk'ları 16/32 segment yapmak: yakın görüntü kalitesini gereksiz düşürür.
(3) Terrain'i hiç optimize etmeden yalnız vegetation azaltmak: triangle maliyetinin ana resident
terrain kısmına dokunmaz. (4) Uzak chunk'ları tamamen görünmez yapmak: coverage kazanımının görsel
anlamını azaltır.

**Sonuç:** Radius ve kümülatif coverage hesabı değişmez; mobil resident terrain aynı 49 chunk / 12.25
km² kalır. Ancak teorik terrain grid triangle yükü 49×64-segment yerine 9×64 + 16×32 + 24×16 dağılımına
iner. Oyuncuya yakın 3×3 halka tam ayrıntıyı korur. Chunk sınırı geçişinde yeniden tessellation maliyeti
oluşur; gerçek mobil perf testi ve görsel kanıt bu riskin kapısıdır.

**Etkilenen sistemler:** `world/chunkManager.js` mobil/coarse-pointer render mesh üretimi; terrain
geometry/material yaşam döngüsü; mobil performans. Ground collider, height sampler, yollar, nehir,
yerleşimler, desktop streaming, 2D oyun ve PWA cache içeriği değişmez.

**Geri alma planı:** Run 134'ün additive wrapper katmanını devre dışı bırakacak yeni bir additive
policy katmanı eklenir; alttaki run 130 bounded-streaming davranışı aynen korunmuştur. Stabil tag'e
dönüş de mümkündür.

**Gelecek Faz Etkisi:** FAZ 9-10 ve gelecekteki mobil dünya genişlemesi daha düşük terrain triangle
maliyetiyle çalışır. SaveSystem/public API yok; save/API uyumluluk kapıları tetiklenmez. Yeni asset yok,
lisans/PWA cache manifest değişikliği gerekmez.
'''
append_once('DECISIONS.md', '## ADR-0158 — Mobil terrain için mesafe tabanlı tessellation LOD (Run 134)', decision)

print('Run 134 staged: chunkManager mobile terrain LOD + regression test + visual evidence + governance + ADR.')
