#!/usr/bin/env python3
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text()
def write(path, text): (ROOT / path).write_text(text)

def insert_after(path, anchor, addition):
    text = read(path)
    if addition.strip() in text:
        return
    if anchor not in text:
        raise SystemExit(f'anchor missing in {path}: {anchor!r}')
    write(path, text.replace(anchor, anchor + addition, 1))

def append_once(path, marker, block):
    text = read(path)
    if marker in text:
        return
    write(path, text.rstrip() + '\n\n' + block.strip() + '\n')

# One mutable live binding for future additive radius increments. A future radius-5 wrapper can
# simply append an assignment to this exported binding; culling consumers do not copy radius values.
append_once(
    'src/3d/world/chunkManager.js',
    'export let MOBILE_LIVE_WORLD_RADIUS_CHUNKS = MOBILE_LIVE_WORLD_RADIUS_RUN140;',
    '''// Run 141 / ADR-0165 — exported live binding for mobile systems that must follow the actual
// runtime streaming radius without duplicating a stale literal. Future additive radius wrappers
// update this binding after their own declaration.
export let MOBILE_LIVE_WORLD_RADIUS_CHUNKS = MOBILE_LIVE_WORLD_RADIUS_RUN140;'''
)

append_once(
    'src/3d/config.js',
    'MOBILE_VEGETATION_CULLING_CONFIG_RUN141',
    '''/** Run 141 / ADR-0165 — whole-disc mobile vegetation culling safety margin. Terrain radius
 * and vegetation-disc radius are derived from their live/config sources in the culling module;
 * only the visual overlap margin is a tuning value here, per the no-magic-numbers rule. */
export const MOBILE_VEGETATION_CULLING_CONFIG_RUN141 = Object.freeze({
\tINTERSECTION_MARGIN_METERS: 100,
});'''
)

insert_after(
    'src/3d/game3d.js',
    "import { updateFog } from './fog.js';",
    "\nimport { updateMobileVegetationDistanceCullingRun141 } from './world/mobileVegetationCulling.js';"
)
insert_after(
    'src/3d/game3d.js',
    '\t\t\tstreamAroundOrbitTarget(state);',
    "\n\t\t\tupdateMobileVegetationDistanceCullingRun141(playerPos, [\n\t\t\t\t{ id: 'origin', group: state.vegetation },\n\t\t\t\t{ id: 'spawn', group: state.mobileSpawnVegetation },\n\t\t\t], Boolean(state.touchJoystick));"
)
insert_after(
    'service-worker.js',
    "    './src/3d/world/vegetation.js',",
    "\n    './src/3d/world/mobileVegetationCulling.js',"
)

append_once(
    'GOVERNANCE.md',
    '## 29. Mobil Vegetation Distance-Culling Kapısı (run 141)',
    '''## 29. Mobil Vegetation Distance-Culling Kapısı (run 141)

Mobil/coarse-pointer sahnede vegetation diskleri yalnız oyuncunun resident terrain komşuluğuyla
kesişebilecek durumdaysa render-visible kalır. Uzak disklerin instance verisi silinmez; oyuncu geri
yaklaşınca aynı deterministik ağaçlar yeniden görünür.

- Culling eşiğinin resident-terrain kısmı sabit bir radius kopyasından hesaplanamaz; `chunkManager.js`
  içindeki `MOBILE_LIVE_WORLD_RADIUS_CHUNKS` live binding'i kullanılmalıdır. Her gelecekteki radius
  artışı bu binding'i aynı additive değişiklikte güncellemek zorundadır.
- Vegetation disk yarıçapı `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS * CHUNK_SIZE_METERS` üzerinden türetilir;
  tek serbest tuning değeri config'teki güvenlik marjıdır.
- Desktop görünürlüğü değiştirilemez. Mobil updater yalnız whole-group `visible` durumunu değiştirir;
  seed, instance matrix, geometry/material veya placement verisini mutasyona uğratamaz.
- Yeni runtime modülü service-worker 3D shell precache listesinde bulunmadan PWA cache kapısı PASS
  sayılamaz.
- `checkMobileVegetationCullingRun141.js`, mobile render budget, radius-4 live guard, vegetation LOD,
  34+ browser smoke ve iki mobil görsel kanıt birlikte PASS olmadan DONE yoktur.
- Bu optimizasyon coverage yüzdesini tek başına artırmaz; radius-4 (~%14.7 resident footprint) üzerinde
  gereksiz uzak vegetation çizimini engelleyerek sonraki coverage artışları için güvenli temel sağlar.'''
)

append_once(
    'DECISIONS.md',
    '## ADR-0165 — Live-radius-aware mobile vegetation distance culling',
    '''## ADR-0165 — Live-radius-aware mobile vegetation distance culling (run 141)

**Risk Seviyesi:** LOW

**Karar:** Run 138'de doğrulanıp merge edilemeden diverge olan whole-disc mobile vegetation culling,
run 140'ın canlı radius-4 mimarisine yeniden uygulanır. Eski denemenin sabit 1500m resident-radius
kopyası kullanılmaz; culling `chunkManager.js` içindeki exported live radius binding'inden türetilir.

**Neden:** Mobil terrain artık 81 chunk / 20.25 km² resident iken origin ve spawn vegetation diskleri
sahnede birlikte kalıyor. Resident terrain ile kesişmesi mümkün olmayan uzak bir disk görünür
kalmak zorunda değil. Ayrıca sabit radius kopyası gelecekte radius 5'te sessizce stale olurdu.

**Alternatifler:** Tek tek instance taraması CPU maliyeti ve karmaşıklık nedeniyle reddedildi. Origin
diskini tamamen silmek deterministik geri dönüşü yok edeceği için reddedildi. Run 138 kodunu aynen
cherry-pick etmek, radius-3'e gömülü 1500m eşiği nedeniyle reddedildi.

**Sonuç:** Mobilde uzak vegetation grubu whole-group visibility ile kapanır; oyuncu yaklaşınca aynı
instance verisi tekrar görünür. Desktop değişmez. Yeni live binding radius artışlarında tek kaynak
olarak güncellenebilir.

**Etkilenen sistemler:** chunkManager mobile radius metadata, config, game3d tick wiring,
mobileVegetationCulling runtime modülü, service-worker precache ve mobil regression zinciri.

**Geri alma planı:** Additive bir override ile updater no-op yapılabilir veya margin güvenli biçimde
büyütülebilir; mevcut kaynak satırlarını silmek/değiştirmek gerekmez.'''
)

if os.environ.get('RUN141_FINALIZE') == '1':
    stamp = os.environ['RUN141_STAMP']
    mobile = os.environ['RUN141_MOBILE_PERF']
    smoke = os.environ['RUN141_SMOKE']
    append_once(
        '3D_GAME_PROGRESS.md',
        '## Run 141 — live-radius-aware mobile vegetation culling',
        f'''## Run 141 — live-radius-aware mobile vegetation culling ({stamp})
- Alt görev: radius-4 mobil dünyada resident terrain ile kesişemeyen origin/spawn vegetation diskleri whole-group visibility ile cull ediliyor; eski Run 138 fikri güncel mimariye taşındı.
- DoD: baseline + post-change browser smoke {smoke}/34+ PASS; culling/radius4/mobile-perf/terrain/vegetation/PWA/cache/asset/road/seat/checkpoint/additive guard'ları PASS; iki mobil görsel kanıt artifact olarak saklandı.
- Mobil performans: {mobile}
- World Coverage: desktop %96.2; mobil resident terrain ~%14.7 (81 chunk / 20.25 km²), bu run coverage'i büyütmedi.
- Memory leak checklist: yeni geometry/material/listener/timer yok; yalnız group.visible + küçük userData state. Teknik borç: 1 (`game3d.js` 545/600 civarı). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km, orman/ağaç sayısı 0, kale/NPC/event/hayvan 0; oyuncu uzaktaki gereksiz ağaç disklerinin çizilmemesini performans/temizlik olarak hisseder. Sıradaki adım: radius-5 readiness ölçümü.'''
    )
