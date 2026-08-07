import os
from pathlib import Path

stamp = os.environ['RUN148_STAMP']
perf_row = os.environ['RUN148_PERF_ROW']
tag = os.environ['RUN148_TAG']

progress = f'''\n\n## Run 148 — FAZ 8 deterministic world-event regression snapshot ({stamp})
- Alt görev: dünya olayı sisteminin sabit seed + sabit day/night örüntüsünde ürettiği 24 olaylık sıra SHA-256 checksum fixture ile kalıcı regresyon guard'ına alındı; runtime kodu değiştirilmedi.
- DoD: temiz origin/main baseline + post-change browser smoke 34/34+ PASS; determinism snapshot/catalog/diversity/PWA/cache/mobile/terrain/road/additive-only kontrolleri PASS; 3D boot console/page error yok.
- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Event toplamı 52, değişmedi.
- Performans: {perf_row}. Teknik borç: 1 (game3d.js 545/600 owner kararı bekliyor, değişmedi). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: doğrudan hayır; deterministik olay sırası artık gelecekteki istemsiz PRNG/gating regresyonlarına karşı korunuyor.
- Sıradaki güvenli adım: owner bloklarına dokunmadan FAZ 8 test/kalite veya bağımsız düşük-risk gameplay iyileştirmesi; yayın öncesi concurrency gate zorunlu.
'''

adr = '''\n\n## ADR-0171 — FAZ 8 dünya olayı sabit-seed checksum regresyonu (run 148)

**Risk Seviyesi:** LOW

**Karar:** `createWorldEventSystem` için sabit seed, sabit 95 saniyelik update adımları ve gündüz/gece/alacakaranlık/ungated örüntüsüyle 24 emission'lık deterministik çıktı `scripts/fixtures/world-events-seed-148.json` içinde sequence + SHA-256 checksum olarak saklanır. `scripts/checkWorldEventDeterminism.js` aynı seed'in aynı sırayı üretmesini, farklı seed'in ayrışmasını, time-of-day eligibility kurallarını ve dispose sonrası emission olmamasını doğrular. Ayrı `world-event-determinism.yml` workflow'u fixture mevcut olduğu sürece gelecekteki main/agent değişikliklerinde bu snapshot'ı sürekli kontrol eder.

**Neden:** GOVERNANCE deterministik prosedürel/gameplay üretiminde sabit-seed snapshot ister. FAZ 8 katalog büyürken yalnız katalog şekli ve metin çeşitliliğini kontrol etmek PRNG sırası veya day/night filtering davranışının istemeden değişmesini yakalamıyordu.

**Alternatifler:** Runtime davranışını değiştirmek reddedildi; Run 148 yalnız test/CI kapsamını genişletir. Sadece aynı seed'i iki kez karşılaştırıp checksum fixture saklamamak reddedildi, çünkü bu yaklaşım aynı commit içindeki deterministik fakat istemsiz davranış değişikliğini regresyon sayamazdı.

**Sonuç:** Oyun davranışı bit-eşit kalır; sabit-seed world-event davranışı artık checksum ile izlenir. Kasıtlı bir gelecekteki davranış değişikliği fixture güncellemesi ve yeni ADR gerektirir.

**Etkilenen sistemler:** test/CI (`scripts/checkWorldEventDeterminism.js`, fixture, GitHub Actions). Runtime `worldEvents.js`, EventBus, UI, PWA cache listesi ve save formatı değişmez.

**Geri alma planı:** Yeni guard ve fixture additive dosyalardır; yanlış pozitif üretiyorsa sonraki additive policy katmanıyla koşullu devre dışı bırakılabilir. Mevcut kaynak satırı silme/değiştirme gerekmez.
'''

Path('3D_GAME_PROGRESS.md').open('a', encoding='utf-8').write(progress)
Path('DECISIONS.md').open('a', encoding='utf-8').write(adr)
Path('STABLE_TAGS.md').open('a', encoding='utf-8').write(
    f'- {tag} — run 148 fixed-seed world-event checksum guard; 34/34+ browser smoke, determinism/catalog/diversity/PWA/cache/mobile/road/terrain/additive gates PASS.\n'
)
