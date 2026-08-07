#!/usr/bin/env python3
"""Append Run 152 governance records after all validation gates have passed."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAMP = os.environ["RUN152_STAMP"]
TAG = os.environ["RUN152_TAG"]
SMOKE = os.environ.get("RUN152_SMOKE", "34")


def append(path: str, text: str) -> None:
    with (ROOT / path).open("a", encoding="utf-8") as handle:
        handle.write(text)


append(
    "3D_GAME_PROGRESS.md",
    f"""

## Run 152 — Latest-run checkpoint uniqueness guard ({STAMP})
- Alt görev: çok-agent eşzamanlılığında aynı son run kimliğinin progress/stable/perf defterlerine birden fazla kez yazılmasını yakalayan `scripts/checkLatestRunUniqueness.js` eklendi. Guard runtime/PWA/gameplay koduna dokunmaz.
- DoD: temiz run151 baseline + post-change browser/WebGL smoke {SMOKE}/34+ PASS; syntax, checkpoint consistency, world-event, PWA/cache, mobile/world safety ve additive-only kapıları PASS; console/page error yok.
- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Performans ölçümü `perf_log.csv` run152 satırında kayıtlı; runtime değişmedi.
- Memory leak checklist: N/A — yeni runtime listener/timer/DOM/geometry/material yok. Teknik borç: 1 (`game3d.js` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: hayır; ajanların aynı run kimliğini çift kaydetmesi artık yayın öncesinde otomatik yakalanır.
- Sıradaki güvenli adım: owner bloklarına dokunmadan bağımsız UI/erişilebilirlik/test-kalite işi; ~run156 kural konsolidasyonu yaklaşırken concurrency gate zorunlu.
""",
)

append(
    "DECISIONS.md",
    """

## ADR-0174 — Son run checkpoint kayıtlarında benzersizlik kapısı (run 152)

**Risk Seviyesi:** LOW

**Karar:** `checkCheckpointConsistency.js` korunur ve yanına bağımsız `checkLatestRunUniqueness.js` eklenir. Yeni guard en yüksek run numarasının `3D_GAME_PROGRESS.md`, `STABLE_TAGS.md` ve `perf_log.csv` içinde ayrı ayrı tam bir kez bulunmasını zorunlu kılar.

**Neden:** Eşzamanlı ajanlar aynı run numarasını bağımsız şekilde yazarsa üç defter aynı maksimum run üzerinde anlaşabilir; bu durumda mevcut consistency kontrolü tek başına duplicate kaydı ayırt edemez. Benzersizlik kontrolü bu boşluğu runtime davranışına dokunmadan kapatır.

**Alternatifler:** Mevcut consistency scriptini değiştirmek additive-only kuralını ihlal edeceği için reddedildi. Run numarasını yalnız commit mesajından çıkarmak authoritative-ledger kontrolü sağlamadığı için reddedildi.

**Sonuç:** Çift son-run kayıtları CI'da erken FAIL olur; eski tarihsel kayıtların biçimi veya runtime kodu değişmez.

**Etkilenen sistemler:** yalnız repository test/CI kalite katmanı ve üç checkpoint ledger'ı; gameplay, renderer, PWA cache, mobil dünya ve deterministik üreticiler etkilenmez.

**Geri alma planı:** Yeni script/workflow ileride daha yeni bir guard tarafından additive biçimde gölgelenebilir; mevcut consistency guard ve runtime bit-eşit kalır.
""",
)

append(
    "STABLE_TAGS.md",
    f"- {TAG} — run 152 latest-run checkpoint uniqueness guard; {SMOKE}/34+ browser smoke and governance/mobile/PWA gates PASS.\n",
)
