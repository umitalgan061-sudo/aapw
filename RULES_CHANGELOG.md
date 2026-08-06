# RULES_CHANGELOG.md — GOVERNANCE.md Kural Konsolidasyonu Kayıtları

`GOVERNANCE.md` §8.12 gereği, her ~20 çalıştırmada bir (veya bir FAZ tamamlanınca) çalıştırılan
"kural konsolidasyonu" alt görevinin tek satırlık özetleri. En yeni giriş en üstte.

---

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
