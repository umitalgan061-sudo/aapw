#!/usr/bin/env python3
"""Append run-132 governance/ADR/progress/checkpoint records after all CI gates pass."""

from __future__ import annotations

import os
from pathlib import Path


def append(path: str, text: str) -> None:
    p = Path(path)
    p.write_text(p.read_text(encoding="utf-8") + text, encoding="utf-8")


def main() -> None:
    stamp = os.environ["RUN132_STAMP"]
    tag = os.environ["RUN132_TAG"]
    mobile_sample = os.environ["RUN132_MOBILE_SAMPLE"]
    smoke_pass_count = os.environ["RUN132_SMOKE_PASS_COUNT"]
    perf_row = os.environ["RUN132_PERF_ROW"]

    append(
        "GOVERNANCE.md",
        """

## 24. Gerçek Mobil Render Bütçesi Kapısı (run 132)

Mobil World Coverage yarıçapı/LOD/vegetation yoğunluğu gibi resident yükü artırabilecek her yeni
adım öncesinde `node scripts/checkMobilePerfBudget.js` PASS olmalıdır. Bu test Chromium'u gerçek
`isMobile + hasTouch` context'iyle açar, `(pointer: coarse)` yolunun aktif olduğunu doğrular ve F2
panelindeki gerçek `renderer.info` sayaçlarını kullanarak `DrawCalls < 500` ve `Triangles < 500K`
bütçelerini otomatik uygular. Headless FPS yalnız trend sinyalidir; gerçek telefon 30-60 FPS hedefi
olarak yorumlanmaz. `renderer.info` texture nesne sayısını verir fakat resident texture-memory byte
miktarını vermediği için `<512 MB TextureMem` için sahte bir tahmin üretilmez; o madde gerçek cihaz /
uygun profiler doğrulaması gerektirir. Bu kapı geçmeden mobil streaming radius'u bir üst seviyeye
çıkarılmaz.

**Periyodik platform kontrolü — run 132:** PWA installability + service-worker cache kontrolleri
PASS, WebGL gerçek Chromium smoke ile PASS; repoda `package.json` olmadığı için `npm audit` hâlâ
N/A. Bir sonraki periyodik kontrol yaklaşık run 152-162 aralığında yapılır.
""",
    )

    append(
        "DECISIONS.md",
        """

## ADR-0156 — Mobil coverage artışı öncesinde gerçek mobile-context render-budget kapısı
**Risk Seviyesi:** LOW

**Karar:** `scripts/checkMobilePerfBudget.js`, Playwright Chromium'u mobile+touch context'inde açıp
coarse-pointer yolunu doğrular ve F2 `renderer.info` üzerinden DrawCalls<500 / Triangles<500K
bütçelerini zorunlu kapı yapar. Texture-memory bytes tarayıcı tarafından doğrudan sunulmadığından
bu CI aracı MB değeri tahmin etmez.

**Neden:** Run 130 bounded streaming ile mobil resident footprint'i büyüttü. Sonraki radius/LOD
adımlarının tahminle değil aynı gerçek runtime yolundan alınan ölçülebilir GPU-submission sayılarıyla
yönetilmesi gerekiyor.

**Alternatifler:** (1) Yalnız desktop `collectPerfSnapshot` kullanmak reddedildi; mobile coarse-pointer
yolunu çalıştırmıyor. (2) Texture nesne sayısından MB uydurmak reddedildi; çözünürlük/format/mipmap
bilgisi olmadan yanlış güven üretir. (3) Gerçek cihaz lab'ı tek zorunlu kapı yapmak şimdilik reddedildi;
saatlik otomasyon için sürekli erişilebilir değil.

**Sonuç:** Coverage büyütme işleri önce otomatik mobile render bütçesini kanıtlayacak. Gerçek cihaz
FPS ve texture-memory doğrulaması ayrıca geçerliliğini korur.

**Etkilenen sistemler:** dev-tool/CI, mobil performans yönetişimi; runtime gameplay davranışı yok.

**Geri alma planı:** Yeni script/workflow kullanılmaz; runtime kaynakları bu ADR ile değiştirilmedi.
""",
    )

    append(
        "3D_GAME_PROGRESS.md",
        f"""

## Run 132 — mobile render-budget gate ({stamp})
- Alt görev 1: gerçek mobile+touch Chromium context kullanan scripts/checkMobilePerfBudget.js eklendi; mobil coverage artışları için DrawCalls<500 ve Triangles<500K otomatik kapı oldu.
- Mobil ölçüm: {mobile_sample}
- DoD: node --check PASS; tüm statik/PWA/cache/checkpoint/terrain/road/mobile-streaming guardları PASS; browser smoke {smoke_pass_count}/34+ PASS; additive-only PASS; konsol/page error yok.
- Platform kontrolü: PWA installability PASS; service-worker cache PASS; WebGL browser smoke PASS; npm audit N/A (package.json yok).
- Desktop trend kaydı: {perf_row}
- World Coverage: desktop %96.2; mobil resident footprint yaklaşık %8.9 (run130 radius 3) korunuyor. Bu run yeni radius artırmadı; önce ölçüm kapısını kalıcılaştırdı.
- Memory leak: yeni runtime listener/timer/DOM/geometry/material yok. Teknik borç: 0 yeni. ADR-0156. Risk LOW. Güven 5/5.
- World Evolution Report delta: yol 0 km, orman 0 km², kale/NPC/event/hayvan 0; oyuncu davranışı değişmez; sonraki güvenli adım mobil terrain/vegetation LOD+culling ölçümü.
""",
    )

    append(
        "STABLE_TAGS.md",
        f"\n- {tag} — run 132 mobile render-budget gate; mobile budget PASS, browser smoke {smoke_pass_count}/34+ PASS, platform checks PASS.\n",
    )


if __name__ == "__main__":
    main()
