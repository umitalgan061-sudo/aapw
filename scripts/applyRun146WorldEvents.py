#!/usr/bin/env python3
"""Apply Run 146 as additive-only edits, with optional final checkpoint records."""
from pathlib import Path
import os

WORLD = Path('src/3d/gameplay/worldEvents.js')
world = WORLD.read_text(encoding='utf-8')
anchor = "\t{ id: 'stargazing_maester', icon: '🔭', title: 'Yıldız Gözlemi', desc: 'Gece yarısına yakın, kale kulesinde bir maester bakır bir aletle gökyüzünü inceliyor; kayıtlarına usulca bir şeyler not düşüyor.', color: '#3a5a7a', weight: WEIGHT.RARE, timeOfDay: 'night' },\n"
addition = """\t/** Run 146 addition: a sealed-scroll courier arriving without a fixed hour, distinct from\n\t * `raven`/`maester_raven` (bird-delivered messages) and `horse_gallop` (unidentified distant rider). */\n\t{ id: 'sealed_courier', icon: '✉️', title: 'Mühürlü Haberci', desc: 'Toz içindeki bir haberci kale kapısında atından inip balmumuyla mühürlenmiş bir tomar uzatıyor; üzerindeki arma uzaktan seçilemiyor.', color: '#8a5d45', weight: WEIGHT.UNCOMMON },\n\t/** Run 146 addition: daylight weapons drill in the yard, distinct from `guard_change` (handover)\n\t * and `blacksmith_hammer` (crafting); explicitly day-gated by the text. */\n\t{ id: 'training_yard_drill', icon: '🛡️', title: 'Avlu Talimi', desc: 'Gün ışığında kale avlusunda askerler kalkan ve tahta kılıçlarla sıra talimi yapıyor; komut sesleri taş duvarlarda yankılanıyor.', color: '#7f6f58', weight: WEIGHT.COMMON, timeOfDay: 'day' },\n\t/** Run 146 addition: a quiet moonlit graveyard vigil, distinct from `mourning_bells` (audible loss\n\t * announcement) and `sept_prayer` (generic worship); true-night only. */\n\t{ id: 'graveyard_vigil', icon: '🕯️', title: 'Mezarlık Nöbeti', desc: 'Gece karanlığında kale dışındaki mezarlıkta tek bir mum yanıyor; pelerinli bir siluet eski bir mezarın başında sessizce bekliyor.', color: '#57506f', weight: WEIGHT.RARE, timeOfDay: 'night' },\n"""
if "id: 'sealed_courier'" not in world:
    if anchor not in world:
        raise SystemExit('run146 anchor missing in worldEvents.js')
    world = world.replace(anchor, anchor + addition, 1)

count_anchor = "// Run 145 live count: 15 of 49 entries are time-gated.\n"
count_line = "// Run 146 live count: 17 of 52 entries are time-gated.\n"
if count_line not in world:
    if count_anchor not in world:
        raise SystemExit('run146 live-count anchor missing')
    world = world.replace(count_anchor, count_anchor + count_line, 1)
WORLD.write_text(world, encoding='utf-8')

if os.environ.get('RUN146_FINALIZE') == '1':
    stamp = os.environ.get('RUN146_STAMP', '2026-08-07 UTC')
    perf_row = os.environ.get('RUN146_PERF_ROW', 'perf snapshot kaydedildi')

    progress = Path('3D_GAME_PROGRESS.md')
    p = progress.read_text(encoding='utf-8')
    if '## Run 146 — FAZ 8 world-event expansion' not in p:
        p += f"""\n\n## Run 146 — FAZ 8 world-event expansion ({stamp})\n- Session Snapshot: origin/main run 145 (`c113daa`) üzerinden senkronize edildi; GOVERNANCE.md, 3D_GAME_PROGRESS.md, son ADR'ler ve QUESTIONS_FOR_OWNER.md okundu. Radius-5 ve game3d.js 545/600 owner kararları korunarak bu alanlara dokunulmadı.\n- Alt görev: FAZ 8 WORLD_EVENTS kataloğuna üç özgün veri-only olay eklendi: mühürlü haberci, gündüz avlu talimi ve gece mezarlık nöbeti. Katalog 49→52; time-gated olaylar 15→17.\n- DoD: temiz origin/main baseline + post-change browser smoke 34/34+ PASS; world-event catalog/Run143-146 guards/PWA/cache/assets/dialogue/mobile/terrain/road/checkpoint/additive-only PASS; 3D boot zero console/page error.\n- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Radius-5 ADR-0166 owner kararına bağlı kaldı ve tekrar denenmedi.\n- Performans: {perf_row}. Memory leak checklist: veri-kataloğu dışında yeni runtime state/listener/timer/DOM/geometry/material yok.\n- Teknik borç: 1 (`game3d.js` 545/600, değişmedi ve bu run dokunmadı). Risk LOW. Güven 5/5.\n- World Evolution Report delta: +3 dünya olayı (toplam 52); yol/orman/kale/NPC/hayvan 0. Oyuncu fark eder mi: evet, gündüz/gece ve nötr atmosfer olay havuzu daha çeşitli. Sıradaki güvenli adım: owner/asset blokları sürerken FAZ 8 düşük-risk içerik veya bağımsız gameplay iyileştirmesi.\n"""
        progress.write_text(p, encoding='utf-8')

    decisions = Path('DECISIONS.md')
    d = decisions.read_text(encoding='utf-8')
    if '## ADR-0170 — FAZ 8 dördüncü üçlü dünya-olayı paketi' not in d:
        d += """\n\n## ADR-0170 — FAZ 8 dördüncü üçlü dünya-olayı paketi (run 146)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Owner kararı bekleyen mobil radius-5 ve `game3d.js` 545/600 yapısal borç alanlarına dokunmadan FAZ 8 dünya-olayı havuzu üç veri-only olayla genişletilir. `sealed_courier` günün her saatinde, `training_yard_drill` yalnız gerçek gündüzde, `graveyard_vigil` yalnız gerçek gecede seçilebilir. Mevcut olaylar, ağırlıklar, eşikler, deterministic seçim algoritması ve EventBus/UI sözleşmesi değiştirilmez.\n\n**Neden:** Yüksek öncelikli açık maddeler hâlen manuel asset veya owner kararı bekliyor. Bu paket yeni asset istemeden, mevcut güvenli world-event mekanizmasını kullanarak oyuncunun dünyada karşılaştığı gündelik/siyasi/tekinsiz atmosfer çeşitliliğini artırır ve mevcut olaylardan semantik olarak ayrıdır.\n\n**Alternatifler:** Radius-5 tekrar denenmedi (ADR-0166 owner kararı bekliyor); `game3d.js` bölünmedi (run 145 owner sorusu ve additive-only çatışması); kale/hayvan asset işi yeni lisanslı model girdisi olmadan başlatılmadı.\n\n**Etkilenen sistemler:** `src/3d/gameplay/worldEvents.js` veri kataloğu, Run 146 regresyon guard'ı ve CI doğrulama akışı. Terrain, save formatı, PWA runtime listesi, PRNG tüketim sayısı, mevcut event ağırlıkları ve 2D oyun değişmez.\n\n**Geri alma:** Yeni girdiler additive veri satırlarıdır; gelecekte eligibility/filter katmanı ile devre dışı bırakılabilir. Mevcut satır silme/değiştirme gerektirmez.\n"""
        decisions.write_text(d, encoding='utf-8')
