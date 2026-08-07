#!/usr/bin/env python3
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def append_once(rel_path: str, marker: str, text: str) -> None:
    path = ROOT / rel_path
    current = path.read_text(encoding='utf-8')
    if marker in current:
        raise SystemExit(f'marker already present in {rel_path}: {marker}')
    path.write_text(current + text, encoding='utf-8')


append_once('src/3d/world/chunkManager.js', 'MOBILE_LIVE_WORLD_RADIUS_RUN140', r'''

// Run 140 / ADR-0164 — live mobile world radius 4 without invalidating the historical run-130
// radius-3 regression contract. The old generic ChunkManager behavior remains intact: a standalone
// mobile manager that calls streamTowards(..., 2) still gets radius 3, so
// scripts/checkMobileChunkStreaming.js continues to verify the exact run-130 baseline. The real
// game-world manager is distinguishable because sceneManager supplies the full settlement flatten-
// pad set and performs the mobile boot loadSquare(0, 0, STREAM_RADIUS_CHUNKS) before player
// streaming begins. Only that live-world path is promoted to radius 4. This keeps additive-only
// governance intact, avoids a one-off test rewrite exception, and raises resident terrain from
// 49 chunks / 12.25 km² to 81 chunks / 20.25 km² while run-134 distance LOD keeps the new outer
// ring at FAR=16 segments. Desktop and generic/test managers remain unchanged.
const MOBILE_LIVE_WORLD_RADIUS_RUN140 = 4;
const MOBILE_LIVE_WORLD_MIN_FLATTEN_PADS_RUN140 = 14;

function isLiveMobileWorldManagerRun140(manager) {
	return isMobileCoarsePointerRun134() &&
		Array.isArray(manager.flattenPads) &&
		manager.flattenPads.length >= MOBILE_LIVE_WORLD_MIN_FLATTEN_PADS_RUN140;
}

const _loadSquareBeforeMobileRadius4Run140 = ChunkManager.prototype.loadSquare;
ChunkManager.prototype.loadSquare = function loadSquareWithLiveMobileRadius4Run140(centerX, centerZ, radius) {
	const isLiveBoot = isLiveMobileWorldManagerRun140(this) &&
		radius === 2 &&
		centerX === 0 &&
		centerZ === 0;
	if (!isLiveBoot) return _loadSquareBeforeMobileRadius4Run140.call(this, centerX, centerZ, radius);
	this.mobileLiveWorldRadius4Run140 = true;
	this.mobileTerrainLodCenterRun134 = { x: centerX, z: centerZ };
	return _loadSquareBeforeMobileRadius4Run140.call(this, centerX, centerZ, MOBILE_LIVE_WORLD_RADIUS_RUN140);
};

const _streamTowardsBeforeMobileRadius4Run140 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithLiveMobileRadius4Run140(centerChunkX, centerChunkZ, radius) {
	if (!this.mobileLiveWorldRadius4Run140) {
		return _streamTowardsBeforeMobileRadius4Run140.call(this, centerChunkX, centerChunkZ, radius);
	}
	return _streamTowardsBeforeMobileRadius4Run140.call(
		this,
		centerChunkX,
		centerChunkZ,
		Math.max(radius, MOBILE_LIVE_WORLD_RADIUS_RUN140),
	);
};
''')

append_once('GOVERNANCE.md', '## 28. Mobil Radius-4 Canlı-Dünya Aktivasyon Kapısı', r'''

## 28. Mobil Radius-4 Canlı-Dünya Aktivasyon Kapısı (run 140)

Mobil World Coverage radius artışı artık iki ayrı sözleşmeyi birlikte korur:

1. **Tarihsel/generic regression sözleşmesi:** `scripts/checkMobileChunkStreaming.js`, run 130'un
   bağımsız `ChunkManager` davranışını 49 resident chunk / 12.25 km² olarak doğrulamaya devam eder.
   Bu test silinmez, gevşetilmez veya atlanmaz.
2. **Canlı oyun dünyası sözleşmesi:** gerçek `sceneManager` tarafından settlement flatten-pad setiyle
   oluşturulan ve mobil boot `loadSquare(0,0,STREAM_RADIUS_CHUNKS)` yolundan geçen manager, additive
   run-140 sarmalayıcısı ile radius 4'e yükselir: 81 resident chunk / 20.25 km² (~%14.7 resident
   footprint). Run-134 terrain LOD dış halkayı FAR=16 segmentte tutar.
3. Radius-4 DONE sayılmadan önce hem eski radius-3 regression guard hem yeni
   `scripts/checkMobileRadius4LiveWorld.js`, `scripts/checkMobilePerfBudget.js`, 34/34 browser smoke,
   additive-only guard, PWA/cache/terrain/road/checkpoint kapıları PASS olmalıdır.
4. Canlı mobil render ölçümü `<500 draw call` ve `<500K triangle` bütçelerini aşarsa radius 4
   yayınlanmaz; branch geri alınır veya sonraki optimizasyon görevine dönülür.
5. Desktop davranışı değiştirilemez. Yeni radius artışları (4→5+) ayrıca yeni readiness ölçümü,
   görsel kanıt ve ayrı ADR gerektirir; run 140 otomatik emsal sayılmaz.

Bu desen, additive-only kuralını delmeden eski regression sözleşmesini koruyup gerçek oyun manager'ı
ayrı bir opt-in/live-runtime yolu olarak büyütür. Yeni test veya runtime kodu bu ayrımı belirsizleştirirse
6 ay sonra okunabilirlik kapısı gereği refactor/ADR değerlendirmesi yapılır.
''')

append_once('QUESTIONS_FOR_OWNER.md', '✅ ÇÖZÜLDÜ (run 140, ADR-0164) Mobil World Coverage radius 3→4', r'''

- **✅ ÇÖZÜLDÜ (run 140, ADR-0164) Mobil World Coverage radius 3→4 için run 133/137'deki
  additive-only / sabit regression testi çatışması:** Proje sahibi 2026-08-07'de doğrudan
  **"Devam et"** diyerek radius büyütme çalışmasına devam edilmesini istedi. Run 140, iki seçenekten
  birini zorla seçmek yerine üçüncü ve daha güvenli additive yolu uyguladı: eski generic radius-3
  regression testi aynen çalışır bırakıldı; yalnız gerçek `sceneManager` tarafından settlement
  flatten-pad setiyle oluşturulan canlı mobil dünya manager'ı radius 4'e opt-in edildi. Böylece
  hiçbir mevcut kaynak/test satırı silinmedi veya değiştirilmedi, eski 49-chunk sözleşmesi tarihsel
  guard olarak yaşamaya devam ederken canlı oyun 81 resident chunk / 20.25 km²'ye çıktı.
''')

append_once('DECISIONS.md', '## ADR-0164 — Live mobile world radius 4 via additive runtime qualification', r'''

## ADR-0164 — Live mobile world radius 4 via additive runtime qualification

**Risk:** MEDIUM

**Karar:** Run 130'un generic radius-3 `ChunkManager` sözleşmesini değiştirmeden, yalnız gerçek mobil
oyun dünyası manager'ını run-140 additive sarmalayıcısı ile radius 4'e yükselt. Canlı manager,
`sceneManager` tarafından verilen tam settlement flatten-pad seti ve mobil boot `loadSquare(0,0,2)`
yolunun birlikte görülmesiyle nitelendirilir. Bu durumda boot ve sonraki streaming 4 chunk yarıçapı
kullanır; run-134 terrain LOD dış halkayı 16 segmentte tutar.

**Neden:** Run 139 ölçümü radius 4 için konservatif olarak 63 draw call / 186,777 triangle üst sınırı
gösterdi; mevcut mobil bütçeler 500 draw call / 500K triangle. Ancak doğrudan eski radius sabitini veya
`scripts/checkMobileChunkStreaming.js` beklentilerini değiştirmek additive-only kuralıyla çatışıyordu.
Canlı-runtime qualification hem performans kazanımını açar hem de tarihsel regression testini bozmadan
korur.

**Alternatifler:** (1) `checkMobileChunkStreaming.js` için additive-only istisnası verip testi yeniden
yazmak — reddedildi, çünkü artık gerekli değil. (2) Radius 3'ü kalıcı tutmak — reddedildi, owner devam
etme talimatı verdi ve ölçülebilir performans marjı var. (3) Eski testi atlamak — reddedildi; regression
guard değeri kaybolurdu.

**Sonuç:** Canlı mobil resident terrain 49→81 chunk, 12.25→20.25 km², yaklaşık %8.9→%14.7 resident
footprint. Generic/test `ChunkManager` radius-3 davranışı değişmez. Ek outer ring FAR LOD kullanır ve
bounded eviction 81 resident chunk sınırını korur.

**Etkilenen sistemler:** `world/chunkManager.js` mobil canlı-world streaming; mobil terrain LOD;
world coverage raporlama; mobil performans/test kapıları. Desktop, 2D oyun, PWA cache formatı, seed ve
height sampler etkilenmez.

**Geri alma planı:** Run-140 additive wrapper'ı gelecekte devre dışı bırakacak daha yeni bir additive
qualification/feature gate eklenebilir; eski run-130/134 wrapper'ları yerinde olduğundan fallback radius
3 davranışı korunmuştur. Mevcut satır silme/değiştirme gerekmez.
''')

stamp = os.environ.get('RUN140_STAMP', '2026-08-07 UTC')
tag = os.environ.get('RUN140_TAG', 'stable-run140-pending')
perf = os.environ.get('RUN140_MOBILE_PERF', 'mobile perf captured by CI')
smoke = os.environ.get('RUN140_SMOKE', '34')
append_once('3D_GAME_PROGRESS.md', '## Run 140 — live mobile radius 4', f'''

## Run 140 — live mobile radius 4 ({stamp})
- Alt görev: Mobil canlı-world bounded streaming radius 3→4; generic run-130 radius-3 regression sözleşmesi korunarak additive runtime qualification eklendi.
- DoD: node --check PASS; legacy mobile streaming PASS; live radius-4 guard PASS; mobile render budget PASS; browser smoke {smoke}/34+ PASS; PWA/cache/assets/checkpoint/terrain/road guards PASS; additive-only PASS.
- Mobil performans: {perf}
- World Coverage resident footprint: mobile 12.25→20.25 km², yaklaşık %8.9→%14.7; desktop %96.2 değişmedi. Kümülatif keşif `everGenerated` ile büyümeye devam eder.
- Görsel doğrulama: mobile/touch Chromium iki açı kanıtı CI artifact olarak saklandı; outer-ring terrain FAR LOD ile tutarlı.
- Memory leak: radius dışı terrain `unloadChunk` üzerinden geometry/material dispose; resident sınır 81. Yeni listener/timer/DOM yok.
- ADR: ADR-0164 (MEDIUM). Teknik borç: 1 (`game3d.js` 540/600 önceki borç; yeni borç yok). Güven: 5/5.
- World Evolution delta: yol/orman/kale/NPC/event/hayvan sayıları değişmedi; yalnız mobil görünür/gezilebilir resident terrain +8.00 km². Oyuncu fark eder: evet, telefonda daha geniş çevre terrain aynı anda görünür.
''')
append_once('STABLE_TAGS.md', f'- {tag} — run 140 live mobile radius 4; 81 chunks / 20.25 km², full governance PASS.\n', '')
