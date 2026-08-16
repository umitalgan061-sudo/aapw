# Automation Recovery Precedence

Bu dosya dört saatlik terrain ajanının bootstrap/recovery karar önceliğini tanımlar ve `TERRAIN_AUTOMATION_RULES.md`, `four_corner_ledger.json`, ilgili corner claim ve `canonical_map_provenance.json` ile birlikte okunur.

## Otorite sırası

1. Güncel `origin/main` ve gerçek merged PR geçmişi.
2. Exact-head authoritative CI kanıtı.
3. `four_corner_ledger.json`.
4. İlgili `corner_claims/*.json`.
5. Open/stale PR açıklaması veya eski görev metni.

Daha düşük otoritedeki eski bilgi, daha yüksek otoritedeki güncel bilgiyi bloke edemez.

## Canonical map availability kuralı

`map.png-r1` canonical kimliği SHA256 `20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1`, byte length 667206, decoded 1536x1024 ve doğrulanmış byte encoding JPEG/JFIF'tir. Tarihsel `.png` uzantısı encoding otoritesi değildir.

Exact source bytes çalışma/CI ortamında mevcut değilse yalnız yeni raw-pixel extraction, yeni raster-derived geography ve yeni pixel-to-render fidelity metrikleri bekler. Aynı canonical SHA'ya zaten bağlı merged geography/terrain girdileri sonraki katmanların requalification/authoring çalışmalarında kullanılmaya devam eder. Source bytes yokluğu tek başına mevcut SHA-bound layer için no-op nedeni değildir.

Exact bytes mevcutsa `scripts/canonicalMapProvenance.mjs` ile magic bytes, SHA256, byte length ve decoded dimensions doğrulanır. Owner bytes yalnız uzantıyı düzeltmek için transcode/re-encode edilmez.

## Recovery / no-op kuralı

- Stale PR current candidate değildir; main ilerlediyse fresh exact-main successor gerekir.
- Merged bir PR ile çözülmüş blocker tekrar blocker olarak raporlanamaz.
- Aynı blocker ikinci kez görülürse RCA veya başka güvenli/anlamlı iş gerekir.
- Ledger/claim `next_action` güncel merged history ile çelişmiyorsa uygulanır.
- Güvenli/anlamlı iş varken boş saatlik tur yapılmaz.
- NW özelinde G10 refinement kararı çözülmeden severity taramasıyla başka hücreye sıçranmaz.

## CI ve green draft ilerlemesi

Current-scope workflow + Run 283 Final Head Governance Gate + PR Main Freshness Guard + World Event Determinism Guard ve ilgiliyse Terrain3D toolchain authoritative zincirdir. Historical unrelated workflow yalnız ilk exact-scope/changed-file ownership gate'inde başarısız olup substantive adımların tamamı skipped ise açık run/job kanıtıyla non-authoritative noise sayılabilir. Substantive/global/safety/freshness/current-scope hatası görmezden gelinmez.

Exact-head authoritative kontroller yeşil, main değişmemiş ve overlap lease yoksa green draft kalıcı bekletilmez: ready-for-review, ready-event freshness, main re-check ve expected-head SHA korumalı merge uygulanır.

## Saatlik kota

Run-start base → final head toplam additions + deletions ve tek PR için üst sınır 1000 satırdır. Güvenli/anlamlı iş kaldıkça filler üretmeden sınıra yaklaşılır; DoD, güvenlik, concurrency ve tek-amaçlı tasarım kotadan üstündür.
