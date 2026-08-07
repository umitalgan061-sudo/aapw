#!/usr/bin/env python3
"""Append run 150 governance records after all validation gates pass."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAMP = os.environ.get("RUN150_STAMP", "2026-08-07 UTC")
TAG = os.environ.get("RUN150_TAG", "stable-run150")

perf_lines = (ROOT / "perf_log.csv").read_text(encoding="utf-8").strip().splitlines()
perf_line = next((line for line in reversed(perf_lines) if ",run150," in line), "run150 perf snapshot missing")

progress = f"""

## Run 150 — World-event toast erişilebilir canlı bildirim ({STAMP})
- Session Snapshot / concurrency: run 149 (`2756816e`) tabanından başlandı; `GOVERNANCE.md`, son progress/ADR/QFO bağlamı okundu. Run 149'un `WORLD_EVENTS` katalog büyümesini checksum/additive-only owner kararına bağlayan ADR-0172 kararı korundu; katalog 52'de bırakıldı.
- Alt görev: `ui/worldEventToast.js` mevcut davranışına yalnız-additive bir erişilebilirlik katmanı eklendi. Toast gerçek bir olay gösterdiğinde `role=status`, `aria-live=polite`, `aria-atomic=true` alıyor; dekoratif emoji `aria-hidden=true`. Görsel stil, 6 saniyelik timer, EventBus bağlantısı ve mobil/desktop/PWA davranışı değişmedi.
- DoD: temiz origin/main baseline smoke + değişiklik sonrası smoke PASS; `node --check`, özellik-spesifik gerçek Chromium erişilebilirlik testi, PWA/cache, mobile streaming/radius4/terrain/vegetation/perf, terrain-seat, road-network ve additive-only kapıları PASS. Console/page error tam smoke kapsamında sıfır.
- Görsel doğrulama: ARIA attribute'ları CSS/render çıktısını değiştirmeyen semantik metadata olduğu için ekran görüntüsünde görünür delta beklenmez; 390px mobil ve masaüstü gerçek-browser DOM testi toast'ın görünür/metin içeriğini korurken erişilebilirlik ağacını doğruladı.
- Performans: {perf_line}. World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi.
- Memory leak checklist: yeni listener/timer/DOM/geometry/material eklenmedi; mevcut dispose/unsubscribe/timer cleanup aynen korunuyor. Teknik borç: 1 (`game3d.js` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: görsel olarak hayır; ekran okuyucu kullanan oyuncu dünya olayı başlık+açıklamasını artık nazik canlı bildirim olarak duyar.
- Sıradaki güvenli adım: owner bloklarına (radius-5, game3d.js bölünmesi, world-event checksum fixture) dokunmadan başka bağımsız düşük-risk erişilebilirlik/kalite veya gameplay iyileştirmesi; yayın öncesi concurrency gate zorunlu.
"""

adr = """

## ADR-0173 — Dünya olayı toast'ı için erişilebilir canlı durum semantiği (run 150)

**Risk Seviyesi:** LOW

**Karar:** `WorldEventToast` gerçek bir olay gösterdiğinde görsel davranışı değiştirmeden WAI-ARIA canlı durum semantiği kazanır: `role="status"`, `aria-live="polite"`, `aria-atomic="true"`; yalnız dekoratif olan emoji `aria-hidden="true"` olur. Değişiklik additive-only gereği mevcut `_show()` kodunu silmeden/değiştirmeden, önceki davranışı çağıran kalıcı bir prototype extension ile uygulanır.

**Neden:** Dünya olayları bugün yalnız görsel toast olarak sunuluyor. Ekran okuyucu kullanan oyuncular aynı Türkçe atmosfer bilgisini alamıyor. `status/polite` kritik olmayan, periyodik bildirimler için uygun; `atomic=true` başlık ile açıklamanın tek güncelleme olarak okunmasını sağlar. Emoji içerik taşımadığı için erişilebilirlik ağacından gizlenir.

**Alternatifler:** (1) Constructor/_show satırlarını doğrudan değiştirmek daha sade olurdu fakat kaynak satırı değiştirmeyi yasaklayan additive-only guard'ı ihlal eder. (2) Ayrı yeni UI widget'ı eklemek çift DOM/EventBus aboneliği ve `game3d.js` wiring'i gerektirerek gereksiz blast radius yaratır. (3) Hiçbir şey yapmamak erişilebilirlik açığını korurdu.

**Sonuç:** Görsel piksel çıktısı, timer süresi, event seçimi, determinism, PWA cache içeriği, pointer/klavye girişi ve render bütçesi değişmez. Ekran okuyucu tarafında toast artık nazik ve atomik bir canlı bildirimdir.

**Etkilenen sistemler:** `src/3d/ui/worldEventToast.js`; test-only `scripts/checkWorldEventToastAccessibility.js`; run150 CI/records. `game3d.js`, `gameplay/worldEvents.js`, EventBus API, save formatı ve WORLD_EVENTS katalog/fixture'ı değişmez.

**Geri alma planı:** Additive extension sonraki bir additive policy katmanı ile devre dışı bırakılabilir. Owner gelecekte additive-only guard için kaynak-refactor istisnası verirse semantik attribute'lar constructor içine taşınabilir; o zamana kadar mevcut satırlar korunur.
"""

stable = f"\n- {TAG} — run 150 world-event toast accessibility; full browser smoke + a11y/PWA/mobile/additive gates PASS.\n"
ui_readme = """

- **Run 150 accessibility note:** `worldEventToast.js` keeps its existing visual/timer/EventBus behavior but now exposes each shown event as a polite atomic `status` live region; the decorative emoji is hidden from assistive technology so screen readers announce the Turkish title + description rather than redundant icon speech.
"""

for relative, text in [
    ("3D_GAME_PROGRESS.md", progress),
    ("DECISIONS.md", adr),
    ("STABLE_TAGS.md", stable),
    ("src/3d/ui/README.md", ui_readme),
]:
    path = ROOT / relative
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(text)

print(f"[applyRun150Records] appended run150 records with {TAG}; perf={perf_line}")
