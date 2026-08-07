from pathlib import Path


def append_once(path, marker, text):
    p = Path(path)
    current = p.read_text()
    if marker in current:
        raise SystemExit(f'marker already present in {path}: {marker}')
    p.write_text(current + text)


append_once('src/3d/world/chunkManager.js', 'MOBILE_STREAMING_RADIUS_CHUNKS_RUN130', r'''

// Run 130 / ADR-0153 — mobile bounded streaming policy. Kept as an additive prototype wrapper so
// GOVERNANCE.md's additive-only rule is preserved: the proven desktop implementation above remains
// byte-for-byte intact. Coarse-pointer devices widen the active terrain neighborhood from radius 2
// (25 chunks / 6.25 km²) to radius 3 (49 chunks / 12.25 km²) while evicting chunks outside that
// same radius after every chunk-boundary crossing. Cumulative World Coverage still grows through
// `everGenerated`; resident GPU/RAM terrain stays bounded at <=49 chunks instead of growing without
// limit during exploration. Desktop behavior is deliberately unchanged.
const MOBILE_STREAMING_RADIUS_CHUNKS_RUN130 = 3;
const _streamTowardsBeforeMobileCoverageRun130 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithMobileBoundRun130(centerChunkX, centerChunkZ, radius) {
	const isMobileCoarsePointer = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
	const effectiveRadius = isMobileCoarsePointer
		? Math.max(radius, MOBILE_STREAMING_RADIUS_CHUNKS_RUN130)
		: radius;

	_streamTowardsBeforeMobileCoverageRun130.call(this, centerChunkX, centerChunkZ, effectiveRadius);
	if (!isMobileCoarsePointer) return;

	for (const key of [...this.loaded.keys()]) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		const outsideResidentSquare =
			Math.abs(chunkX - centerChunkX) > effectiveRadius ||
			Math.abs(chunkZ - centerChunkZ) > effectiveRadius;
		if (outsideResidentSquare) this.unloadChunk(chunkX, chunkZ);
	}
};
''')

append_once('GOVERNANCE.md', '## 23. Mobil World Coverage Büyütme Politikası', r'''

---

## 23. Mobil World Coverage Büyütme Politikası (run 130)

Proje sahibinin mobil World Coverage'i yükseltme talebi kalıcı bir mühendislik hedefidir. Bu hedef
"daha fazla chunk'ı aynı anda telefona yükle" şeklinde uygulanmaz; mobil bütçeyi koruyan kademeli
**streaming + eviction + LOD/asset optimizasyonu** programı olarak yürütülür.

1. **Bounded streaming zorunlu:** mobil/coarse-pointer cihazda oyuncu ilerledikçe yeni chunk'lar
   yüklenebilir fakat aktif yarıçapın dışında kalan terrain chunk'ları GPU/RAM'den boşaltılır.
   `everGenerated` korunur; böylece kümülatif keşif/World Coverage büyürken resident bellek sınırsız
   büyümez.
2. **Kademeli radius artışı:** her radius artışı ayrı bir alt görevdir. Önce mevcut mobile bütçeler
   (`DrawCalls<500`, `Triangles<500K`, `TextureMem<512MB`, hedef 30-60 FPS), sonra coarse-pointer
   runtime testi, sonra full browser smoke kontrol edilir. Bütçe aşılırsa radius geri büyütülmez;
   önce LOD/culling/texture optimizasyonu yapılır.
3. **Run 130 başlangıç seviyesi:** mobil streaming radius 2'den 3'e çıkarılır. Kare footprint 25
   chunk'tan 49 chunk'a, 6.25 km²'den 12.25 km²'ye çıkar; 137.5 km² dünya hedefi bazında başlangıç
   footprint coverage yaklaşık %4.5'ten %8.9'a yükselir. Bu değer gerçek mobil runtime testleriyle
   doğrulanmadan daha yüksek bir oran raporlanmaz.
4. **Sonraki optimizasyon sırası:** (a) mesafe tabanlı terrain/vegetation LOD, (b) frustum ve mümkün
   olduğunda occlusion culling, (c) kale/ağaç uzak-mesafe düşük-poly veya impostor yaklaşımı,
   (d) texture atlas/sıkıştırma ve mobil texture boyutu, (e) ölçüm sonrası yeni radius artışı.
5. **Görsel kalite koruması:** LOD geçişleri belirgin pop-in üretmemeli; yeni mobil coverage alt
   görevlerinde yakın+uzak en az iki görsel kanıt ve F4/free-camera kontrolü tutulur.
6. **PWA/offline koruması:** streaming yalnız repoda/service-worker cache politikasınca erişilebilir
   asset'leri kullanır. Mobil coverage artırmak CDN/HBO asset bağımlılığı eklemek için gerekçe değildir.
7. **Deterministik dünya korunur:** chunk unload/reload aynı seed+koordinatta aynı terrain sonucunu
   üretmek zorundadır; eviction kümülatif `everGenerated` metriğini veya prosedürel checksum
   kurallarını sıfırlayamaz.
8. **Dinamik öncelik:** mobil World Coverage %98'in altındayken ve daha üst sırada blocking bug /
   performans / memory-leak problemi yokken bu program aktif iyileştirme alanlarından biridir.
''')

append_once('DECISIONS.md', '## ADR-0153 — Mobil bounded streaming ile coverage radius 2→3', r'''

## ADR-0153 — Mobil bounded streaming ile coverage radius 2→3 (run 130)

**Risk seviyesi:** MEDIUM

**Karar:** Coarse-pointer mobil cihazlarda `ChunkManager.streamTowards` additive bir wrapper ile
radius 3 kullanacak ve aynı radius dışındaki terrain chunk'larını her chunk geçişinde `unloadChunk`
ile dispose edecek. Desktop path aynen korunacak. Böylece resident terrain 49 chunk ile sınırlı
kalırken oyuncunun gezdiği yeni chunk'lar `everGenerated` üzerinden kümülatif World Coverage'e
katılmaya devam edecek.

**Neden:** Önceki radius 2 footprint'i 25×0.25=6.25 km², yani 137.5 km² hedef dünyanın yaklaşık
%4.5'iydi. Radius'u eviction olmadan büyütmek uzun mobil oturumlarda resident geometry/material
sayısını sınırsız büyütürdü. Önce bounded eviction eklemek, radius artışını bellek açısından güvenli
hale getirir. Radius 3 footprint'i 49×0.25=12.25 km² (~%8.9) ile ilk ölçülü artıştır.

**Alternatifler:** Radius'u doğrudan 4+ yapmak reddedildi; gerçek mobil ölçüm olmadan fazla agresif.
Sadece eviction ekleyip radius 2'de kalmak güvenli ama sahibin açık coverage artışı talebini bu run'da
ilerletmiyor. Tüm world'ü resident tutmak mobil performans/bellek bütçeleriyle çelişiyor.

**Sonuç / etkilenen sistemler:** `world/chunkManager.js` mobil streaming davranışı; terrain reload,
camera collision'ın yakın-chunk lookup'u ve kümülatif coverage metriği. NPC/dragon/road/settlement,
2D oyun ve desktop streaming davranışı değişmez. Resident terrain üst sınırı mobilde 49 chunk olur.

**Geri alma planı:** Additive wrapper devre dışı bırakılarak önceki `streamTowards` radius 2 ve
no-eviction davranışına dönülebilir. Kalıcı save/schema migrasyonu yoktur.

**Gelecek faz etkisi:** FAZ 9-10 ve daha büyük asset dünyası için olumlu; sınırlı resident terrain
LOD, vegetation culling ve asset streaming çalışmalarına ölçülebilir temel sağlar. Yeni SaveSystem
veya public API bağımlılığı oluşturmaz.
''')

Path('scripts/checkMobileChunkStreaming.js').write_text(r'''#!/usr/bin/env node
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
			const coarse = window.matchMedia('(pointer: coarse)').matches;
			manager.streamTowards(0, 0, 2);
			const initial = { loaded: manager.loadedCount, ever: manager.everGeneratedCount, area: manager.getCoveredAreaKm2() };
			manager.streamTowards(7, 0, 2);
			const moved = { loaded: manager.loadedCount, ever: manager.everGeneratedCount, area: manager.getCoveredAreaKm2(), oldCenterResident: Boolean(manager.getLoadedChunkMesh(0, 0)), newCenterResident: Boolean(manager.getLoadedChunkMesh(7, 0)) };
			manager.disposeAll();
			return { coarse, initial, moved, remaining: manager.loadedCount };
		});
		await context.close();
		const ok = result.coarse && result.initial.loaded === 49 && result.initial.ever === 49 && result.initial.area === 12.25 && result.moved.loaded === 49 && result.moved.ever > 49 && result.moved.area === 12.25 && !result.moved.oldCenterResident && result.moved.newCenterResident && result.remaining === 0;
		if (!ok) { console.error('[mobile-streaming] FAIL', JSON.stringify(result)); process.exit(1); }
		console.log(`[mobile-streaming] PASS: resident ${result.initial.loaded} chunks / ${result.initial.area.toFixed(2)} km²; cumulative=${result.moved.ever}; bounded resident=${result.moved.loaded}; dispose=0.`);
	} finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error('[mobile-streaming] FAIL:', error); process.exit(1); });
''')

Path('scripts/captureRun130MobileEvidence.js').write_text(r'''#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const out = path.resolve('artifacts/run130-mobile');
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
		console.log(`[run130-visual] PASS: 2 screenshots at ${out}; zero console/page errors.`);
	} finally { await browser.close(); server.close(); }
}
main().catch((e) => { console.error('[run130-visual] FAIL:', e); process.exit(1); });
''')
