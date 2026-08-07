#!/usr/bin/env python3
"""Append Run 150 continuity records after all validation gates pass."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAMP = os.environ["RUN150_STAMP"]
TAG = os.environ["RUN150_TAG"]
PERF_ROW = os.environ["RUN150_PERF_ROW"]


def append(relative_path: str, text: str) -> None:
    path = ROOT / relative_path
    with path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(text)


append(
    "3D_GAME_PROGRESS.md",
    f"""

## Run 150 — Çok-agent latest-run uniqueness guard ({STAMP})
- Session Snapshot / concurrency: çalışma Run 149 stable checkpoint'i `2756816e` tabanından başlatıldı; yayın öncesi origin/main aynı SHA üzerinde kalmak zorunda. Run 149'un üç owner blokuna (mobil radius-5, game3d.js bölünmesi, world-event determinism fixture çatışması) dokunulmadı.
- Alt görev: `scripts/checkLatestRunUniqueness.js` eklendi. Mevcut `checkCheckpointConsistency.js` üç kaydın aynı son run numarasını göstermesini doğrularken, yeni guard son run kimliğinin `3D_GAME_PROGRESS.md`, `STABLE_TAGS.md` ve `perf_log.csv` içinde ayrı ayrı TAM BİR kez bulunmasını zorunlu kılıyor. Böylece eşzamanlı NN:19/NN:42 oturumlarının aynı run numarasını iki kez yayımlaması CI seviyesinde yakalanıyor.
- DoD: baseline ve post-change browser/WebGL smoke >=34 PASS; node --check PASS; checkpoint consistency + latest-run uniqueness PASS; PWA installability/service-worker cache/mobile/terrain/road/world-event determinism ve additive-only kapıları PASS; console/page error yok.
- Görsel doğrulama: runtime/render/UI davranışı değişmediği için §8.5 salt test-altyapısı istisnası uygulandı; oyun çıktısı bit-eşit kaldı.
- Performans: `{PERF_ROW}`. World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²), değişmedi.
- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material yok. Teknik borç: 1 (`game3d.js` 545/600 owner kararı bekliyor, değişmedi). Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km; orman 0 km²; kale/NPC/event/hayvan 0; coverage 0; asset/diyalog 0; ADR +1. Oyuncu fark eder mi: doğrudan hayır; çok-agent checkpoint kayıtlarının yanlışlıkla çiftlenmesi artık otomatik yakalanıyor.
- Sıradaki güvenli adım: owner bloklarına dokunmadan FAZ 8 test/kalite veya katalogdan bağımsız düşük-risk gameplay geliştirmesi; her yayın öncesi concurrency gate zorunlu.
""",
)

append(
    "DECISIONS.md",
    """

## ADR-0173 — Son run kimliği için çok-agent uniqueness kapısı (run 150)

**Risk Seviyesi:** LOW

**Karar:** `checkCheckpointConsistency.js` korunur ve yanına additive yeni bir `checkLatestRunUniqueness.js` guard'ı eklenir. Yeni kontrol, üç continuity kaydının yalnızca aynı maksimum run numarasını göstermesini değil, bu maksimum run kimliğinin progress/stable/perf kaynaklarının her birinde tam bir kez bulunmasını da zorunlu kılar.

**Neden:** GOVERNANCE §8.14 aynı anda birden fazla otonom oturum çalışabileceğini açıkça kabul ediyor. İki oturum aynı run numarasıyla kayıt yayımlarsa mevcut consistency kontrolü her üç dosyada da aynı maksimumu görüp PASS verebilir; bu nedenle "aynı run kimliğinin çift sahipliği" ayrı bir invariant olarak doğrulanmalıdır.

**Alternatifler:** Mevcut consistency guard'ını değiştirmek additive-only kuralı nedeniyle reddedildi. Runtime içine kilit/lease eklemek bu sorunun kapsamına göre gereksiz ve daha yüksek riskli bulundu. Yalnız dokümantasyon uyarısı ise otomatik engelleme sağlamadığı için yetersiz görüldü.

**Sonuç:** Çok-agent yayın zincirinde duplicate latest-run kayıtları commit/merge öncesi otomatik FAIL olur. Runtime, PWA, save formatı, world generation ve deterministik gameplay davranışı değişmez.

**Etkilenen sistemler:** Yalnız `scripts/` test/CI ve continuity kayıt doğrulaması.

**Geri alma planı:** Guard tamamen additive yeni dosyadır; yanlış pozitif üretiyorsa sonraki additive policy katmanında çağrısı koşullu hale getirilebilir. Mevcut kaynak satırının silinmesi/değiştirilmesi gerekmez.
""",
)

append(
    "STABLE_TAGS.md",
    f"\n- {TAG} — run 150 latest-run uniqueness guard; full governance/browser/PWA/mobile safety gates PASS.\n",
)
