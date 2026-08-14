#!/usr/bin/env python3
"""Append Run 153 governance records after all validation gates have passed."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAMP = os.environ["RUN153_STAMP"]
TAG = os.environ["RUN153_TAG"]
SMOKE = os.environ.get("RUN153_SMOKE", "34")


def append(path: str, text: str) -> None:
    with (ROOT / path).open("a", encoding="utf-8") as handle:
        handle.write(text)


append(
    "3D_GAME_PROGRESS.md",
    f"""

## Run 153 — Settlement discovery atomic live announcement ({STAMP})
- Session Snapshot / concurrency: run152 (`84604991`) tabanından başlandı; `GOVERNANCE.md`, progress/ADR/QFO ve son commitler doğrulandı. Owner bloklarına dokunulmadı; Run153 adına aktif rakip dal başlangıçta yoktu.
- Alt görev: `ui/settlementDiscovery.js` mevcut `role=status` + `aria-live=polite` semantiğine additive-only `aria-atomic=true` katmanı kazandırdı. Keşif başlığı, yerleşim adı ve ilerleme sayacı ekran okuyucuda tek tutarlı Türkçe güncelleme olarak duyurulabilir; timer, localStorage, yarıçap, layout ve gameplay davranışı değişmedi.
- DoD: temiz run152 baseline + post-change browser/WebGL smoke {SMOKE}/34+ PASS; `node --check`, özellik-spesifik Node DOM regresyonu, checkpoint/world-event/PWA/cache/assets/dialogue/mobile/world safety ve additive-only kapıları PASS; console/page error yok.
- Görsel doğrulama: ARIA metadata piksel çıktısını değiştirmediği için görünür önce/sonra farkı beklenmez; tam browser smoke render davranışının değişmediğini, hedef regresyon testi erişilebilirlik ağacına taşınan atomik semantiği doğrular.
- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi. Performans ölçümü `perf_log.csv` run153 satırında kayıtlı; render yolu değişmedi.
- Memory leak checklist: yeni listener/timer/DOM/geometry/material yok; mevcut dispose + timeout temizliği korunuyor. Teknik borç: 1 (`game3d.js` 545/600 owner kararı bekliyor). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: görsel olarak hayır; ekran okuyucu kullanan oyuncu keşif bildiriminin üç parçasını tek atomik durum mesajı olarak alır.
- Sıradaki güvenli adım: owner bloklarına dokunmadan bağımsız UI/erişilebilirlik veya test-kalite işi; run156 civarı kural konsolidasyonu yaklaşırken final concurrency gate zorunlu.
""",
)

append(
    "DECISIONS.md",
    """

## ADR-0175 — Yerleşim keşfi için atomik erişilebilir durum mesajı (run 153)

**Risk Seviyesi:** LOW

**Karar:** `SettlementDiscovery` mevcut `role=status` ve `aria-live=polite` semantiğini korur; gerçek bir keşif bildirimi gösterilirken additive-only prototype extension ile `aria-atomic=true` uygulanır.

**Neden:** Keşif bildirimi eyebrow + yerleşim adı + keşif ilerlemesi olmak üzere üç ayrı DOM metin düğümünden oluşur. Canlı bölge atomik değilse bazı yardımcı teknolojiler güncellemenin yalnız değişen parçasını okuyabilir. Atomik durum, Türkçe bildirimin bağlamını tek duyuruda korur.

**Alternatifler:** Constructor satırını doğrudan değiştirmek daha sade olurdu fakat additive-only guard'ı ihlal eder. Yeni ikinci bir live-region DOM'u eklemek çift UI sahipliği ve cleanup yükü yaratacağı için reddedildi. Mevcut semantiği olduğu gibi bırakmak parçalı duyuru riskini sürdürürdü.

**Sonuç:** Görsel piksel çıktısı, timer, persistence/localStorage, keşif yarıçapı, update sırası, mobil/desktop/PWA davranışı ve render bütçesi değişmez; yardımcı teknoloji duyurusu daha tutarlı hale gelir.

**Etkilenen sistemler:** `src/3d/ui/settlementDiscovery.js`, hedef regresyon scripti ve run153 CI/kayıtları. `game3d.js`, world generation, EventBus, save formatı ve service-worker cache içeriği etkilenmez.

**Geri alma planı:** Additive extension ileride daha yeni bir erişilebilirlik policy katmanı tarafından gölgelenebilir; owner additive-only refactor istisnası verirse semantik constructor içine taşınabilir. Mevcut satırları silmek/değiştirmek gerekmez.
""",
)

append(
    "STABLE_TAGS.md",
    f"- {TAG} — run 153 settlement discovery atomic accessibility; {SMOKE}/34+ browser smoke and a11y/governance/mobile/PWA gates PASS.\n",
)
