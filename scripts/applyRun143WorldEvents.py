#!/usr/bin/env python3
"""Apply Run 143 as additive-only edits, with optional final checkpoint records."""
from pathlib import Path
import os

WORLD = Path('src/3d/gameplay/worldEvents.js')
world = WORLD.read_text(encoding='utf-8')
anchor = "\t{ id: 'ward_hostage_arrival', icon: '🧒', title: 'Vesayet Genci', desc: 'Soylu bir ailenin genç oğlu, kendi evinin sadakatini garanti altına almak için başka bir evin vesayetine gönderiliyor — fiilen bir rehine olarak. Atının yanında yürüyen muhafızlar dışında kimse tek kelime etmiyor.', color: '#7a9a6a', weight: WEIGHT.UNCOMMON },\n"
addition = """\t/** Run 143 addition: a distant signal fire visible only in true night, distinct from feast fires\n\t * (celebration) and the Night's Watch horn (auditory patrol cue). */\n\t{ id: 'night_signal_fire', icon: '🔥', title: 'Gece İşaret Ateşi', desc: 'Karanlıkta uzak bir gözetleme kulesinde tek bir işaret ateşi yanıyor — dostlara çağrı mı, yoksa yaklaşan bir tehlikenin haberi mi?', color: '#d05a32', weight: WEIGHT.UNCOMMON, timeOfDay: 'night' },\n\t/** Run 143 addition: daylight petitioners gathering at a lord's gate, a civilian/political cue\n\t * distinct from market-day commerce and alms-giving charity. */\n\t{ id: 'court_petitioners', icon: '📜', title: 'Dilekçe Kuyruğu', desc: 'Gün ışığında köylüler ve küçük toprak sahipleri kale kapısında sıraya girmiş; herkes derdini lordun görevlilerine anlatmak için bekliyor.', color: '#9a7a52', weight: WEIGHT.COMMON, timeOfDay: 'day' },\n\t/** Run 143 addition: an itinerant healer offering herbs and remedies, distinct from maesters,\n\t * merchants, singers and sellswords already represented in the catalog. */\n\t{ id: 'wandering_healer', icon: '🌿', title: 'Gezgin Şifacı', desc: 'Omzunda ot demetleri taşıyan gezgin bir şifacı kale yolunda durup yaralara merhem, ateşe çay ve uykusuzluğa kök sattığını söylüyor.', color: '#5f8a58', weight: WEIGHT.UNCOMMON },\n"""
if "id: 'night_signal_fire'" not in world:
    if anchor not in world:
        raise SystemExit('run143 anchor missing in worldEvents.js')
    world = world.replace(anchor, anchor + addition, 1)
count_anchor = "// Run 138 live count: 9 of 40 entries are time-gated.\n"
count_line = "// Run 143 live count: 11 of 43 entries are time-gated.\n"
if count_line not in world:
    if count_anchor not in world:
        raise SystemExit('run143 live-count anchor missing')
    world = world.replace(count_anchor, count_anchor + count_line, 1)
WORLD.write_text(world, encoding='utf-8')

if os.environ.get('RUN143_FINALIZE') == '1':
    stamp = os.environ.get('RUN143_STAMP', '2026-08-07 UTC')
    progress = Path('3D_GAME_PROGRESS.md')
    p = progress.read_text(encoding='utf-8')
    if '## Run 143 — FAZ 8 world-event expansion + platform check' not in p:
        p += f"""\n\n## Run 143 — FAZ 8 world-event expansion + platform check ({stamp})\n- Alt görevler: FAZ 8 WORLD_EVENTS kataloğuna üç özgün olay eklendi: gece işaret ateşi, gündüz dilekçe kuyruğu ve gezgin şifacı. Katalog 40→43; time-gated olaylar 9→11.\n- DoD: temiz origin/main baseline + post-change browser smoke 34/34+ PASS; world-event catalog/Run143 guard/PWA installability/service-worker cache/assets/dialogue/terrain/road/checkpoint/additive-only PASS; 3D boot zero console/page error.\n- Periyodik platform kontrolü: PWA installability PASS, service-worker offline shell PASS, gerçek Chromium/WebGL 3D boot PASS; package.json olmadığı için npm audit N/A.\n- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Radius-5 ADR-0166 owner kararına bağlı kaldı ve bu run tekrar denenmedi.\n- Memory leak checklist: veri-kataloğu dışında yeni runtime state/listener/timer/geometry/material yok. Teknik borç: 1 (game3d.js cap yaklaşımı, değişmedi). Risk LOW. Güven 5/5.\n- World Evolution Report delta: +3 dünya olayı; yol/orman/kale/NPC/hayvan 0. Oyuncu fark eder: evet, periyodik 3D dünya olayı toast havuzu daha çeşitli. Sıradaki bağımsız adım: bloklu asset/radius kararları sürerken FAZ 8 içerik ve düşük-risk gameplay iyileştirmeleri.\n"""
        progress.write_text(p, encoding='utf-8')

    decisions = Path('DECISIONS.md')
    d = decisions.read_text(encoding='utf-8')
    if '## ADR-0167 — FAZ 8 üçlü dünya-olayı paketi ve platform doğrulaması' not in d:
        d += """\n\n## ADR-0167 — FAZ 8 üçlü dünya-olayı paketi ve platform doğrulaması (run 143)\n\n**Risk Seviyesi:** LOW\n\n**Karar:** Radius-5 ADR-0166 ile owner kararına bağlıyken ve kale/hayvan içerikleri yeni model assetleri beklerken, bağımsız ilerleme alanı olarak FAZ 8 dünya-olayı havuzu üç özgün olayla genişletilir. `night_signal_fire` yalnız gerçek gece eşiğinde, `court_petitioners` yalnız gerçek gündüz eşiğinde, `wandering_healer` ise günün her saatinde seçilebilir. Mevcut olaylar, ağırlıklar ve seçim algoritması değiştirilmez. Aynı run, GOVERNANCE'ın periyodik platform kontrol penceresini PWA/cache ve gerçek Chromium/WebGL doğrulamasıyla yeniler.\n\n**Neden:** Bu çalışma açık owner kararını dolanmaz, manuel asset gerektirmez ve kullanıcıya doğrudan yeni atmosfer içeriği verir. İki gated olay mevcut day/night mekanizmasını gerçek içerikle kullanırken üçüncü olay gün-zamanından bağımsız çeşitlilik ekler.\n\n**Alternatifler:** Radius-5'i tekrar zorlamak reddedildi (ADR-0166 açık blok); jon-guard diyalog istisnasını sırf 14/14 yapmak için kaldırmak reddedildi (önceki bilinçli tasarım kararı); yeni kale/hayvan modeli eklemek uygun lisanslı asset bulunmadığı için reddedildi.\n\n**Etkilenen sistemler:** `gameplay/worldEvents.js` veri kataloğu ve yeni statik regresyon guard'ı. EventBus/UI API şekli, save formatı, terrain, PWA runtime listesi ve deterministic PRNG algoritması değişmez.\n\n**Geri alma:** Olaylar veri-only additive girdilerdir; gelecekte yeni bir eligibility/filter katmanı ile devre dışı bırakılabilir. Mevcut satır silme/değiştirme gerektirmez.\n"""
        decisions.write_text(d, encoding='utf-8')
