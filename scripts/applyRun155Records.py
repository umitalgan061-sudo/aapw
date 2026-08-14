#!/usr/bin/env python3
"""Append Run 155 governance records after all validation gates have passed."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAMP = os.environ["RUN155_STAMP"]
TAG = os.environ["RUN155_TAG"]
SMOKE = os.environ.get("RUN155_SMOKE", "34")


def append(path: str, text: str) -> None:
    with (ROOT / path).open("a", encoding="utf-8") as handle:
        handle.write(text)


append(
    "3D_GAME_PROGRESS.md",
    f"""

## Run 155 — Player health meter accessibility semantics ({STAMP})
- Session Snapshot / concurrency: temiz run154 (`e99de43b`) tabanından başlandı; `GOVERNANCE.md`, progress/ADR/QFO ve son commitler doğrulandı. Başlangıçta `run155` adlı rakip aktif branch yoktu; owner bloklarına dokunulmadı.
- Alt görev: `ui/healthBar.js` additive-only olarak gerçek bir erişilebilir `meter` semantiği kazandı (`role=meter`, Türkçe `aria-label=Can`, min/max/current/value-text). Görsel can barı, hasar flash'ı, EventBus akışı ve gameplay değerleri değişmedi.
- DoD: temiz run154 baseline + post-change browser/WebGL smoke {SMOKE}/34+ PASS; `node --check`, gerçek Chromium mobil+desktop health-bar erişilebilirlik regresyonu, checkpoint/world-event/PWA/cache/assets/dialogue/mobile/world safety ve additive-only kapıları PASS; console/page error yok.
- Görsel doğrulama: yalnız ARIA metadata eklendi, piksel/layout çıktısı değişmedi; tam browser smoke görünür davranışı, hedef regresyon testi ise erişilebilirlik ağacındaki meter değerlerini doğrular.
- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Performans `perf_log.csv` run155 satırında kayıtlı; renderer yolu değişmedi.
- Memory leak checklist: yeni listener/timer/DOM/geometry/material yok; mevcut iki EventBus subscription ve flash timeout dispose sırasında temizlenmeye devam ediyor. Teknik borç: 1 (`game3d.js` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: görsel olarak hayır; ekran okuyucu kullanan oyuncu artık can göstergesini semantik bir ölçer ve güncel sayısal değer olarak okuyabilir.
- Sıradaki güvenli adım: run156 civarı kural konsolidasyonunu önceliklendir; owner bloklarına dokunma ve final concurrency gate'i koru.
""",
)

append(
    "DECISIONS.md",
    """

## ADR-0177 — Oyuncu can çubuğunu erişilebilir meter olarak tanımlama (run 155)

**Risk Seviyesi:** LOW

**Karar:** `HealthBar` mevcut görsel ve EventBus davranışını değiştirmeden additive-only ARIA meter semantiği kazanır: kökte `role=meter`, `aria-label=Can`, `aria-valuemin=0`; her health paint sırasında `aria-valuemax`, sınırlandırılmış `aria-valuenow` ve görünür metinle eşleşen `aria-valuetext` güncellenir.

**Neden:** Görsel can çubuğu oyuncunun FAZ 7 ejderha hasarı sonrası kritik durumunu gösteriyor ancak yardımcı teknoloji için bugüne kadar yalnız anlamsız bir `div` ağacıydı. Meter semantiği mevcut görsel metni çoğaltmadan sayısal sağlık durumunu erişilebilir kılar.

**Alternatifler:** (1) `role=status` + live region kullanmak her hasarda gereksiz/sık anons üretebileceği için reddedildi. (2) Ayrı gizli erişilebilir DOM eklemek çift veri kaynağı ve cleanup yükü yaratacağı için reddedildi. (3) Mevcut satırları refactor etmek additive-only guard nedeniyle reddedildi.

**Sonuç:** CSS sınıfları, fill width hesabı, düşük-can eşiği, hasar flash timer'ı, EventBus abonelikleri ve gameplay health hesapları değişmez; yardımcı teknoloji güncel can değerini semantik ölçer olarak okuyabilir.

**Etkilenen sistemler:** `src/3d/ui/healthBar.js`, hedef regresyon scripti ve run155 CI/kayıtları. `gameplay/health.js`, dragon combat, `game3d.js`, save formatı, PWA/cache ve renderer etkilenmez.

**Geri alma planı:** Eklenen ARIA attribute'ları ileride owner onaylı bir erişilebilirlik policy/refactor katmanı tarafından gölgelenebilir; mevcut runtime satırlarını silmek/değiştirmek gerekmez.
""",
)

append(
    "STABLE_TAGS.md",
    f"- {TAG} — run 155 player health meter accessibility; {SMOKE}/34+ browser smoke and a11y/governance/mobile/PWA gates PASS.\n",
)
