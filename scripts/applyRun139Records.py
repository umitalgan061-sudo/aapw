#!/usr/bin/env python3
"""Append Run 139 governance/progress/checkpoint records after every validation gate passes."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def append(path: str, text: str) -> None:
    target = ROOT / path
    target.write_text(target.read_text(encoding="utf-8") + text, encoding="utf-8")


def main() -> None:
    stamp = os.environ["RUN139_STAMP"]
    tag = os.environ["RUN139_TAG"]
    projection = os.environ["RADIUS_PROJECTION"]
    perf_row = os.environ["PERF_ROW"]
    smoke_count = os.environ["SMOKE_PASS_COUNT"]

    append(
        "GOVERNANCE.md",
        """

## 27. Mobil Radius Readiness Kanıt Kapısı (run 139)

Canlı mobil streaming radius'u, `QUESTIONS_FOR_OWNER.md` / ADR-0157'deki sahip kararı çözülmeden
değiştirilemez. Bununla birlikte kararın performans tarafı tahmine bırakılmaz: `scripts/checkMobileRadiusReadiness.js`
önce mevcut radius-3 + terrain FAR=16 politikasının kaynakta hâlâ geçerli olduğunu doğrular, sonra gerçek
mobile/touch Chromium `checkMobilePerfBudget.js` örneğini alır ve radius 4'e eklenecek 32 dış-halka terrain
chunk'ının tamamının aynı karede çizildiğini varsayan kötümser bir üst sınır hesaplar. Bu üst sınır bile
DrawCalls<500 ve Triangles<500K kapılarını geçmiyorsa yalnızca "ölçülebilir render bütçesi açısından hazır"
sinyali verilir; `governanceApproval` özellikle false kalır. Texture-memory <512 MB ve gerçek telefon 30-60 FPS
hedefleri uygun gerçek cihaz/profiler olmadan uydurulmaz. Bu gate PASS olması radius artışı için sahip onayının
yerine geçmez.
""",
    )

    append(
        "DECISIONS.md",
        """

## ADR-0162 — Mobil radius 4 için konservatif readiness gate (run 139)

**Risk Seviyesi:** LOW

**Karar:** Canlı radius'u değiştirmeden `scripts/checkMobileRadiusReadiness.js` eklendi. Araç gerçek mobile/touch
Chromium render ölçümünü alır; mevcut run-130 radius=3 ve run-134 FAR=16 politikasının kaynakta hâlâ aynı olduğunu
kanıtlar; radius 4'ün 49→81 resident chunk farkı olan 32 yeni dış-halka chunk'ının her birini 16x16 segmentli
PlaneGeometry kabul ederek 16.384 ek terrain triangle ve en fazla 32 ek draw submission üst sınırı hesaplar.

**Neden:** ADR-0157 / QUESTIONS_FOR_OWNER.md canlı radius 3→4 değişikliğini sahip kararına bağladı. Aynı engeli yeniden
demek yerine kararın performans tarafını ölçülebilir kanıta çevirmek, §22 regression-guard ruhuna ve §23-24 mobil
coverage politikasına daha uygundur.

**Alternatifler:** Radius'u doğrudan 4 yapmak reddedildi (sahip kararı bekliyor). Sadece teorik formül kullanmak reddedildi
(gerçek mobile Chromium baseline'ı olmadan sahne maliyetini kaçırır). Gerçek telefon FPS/texture MB değeri uydurmak
reddedildi (mevcut CI bu ölçümleri güvenilir biçimde sağlayamıyor).

**Sonuç:** Gate PASS ise radius 4'ün ölçülebilir draw-call/triangle bütçesinde konservatif headroom'u olduğu kanıtlanır,
ama runtime davranışı değişmez ve coverage ~%8.9'da kalır.

**Etkilenen sistemler:** Yalnız `scripts/` doğrulama katmanı + yönetişim kayıtları; gameplay/render/PWA runtime davranışı yok.

**Geri alma planı:** Yeni guard çağrısını gelecekte kullanmamak yeterlidir; runtime kodu değiştirilmedi.
""",
    )

    progress = f"""

## Run 139 — mobile radius-4 readiness evidence ({stamp})
- Alt görev: canlı mobil radius değiştirilmeden, gerçek mobile/touch Chromium baseline + konservatif radius-4 üst-sınır hesabı yapan `scripts/checkMobileRadiusReadiness.js` eklendi.
- Kanıt: {projection}
- DoD: node --check PASS; mobil streaming/terrain-LOD/spawn-vegetation/vegetation-LOD/PWA/cache/assets/checkpoint/world-event/terrain/road guard PASS; browser smoke {smoke_count}/34+ PASS; additive-only PASS; konsol/page error yok.
- Performans: {perf_row}
- Görsel doğrulama: runtime/render davranışı değişmedi; yeni araç yalnız CI/readiness ölçümü. Bu nedenle yeni görsel delta yok.
- Teknik borç: 1 (`game3d.js` 540/600); yeni borç 0. World Coverage: desktop %96.2 / mobile resident ~%8.9 değişmedi. World Evolution delta: 0; oyuncu fark etmez. Risk: LOW. Güven: 5/5.
- Next step: ADR-0157 sahip kararı çözülmeden radius değişmez; FAZ 6 modelleri ve kale texture asset'leri beklenir. Yeni runtime eklemeleri `game3d.js` yerine ayrı modüllere yönlendirilir.
"""
    append("3D_GAME_PROGRESS.md", progress)
    append(
        "STABLE_TAGS.md",
        f"\n- {tag} — run 139 mobile radius readiness evidence; smoke {smoke_count}/34+ PASS, additive-only PASS.\n",
    )


if __name__ == "__main__":
    main()
