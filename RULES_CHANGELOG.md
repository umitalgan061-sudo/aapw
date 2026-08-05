# RULES_CHANGELOG.md — GOVERNANCE.md Kural Konsolidasyonu Kayıtları

`GOVERNANCE.md` §8.12 gereği, her ~20 çalıştırmada bir (veya bir FAZ tamamlanınca) çalıştırılan
"kural konsolidasyonu" alt görevinin tek satırlık özetleri. En yeni giriş en üstte.

---

- **Run 76 (2026-08-05, ilk konsolidasyon geçişi):** `GOVERNANCE.md` (56'dan beri ~20 çalıştırma
  sonra ilk kez), §16 Ertelenmiş Kurallar tablosu (SaveSystem yok/perf_log.csv 19 satır — ikisi de
  hâlâ eşiğin altında, aktivasyon yok), §15 Periyodik Platform Kontrolü (son kontrol run 70,
  ~run 90-100'e kadar tekrar gerekmiyor) gözden geçirildi. Tek gerçek güncelleme: §8.11'e run
  58'den beri her çalıştırmada aynı sonuçla tekrarlanan `git tag` push (`HTTP 403`) bilgisi kalıcı
  bir ortam kısıtı olarak not düşüldü — artık her run'da yeniden "keşfedilecek" bir bulgu değil,
  yerel tag + `STABLE_TAGS.md` girdisinin kontrol noktası için yeterli sayıldığı açıkça yazıldı.
  Başka çelişen/geçersiz madde bulunmadı; geri kalan tüm kurallar hâlâ geçerli ve aktif.
