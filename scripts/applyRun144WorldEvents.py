#!/usr/bin/env python3
"""Apply Run 144 as additive-only edits, with optional final checkpoint records."""
from pathlib import Path
import os

WORLD = Path('src/3d/gameplay/worldEvents.js')
world = WORLD.read_text(encoding='utf-8')
anchor = "\t{ id: 'wandering_healer', icon: '🌿', title: 'Gezgin Şifacı', desc: 'Omzunda ot demetleri taşıyan gezgin bir şifacı kale yolunda durup yaralara merhem, ateşe çay ve uykusuzluğa kök sattığını söylüyor.', color: '#5f8a58', weight: WEIGHT.UNCOMMON },\n"
addition = """\t/** Run 144 addition: a routine torch patrol visible only at true night, distinct from\n\t * `guard_change` (shift handover) and `night_signal_fire` (a distant warning beacon). */\n\t{ id: 'torch_patrol', icon: '🔥', title: 'Meşaleli Devriye', desc: 'Karanlık bastığında kale dış yolunda meşaleli bir devriye ağır adımlarla ilerliyor; zırhların metal sesi gecede kısa kısa yankılanıyor.', color: '#b86a3c', weight: WEIGHT.COMMON, timeOfDay: 'night' },\n\t/** Run 144 addition: a daylight public proclamation, distinct from tournament announcements and\n\t * petitioners waiting to speak; this is the lordship broadcasting a formal order to the crowd. */\n\t{ id: 'herald_proclamation', icon: '📣', title: 'Meydan Fermanı', desc: 'Gün ışığında bir haberci kale meydanında tomarını açıp lordun yeni fermanını yüksek sesle okuyor; kalabalık her cümleden sonra birbirine bakıyor.', color: '#b8924a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' },\n\t/** Run 144 addition: a silent aftermath clue rather than an active battle event; no time gate\n\t * because the discovered banner can plausibly remain beside the road at any hour. */\n\t{ id: 'broken_banner_found', icon: '🚩', title: 'Yırtık Sancak', desc: 'Kale yolunun kenarında çamura bulanmış, arması seçilemeyen yırtık bir sancak bulundu — yakınlarda bir çatışma yaşanmış olabilir.', color: '#6f4a45', weight: WEIGHT.RARE },\n"""
if "id: 'torch_patrol'" not in world:
    if anchor not in world:
        raise SystemExit('run144 anchor missing in worldEvents.js')
    world = world.replace(anchor, anchor + addition, 1)

count_anchor = "// Run 143 live count: 11 of 43 entries are time-gated.\n"
count_line = "// Run 144 live count: 13 of 46 entries are time-gated.\n"
if count_line not in world:
    if count_anchor not in world:
        raise SystemExit('run144 live-count anchor missing')
    world = world.replace(count_anchor, count_anchor + count_line, 1)
WORLD.write_text(world, encoding='utf-8')

if os.environ.get('RUN144_FINALIZE') == '1':
    stamp = os.environ.get('RUN144_STAMP', '2026-08-07 UTC')
    perf_row = os.environ.get('RUN144_PERF_ROW', 'perf snapshot kaydedildi')

    progress = Path('3D_GAME_PROGRESS.md')
    p = progress.read_text(encoding='utf-8')
    if '## Run 144 — FAZ 8 world-event expansion' not in p:
        p += f"""\n\n## Run 144 — FAZ 8 world-event expansion ({stamp})\n- Alt görevler: FAZ 8 WORLD_EVENTS kataloğuna üç özgün olay eklendi: meşaleli gece devriyesi, gündüz meydan fermanı ve yırtık sancak bulgusu. Katalog 43→46; time-gated olaylar 11→13.\n- DoD: temiz origin/main baseline + post-change browser smoke 34/34+ PASS; world-event catalog/Run143/Run144 guard/PWA/cache/assets/dialogue/mobile/terrain/road/checkpoint/additive-only PASS; 3D boot zero console/page error.\n- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Radius-5 ADR-0166 owner kararına bağlı kaldı ve bu run tekrar denenmedi.\n- Performans: {perf_row}. Memory leak checklist: veri-kataloğu dışında yeni runtime state/listener/timer/geometry/material yok.\n- Teknik borç: 1 (game3d.js cap yaklaşımı, değişmedi). Risk LOW. Güven 5/5.\n- World Evolution Report delta: +3 dünya olayı; yol/orman/kale/NPC/hayvan 0. Oyuncu fark eder: evet, gündüz/gece atmosfer olay havuzu daha çeşitli. Sıradaki bağımsız adım: bloklu asset/radius kararları sürerken FAZ 8 düşük-risk içerik/gameplay ilerlemesi.\n"""
        progress.write_text(p, encoding='utf-8')

    decisions = Path('DECISIONS.md')
    d = decisions.read_text(encoding='utf-8')
    if '## ADR-0168 — FAZ 8 ikinci üçlü dünya-olayı paketi' not in d:
        d += """\n\n## ADR-0168 — FAZ 8 ikinci üçlü dünya-olayı paketi (run 144)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** ADR-0166 ile radius-5 owner kararına bağlı kalmaya devam ederken FAZ 8 dünya-olayı havuzu üç veri-only olayla genişletilir. `torch_patrol` yalnız gerçek gecede, `herald_proclamation` yalnız gerçek gündüzde, `broken_banner_found` ise günün her saatinde seçilebilir. Mevcut olaylar, ağırlıklar, eşikler, seçim algoritması ve EventBus/UI sözleşmesi değiştirilmez.\n\n**Neden:** Bu paket yeni asset veya ürün kararı gerektirmeden oyuncunun dünyada gördüğü atmosfer çeşitliliğini artırır. İki olay mevcut day/night eligibility mekanizmasını kullanır; üçüncü olay zaman bağımsız nadir bir çevresel hikâye izi ekler. Üçü de mevcut katalogdaki nöbet değişimi, işaret ateşi, turnuva duyurusu, dilekçe kuyruğu ve savaşçı gelişlerinden içerik olarak ayrıdır.\n\n**Alternatifler:** Radius-5 yeniden denenmedi çünkü ADR-0166 açık owner kararına bağlı; jon-guard 14/14 yapılmadı çünkü mevcut ton kararı korunuyor; kale/hayvan asset işi lisanslı model girdisi beklediği için bu run kapsamına alınmadı.\n\n**Etkilenen sistemler:** `src/3d/gameplay/worldEvents.js` veri kataloğu, Run 144 regresyon guard'ı ve CI doğrulama akışı. Terrain, save formatı, PWA runtime listesi, PRNG tüketim sayısı ve mevcut event ağırlıkları değişmez.\n\n**Geri alma:** Yeni girdiler additive veri satırlarıdır; gelecekte eligibility/filter katmanı ile devre dışı bırakılabilir. Mevcut satır silme/değiştirme gerektirmez.\n"""
        decisions.write_text(d, encoding='utf-8')
