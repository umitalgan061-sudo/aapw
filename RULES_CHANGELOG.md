# RULES_CHANGELOG.md — GOVERNANCE.md Kural Konsolidasyonu Kayıtları

`GOVERNANCE.md` §8.12 gereği, her ~20 çalıştırmada bir (veya bir FAZ tamamlanınca) çalıştırılan
"kural konsolidasyonu" alt görevinin tek satırlık özetleri. En yeni giriş en üstte.

---

- **Run 156 (2026-08-07, beşinci konsolidasyon geçişi):** `GOVERNANCE.md` (136'dan beri ~20
  çalıştırma sonra beşinci kez) §1-29 baştan sona gözden geçirildi. §16 Ertelenmiş Kurallar
  tablosu: `SaveSystem` hâlâ yok (sahte pozitif — `dragonController.js`'deki tek eşleşme kuralın
  kendi açıklayıcı yorumu, gerçek bir `SaveSystem` modülü değil), public API/mod desteği hâlâ yok,
  smoke test hâlâ yeterli (34/34 PASS, sık regresyon kaçmıyor), F2'nin `renderer.info`
  istatistikleri hâlâ yeterli — dördü de hâlâ aktivasyon koşulunu karşılamıyor, değişiklik yok.
  **Gerçek bulgu:** §15 Periyodik Platform Kontrolü satırı run 112'den beri güncellenmemişti; oysa
  `3D_GAME_PROGRESS.md` run 143'ün kendi platform kontrolünü zaten yaptığını gösteriyordu — kural
  metniyle gerçek geçmiş arasında bir tutarsızlıktı. Bu run kontrolü fiilen yeniden çalıştırdı
  (`checkPwaInstallability.js` OK, `checkServiceWorkerCache.js` OK, `npm audit` hâlâ N/A, WebGL
  smoke 34/34 PASS) ve §15'i run 156/sonraki pencere ~176-186 olarak güncelledi — tam da §8.12'nin
  yakalaması gereken türden geçersiz kalmış bir madde. `perf_log.csv` artık 95 satıra ulaştı (30+
  eşiği run 96'da zaten geçilmiş ve ADR-0137 ile ele alınmıştı, §16 satırı zaten "✅ Ele alındı"
  işaretli — yeniden açılacak bir şey yok). §8.11 (tag push HTTP 403, run 58'den beri kalıcı) hâlâ
  güncel ve doğru. Owner'a run 151'de push bildirimiyle iletilen 4 açık madde (🔴 sızmış API
  anahtarı + mobil radius-5/ADR-0166 + `game3d.js` bölünmesi + world-event determinism/ADR-0172)
  hâlâ yanıt bekliyor; bu run onları tekrar bildirmedi (anti-spam kuralı, run 151 notu). Başka
  çelişen/geçersiz madde bulunmadı; geri kalan tüm kurallar hâlâ geçerli ve aktif. Sıradaki
  konsolidasyon ~run 176 civarı (veya bir FAZ tamamlanınca daha erken).

- **Run 116 (2026-08-07, üçüncü konsolidasyon geçişi):** `GOVERNANCE.md` (96'dan beri ~20
  çalıştırma sonra üçüncü kez) baştan sona gözden geçirildi. §16 Ertelenmiş Kurallar tablosu:
  `SaveSystem` hâlâ yok (sahte pozitif — `game3d.js:177`'deki tek eşleşme kuralın kendi açıklayıcı
  yorumu, "SaveSystem exists yet" ifadesinin bir parçası, gerçek bir modül değil), public API/mod
  desteği hâlâ yok (sahte pozitif — `dragonController.js`'deki eşleşme "no other public API"
  ifadesinin bir parçası), smoke test hâlâ yeterli (33/33 PASS, sık regresyon kaçmıyor), F2'nin
  `renderer.info` istatistikleri hâlâ yeterli (FPS düşüşü/nedeni belirsizliği yaşanmadı) — dördü de
  hâlâ aktivasyon koşulunu karşılamıyor, değişiklik yok. `perf_log.csv` artık 57 veri satırı (run
  96'da 30+ eşiği geçilmişti, run 110'da ADR-0137 ile zaten ele alınmıştı — §16 satırı zaten "✅ Ele
  alındı" işaretli, yeniden açılacak bir şey yok). §8.11 (tag push HTTP 403, run 58'den beri kalıcı)
  ve §15 (periyodik platform kontrolü, son run 112, sıradaki ~run 132-142) hâlâ güncel ve doğru.
  Başka çelişen/geçersiz madde bulunmadı; geri kalan tüm kurallar hâlâ geçerli ve aktif. Sıradaki
  konsolidasyon ~run 136 civarı (veya bir FAZ tamamlanınca daha erken).

- **Run 96 (2026-08-06, ikinci konsolidasyon geçişi):** `GOVERNANCE.md` (76'dan beri ~20 çalıştırma
  sonra ikinci kez) baştan sona gözden geçirildi. §16 Ertelenmiş Kurallar tablosu: `SaveSystem` hâlâ
  yok (sahte pozitif — `game3d.js`'deki tek eşleşme kuralın kendi açıklayıcı yorumu, gerçek bir
  `SaveSystem` modülü değil), public API/mod desteği hâlâ yok (sahte pozitif —
  `dragonController.js`'deki eşleşme "no other public API" ifadesinin bir parçası), smoke test hâlâ
  yeterli (28/28 PASS, sık regresyon kaçmıyor), F2'nin `renderer.info` istatistikleri hâlâ yeterli
  (FPS düşüşü/nedeni belirsizliği yaşanmadı) — dördü de hâlâ aktivasyon koşulunu karşılamıyor,
  değişiklik yok. Tek gerçek bulgu: `perf_log.csv` artık 39 veri satırına ulaştı (§16'nın "30+ satır"
  eşiği run 96'da geçildi) — bu bir zorunluluk yaratmıyor, sadece "30-commit performans trend
  grafiği" maddesini artık gerçekten ele alınabilir bir alt görev hâline getiriyor; `GOVERNANCE.md`
  §16'ya tek satırlık not olarak işlendi. §8.11 (tag push HTTP 403) ve §15 (periyodik platform
  kontrolü, son run 91, sıradaki ~run 111-121) hâlâ güncel ve doğru. Başka çelişen/geçersiz madde
  bulunmadı; geri kalan tüm kurallar hâlâ geçerli ve aktif.

- **Run 76 (2026-08-05, ilk konsolidasyon geçişi):** `GOVERNANCE.md` (56'dan beri ~20 çalıştırma
  sonra ilk kez), §16 Ertelenmiş Kurallar tablosu (SaveSystem yok/perf_log.csv 19 satır — ikisi de
  hâlâ eşiğin altında, aktivasyon yok), §15 Periyodik Platform Kontrolü (son kontrol run 70,
  ~run 90-100'e kadar tekrar gerekmiyor) gözden geçirildi. Tek gerçek güncelleme: §8.11'e run
  58'den beri her çalıştırmada aynı sonuçla tekrarlanan `git tag` push (`HTTP 403`) bilgisi kalıcı
  bir ortam kısıtı olarak not düşüldü — artık her run'da yeniden "keşfedilecek" bir bulgu değil,
  yerel tag + `STABLE_TAGS.md` girdisinin kontrol noktası için yeterli sayıldığı açıkça yazıldı.
  Başka çelişen/geçersiz madde bulunmadı; geri kalan tüm kurallar hâlâ geçerli ve aktif.

- **Run 136 (2026-08-07, dördüncü konsolidasyon geçişi):** Run 116dan ~20 çalıştırma sonra GOVERNANCE.md yeniden gözden geçirildi. SaveSystem/public API aktivasyon koşulları hâlâ karşılanmıyor; smoke ve F2/mobile perf kapıları yeterli çalışıyor; run132 platform kontrolü güncel. Çelişen/geçersiz kural bulunmadı. Mobil coverage programına yeni §26 vegetation geometry-LOD kapısı eklendi. Run135 checkpoint satır biçimi parser uyumluluğu additive alias ile onarıldı. Sıradaki konsolidasyon ~run 156 veya FAZ tamamlanınca.
