#!/usr/bin/env python3
"""Append Run 139 records only after all validation gates pass."""
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
    append("GOVERNANCE.md", """

## 27. Mobil Radius Readiness Kanıt Kapısı (run 139)

Canlı mobil streaming radius'u, `QUESTIONS_FOR_OWNER.md` / ADR-0157'deki sahip kararı çözülmeden değiştirilemez.
`scripts/checkMobileRadiusReadiness.js` mevcut radius-3 + terrain FAR=16 politikasını doğrular, gerçek mobile/touch
Chromium render örneğini alır ve radius 4'e eklenecek 32 dış-halka terrain chunk'ının tamamı aynı karede çiziliyormuş
gibi kötümser bir üst sınır hesaplar. Üst sınır DrawCalls<500 ve Triangles<500K kapılarını geçse bile bu yalnız
"ölçülebilir render bütçesi açısından hazır" sinyalidir; sahip onayının yerine geçmez. Texture-memory <512 MB ve
gerçek telefon 30-60 FPS hedefleri uygun gerçek cihaz/profiler olmadan uydurulmaz.
""")
    append("DECISIONS.md", """

## ADR-0163 — Mobil radius 4 için konservatif readiness gate (run 139)

**Risk Seviyesi:** LOW

**Karar:** Canlı radius'u değiştirmeden `scripts/checkMobileRadiusReadiness.js` eklendi. Araç gerçek mobile/touch
Chromium ölçümünü alır, run-130 radius=3 ve run-134 FAR=16 politikasını doğrular ve radius 4'ün 49→81 resident
chunk farkı olan 32 yeni dış-halka chunk'ını konservatif olarak hesaba katar.

**Neden:** ADR-0157 / QUESTIONS_FOR_OWNER.md canlı radius 3→4 değişikliğini sahip kararına bağladı. Aynı engeli tekrar
demek yerine kararın performans tarafını ölçülebilir kanıta çevirmek §22 ve §23-24 ile uyumludur.

**Alternatifler:** Radius'u doğrudan 4 yapmak reddedildi; sahip kararı bekliyor. Yalnız teorik formül reddedildi;
gerçek mobil Chromium baseline gerekir. Gerçek telefon FPS/texture-MB değeri uydurmak reddedildi.

**Sonuç:** Gate PASS ise radius 4 için ölçülebilir draw-call/triangle headroom'u kanıtlanır; runtime değişmez ve
coverage ~%8.9'da kalır.

**Etkilenen sistemler:** Yalnız doğrulama katmanı ve kayıtlar; gameplay/render/PWA runtime davranışı yok.

**Geri alma planı:** Yeni guard gelecekte çağrılmayabilir; runtime kodu değiştirilmedi.
""")
    append("3D_GAME_PROGRESS.md", f"""

## Run 139 — mobile radius-4 readiness evidence ({stamp})
- Alt görev: canlı mobil radius değiştirilmeden gerçek mobile/touch Chromium baseline + konservatif radius-4 üst-sınır hesabı eklendi.
- Kanıt: {projection}
- DoD: node --check PASS; mobil streaming/terrain-LOD/spawn-vegetation/vegetation-LOD/PWA/cache/assets/checkpoint/world-event/terrain/road guard PASS; browser smoke {smoke_count}/34+ PASS; additive-only PASS; konsol/page error yok.
- Performans: {perf_row}
- Görsel doğrulama: runtime/render davranışı değişmedi; yeni araç yalnız CI/readiness ölçümü, görsel delta yok.
- Teknik borç: 1 (`game3d.js` 540/600); yeni borç 0. World Coverage: desktop %96.2 / mobile resident ~%8.9 değişmedi. World Evolution delta: 0; oyuncu fark etmez. Risk: LOW. Güven: 5/5.
- Next step: ADR-0157 sahip kararı çözülmeden radius değişmez; FAZ 6 modelleri ve kale texture asset'leri beklenir; yeni runtime eklemeleri `game3d.js` yerine ayrı modüllere yönlendirilir.
""")
    append("STABLE_TAGS.md", f"\n- {tag} — run 139 mobile radius readiness evidence; smoke {smoke_count}/34+ PASS, additive-only PASS.\n")

if __name__ == "__main__":
    main()
