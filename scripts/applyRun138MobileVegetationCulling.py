from pathlib import Path


def insert_once(path, marker, addition):
    p = Path(path)
    text = p.read_text()
    if addition.strip() in text:
        raise SystemExit(f'already applied: {path}')
    if marker not in text:
        raise SystemExit(f'marker missing: {path}: {marker}')
    p.write_text(text.replace(marker, marker + addition, 1))


def append_once(path, marker, addition):
    p = Path(path)
    text = p.read_text()
    if marker in text:
        raise SystemExit(f'already applied: {path}: {marker}')
    p.write_text(text + addition)


append_once(
    '3D_GAME_PROGRESS.md',
    '## Run 138 RCA — staged runtime module vs baseline PWA cache guard',
    """

## Run 138 RCA — staged runtime module vs baseline PWA cache guard
- **Root Cause:** Run 138'in yeni `mobileVegetationCulling.js` runtime modülü branch'e baseline
  testinden önce eklenince standing `checkServiceWorkerCache.js` guard'ı doğru biçimde yeni modülün
  henüz `GAME3D_SHELL_FILES` içinde olmadığını gördü. İlk birleşik baseline adımı aynı nedenle düştü;
  ikinci denemede adımlar ayrılınca hata açıkça service-worker cache kapısına izole edildi.
- **Prevention:** Değişiklik-öncesi doğrulama artık branch çalışma ağacında değil gerçek
  `origin/main` detached worktree'sinde koşacak. Yeni runtime modülü post-change aşamasında
  service-worker precache listesine additive olarak eklenecek; branch'teki staged dosyalar baseline
  gerçeğini bir daha kirletemeyecek.
- **Regression Test:** Post-change `checkServiceWorkerCache.js` yeni modülü precache listesinde
  görmeden PASS edemez; ayrıca tam PWA/browser smoke offline import zincirini doğrulamaya devam eder.
""",
)

append_once(
    'src/3d/config.js',
    'MOBILE_VEGETATION_CULLING_CONFIG_RUN138',
    """

/** Run 138 / ADR-0162: mobile vegetation whole-disc culling thresholds. Centralized here per the
 * project's no-magic-numbers rule. The 1500m resident terrain radius is run-130's effective
 * coarse-pointer radius 3 * 500m chunks; each vegetation disc is run-135's 1000m scatter radius.
 * A 100m intersection margin prevents edge popping while crossing the overlap boundary. */
export const MOBILE_VEGETATION_CULLING_CONFIG_RUN138 = Object.freeze({
	RESIDENT_TERRAIN_RADIUS_METERS: 1500,
	VEGETATION_DISC_RADIUS_METERS: 1000,
	INTERSECTION_MARGIN_METERS: 100,
});
""",
)

insert_once(
    'src/3d/game3d.js',
    "import { updateFog } from './fog.js';\n",
    "import { updateMobileVegetationDistanceCullingRun138 } from './world/mobileVegetationCulling.js';\n",
)

insert_once(
    'src/3d/game3d.js',
    "\t\t\tstreamAroundOrbitTarget(state);\n",
    "\t\t\tupdateMobileVegetationDistanceCullingRun138(playerPos, [\n"
    "\t\t\t\t{ id: 'origin', group: state.vegetation },\n"
    "\t\t\t\t{ id: 'spawn', group: state.mobileSpawnVegetation },\n"
    "\t\t\t], isCoarsePointerDevice());\n",
)

insert_once(
    'service-worker.js',
    "    './src/3d/world/vegetation.js',\n",
    "    './src/3d/world/mobileVegetationCulling.js',\n",
)

append_once(
    'GOVERNANCE.md',
    '## 27. Mobil Vegetation Distance-Culling Kapısı',
    """

## 27. Mobil Vegetation Distance-Culling Kapısı (run 138)

Mobil/coarse-pointer sahnede vegetation diskleri yalnız resident terrain komşuluğuyla kesişiyorsa
render edilir. Amaç World Coverage büyümesi öncesinde mobil draw/triangle bütçesini boşaltmak ve
unloaded terrain üzerinde uzakta kalan ağaç gruplarının çizilmesini önlemektir.

- Desktop görünürlüğü değiştirilemez; bu kapı yalnız coarse-pointer yolunda aktiftir.
- Culling kararı tek tek ağaçlar için CPU taraması yapmaz; InstancedMesh gruplarını disk-merkez
  mesafesine göre bütün halinde açıp kapatır, böylece her-frame maliyeti sabit ve küçüktür.
- Eşikler `src/3d/config.js` içindeki `MOBILE_VEGETATION_CULLING_CONFIG_RUN138`'de merkezi tutulur;
  runtime dosyalarına magic number yazılmaz.
- Bir vegetation diski resident terrain yarıçapı + kendi scatter yarıçapı + güvenlik marjı dışında
  kalırsa görünmez olur; oyuncu yaklaşınca aynı deterministik instance verisi yeniden görünür hale
  gelir, yeniden üretim yapılmaz.
- Yeni runtime modülü `service-worker.js` GAME3D precache listesinde bulunmadan PWA cache guard PASS
  sayılamaz. Baseline cache doğrulaması staged branch yerine gerçek `origin/main` worktree'sinde
  koşar; böylece henüz post-change cache kaydı yapılmamış yeni dosya baseline'ı sahte biçimde bozmaz.
- Değişiklikten sonra `scripts/checkMobileVegetationCulling.js`, `scripts/checkMobilePerfBudget.js`
  ve tam browser smoke PASS olmadan DONE yoktur. Görsel kanıt mobile+touch Chromium'da en az iki
  kare olarak saklanır.
- Radius 3→4 konusu `QUESTIONS_FOR_OWNER.md` yanıtlanana kadar bu optimizasyondan bağımsız biçimde
  bloklu kalır; bu kural o ürün/yönetişim kararını dolanmak için kullanılamaz.
""",
)

append_once(
    'DECISIONS.md',
    '## ADR-0162 — Mobil vegetation disk distance culling',
    """

## ADR-0162 — Mobil vegetation disk distance culling (run 138)

**Risk Seviyesi:** LOW

**Karar:** Mobil/coarse-pointer modunda world-origin ve spawn-anchored vegetation diskleri, oyuncunun
resident terrain komşuluğuyla kesişmediklerinde `group.visible = false` ile bütün halinde cull edilir.
Desktop davranışı değişmez. Eşikler merkezi config'tedir; instance verileri silinmez veya yeniden
üretilmez. Yeni runtime modülü aynı run içinde 3D PWA precache listesine eklenir.

**Neden:** Run 135 mobil spawn vegetation boşluğunu kapattı, run 136 geometry LOD triangle maliyetini
azalttı. Buna rağmen iki disk de sahnede kalıyor; spawn oyuncusu origin diskinden yaklaşık 4.1 km
uzakta ve bounded mobile terrain bunun çok gerisinde bitiyor. Bu disk o anda oynanabilir resident
terrain ile kesişmediği için render bütçesi harcaması anlamsız ve unloaded-terrain görsel riski taşır.

**Alternatifler:** Tek tek tree-instance distance culling reddedildi; her frame yüzlerce instance
matrisi taramak, dört InstancedMesh draw'ını grup seviyesinde kapatmaktan daha pahalı ve karmaşık.
Origin vegetation'i tamamen silmek reddedildi; oyuncu ileride o bölgeye yaklaşabilir ve deterministik
scatter korunmalıdır. Radius 4 reddedilmedi fakat owner eskalasyonu çözülene kadar ayrı olarak bloklu.

**Sonuç:** Mobil spawn konumunda uzaktaki origin vegetation draw'ları/triangle'ları çıkar; spawn diski
aynı kalır. Oyuncu origin bölgesine yaklaştığında görünürlük otomatik geri gelir. Desktop değişmez.

**Etkilenen sistemler:** `src/3d/config.js`, `src/3d/world/mobileVegetationCulling.js`, küçük
`game3d.js` wiring, `service-worker.js` precache ve mobil perf/smoke regression zinciri. Terrain
üretimi, seed ve 2D oyun değişmez.

**Geri alma planı:** Additive bir override ile updater çağrısını no-op yap veya config eşiklerini bütün
diskleri görünür tutacak güvenli değere yükselt; mevcut satır silme/değiştirme gerektirme.
""",
)

append_once(
    'CATCH_UP.md',
    '## Run 138 — Mobil uzaktaki ağaç grupları artık boşuna çizilmiyor',
    """

## Run 138 — Mobil uzaktaki ağaç grupları artık boşuna çizilmiyor
Mobil oyunda artık oyuncunun bulunduğu yüklenmiş araziyle hiçbir şekilde kesişmeyen uzak ağaç diski
render edilmiyor. Spawn çevresindeki yeni ağaçlar görünmeye devam ediyor; dünya merkezindeki ağaçlar
oyuncu kilometrelerce uzaktayken GPU bütçesi tüketmiyor. Oyuncu o bölgeye yaklaşırsa aynı deterministik
ağaçlar yeniden görünür oluyor; veri silinmiyor ve yeniden rastgele üretilmiyor. Masaüstü sürümünde
hiçbir görünürlük değişikliği yok. Bu adım mobil World Coverage'ı doğrudan büyütmüyor; radius artışı
owner kararı beklerken bir sonraki genişleme için güvenli performans payı hazırlıyor. Tam browser smoke,
mobil render bütçesi, PWA cache ve özel culling testiyle doğrulanıyor.
""",
)
