# GOVERNANCE.md — Westeros PWA 3D RPG: Kalıcı Yönetişim Kuralları

Bu dosya, çok-oturumlu (günlük/saatlik) otonom geliştirme sürecinin biriken TÜM kalıcı
kurallarını tek yerde toplar. Her çalıştırmanın Session Snapshot adımı bu dosyayı okur.
Proje sahibi artık bu kuralları her seferinde tekrar yazmaz — sadece yeni ekleme/değişiklik
olduğunda kısa bir not gönderir, o zaman bu dosya güncellenir.

**Kapsam:** ÖZEL repo, Westeros/GoT tema serbest. TEK KISIT: gerçek HBO görsel/ses indirme yok.

---

## 1. Anayasa

Kod yazmadan önce düşün, yazdıktan sonra doğrula, commit atmadan önce eleştir.
**Bilmeme kuralı:** emin olmadığın API'yi tahmin etme; TODO bırakma (ADR'siz izlenemez
bırakma yasak — belirsizlik varsa ADR yaz ya da `QUESTIONS_FOR_OWNER.md`'ye sor).

## 2. Altın Kurallar

1. Mevcut 2D oyunu koru (regresyon yok).
2. `node --check` her alt görev sonrası, her değişen dosya için.
3. Şüphede geri al.
4. Asset formatı: GLTF/GLB/FBX, lisans: CC0/CC-BY/Mixamo/Free3D Personal Use, offline PWA uyumlu.
5. Her commit çalışır olmalı (bozuk ara durum commit'lenmez).
6. Refactor sadece bug/perf/okunabilirlik/mimari nedenlerle yapılır.
7. Dosya 600 satırı geçmezse iyi, geçerse böl.
8. Her alt görev sonu memory-leak checklist (listener/timer/DOM/geometry-material dispose).

## 3. Hedef Mimari

```
src/
  core/ Engine,Renderer,SceneManager,AssetManager,EventBus,Config,Time,Input,SaveSystem
  world/ Terrain,Water,Vegetation,Roads,Rivers,Weather,Settlements
  gameplay/ Player,NPC,Dragons,Animals,Combat,Inventory,Quests,Dialogue,WorldEvents
  ui/ shaders/(*.glsl) physics/ audio/ debug/ game3d.js
```

## 4. Kod Kalitesi / Performans

- ES Modules, fonksiyon <300 satır, JSDoc, SOLID/DRY/KISS.
- FPS hedefi: Desktop 60-120, Mobil 30-60.
- Desktop bütçe: DrawCalls<2500, Triangles<5M, TextureMem<2GB.
- Mobil bütçe: DrawCalls<500, Triangles<500K, TextureMem<512MB.

## 5. Determinizm & Seed

Seeded random zorunlu (`mulberry32` vb.). `Math.random()` dünya üretiminde yasak.

## 6. Mobil / Grafik / Debug

Dokunmatik kontrol, kalite ayarları, F2 profiling paneli, F4 debug free-cam.

## 7. Dünya Ölçeği

Tüm krallıkları kapsayan, 150 km² sınırı (~137.5 km² hedef, ADR-0004). World Coverage
her çalıştırma sonunda ölçülüp raporlanır.

---

## 8. Süreklilik / Kalite Süreci

### 8.1 Definition of Done (DoD) — hepsi geçmeden DONE yok
- [ ] `node --check` (değişen her dosya)
- [ ] Smoke test (mevcut suite, regresyon yok)
- [ ] Görsel kanıt (bkz. §8.5 Görsel Doğrulama Standardı)
- [ ] Performans bütçesi kontrolü (§4)
- [ ] Teknik borç sayacı güncellendi (§13.2)
- [ ] `3D_GAME_PROGRESS.md` güncellendi
- [ ] Gerekiyorsa ADR yazıldı (§9)
- [ ] Commit atıldı
- [ ] **Konsol Temizliği:** tarayıcı konsolunda yakalanmamış hata/uyarı yok (headless
      Chromium boot sırasında `console.error`/sayfa hatası sıfır olmalı)

### 8.2 Root Cause Analysis
Aynı hata 2. kez görülürse: önce **Root Cause / Prevention / Regression Test** yazılır,
sonra kod. Sebepsiz "tekrar dene" yasak.

### 8.3 AI Self-Review 2. Geçiş
Commit öncesi kod, kıdemli bir mühendis gözüyle tekrar eleştirilir (naiflik, edge-case,
performans, okunabilirlik).

### 8.4 Değişiklik Etki Analizi
Arazi/yükseklik/noise/dünya ölçeği değişikliklerinde: önce etkilenen sistemler + risk
yazılır, sonra kod, sonra ilgili smoke test.

**Arazi Değişikliği Güvenlik Kontrolü** (height sampler değişikliğinden ÖNCE ve SONRA,
otomatik):
- 14 krallık koltuğunun hiçbiri su altında değil
- hiçbiri gidilemez eğimde değil
- yol bağlantıları geçerli

**Gelecek Faz Etkisi sorusu:** bu değişiklik başlamamış fazları nasıl etkiler? (yazılı olarak
yanıtlanır, ADR'ye eklenir.)

### 8.5 Görsel Doğrulama Standardı
En az 2 kamera açısı, F4 yakın+uzak, mümkünse önce/sonra. Kanıt yetersizse DONE sayılmaz.

### 8.6 Oturum Kalite Kapısı
3. alt görevden sonra güven skoru (1-5) değerlendirilir; <4 ise dur. "6 ay sonra hâlâ net
mi anlaşılır mı" tereddüdü varsa dur.

### 8.7 Çalışma Süresi Sınırları
- **Dosya bazlı:** aynı dosyada 90dk+ takılırsan bırak, geri dön, sıradaki maddeye geç.
- **Çalıştırma geneli süre tavanı:** tek bir çalıştırma (zincirleme tüm alt görevler dahil)
  ~6-8 saati ya da makul bir alt görev sayısını aşmasın; kalite kapısı geçse bile aşılırsa
  çalıştırmayı sonlandır.

### 8.8 Geçici Çözüm Yok
`TEMP`/`HACK`/`FIXME`/`WORKAROUND` yorumu yasak. Gerekiyorsa ADR + kaldırılacağı koşul
yazılır.

### 8.9 Prosedürel Regresyon Kontrolü
Sabit seed + koordinat için beklenen değerler JSON fixture'da tutulur.

**Deterministik Regresyon Snapshot:** prosedürel üreteçlerin (arazi/yol/bitki) sabit-seed
çıktısının checksum'ı saklanır; beklenmedik değişim = regresyon işareti (ADR'de
açıklanmadıysa).

### 8.10 Dünya Tutarlılık Kuralları (yol + arazi)
- Ana yol eğime duyarlı rota seçer, dağın dik yamacından düz geçmez.
- Nehir dağın içinden delip geçmez.
- Kaleler yol ağına bağlanır.

### 8.11 Kararlı Kontrol Noktaları
Her çalıştırma sonunda Oturum Kalite Kapısı geçildiyse ve oyun sorunsuz açılıyorsa:
`git tag stable-YYYY-MM-DD-HHmm` atılır, `STABLE_TAGS.md`'ye tek satır not düşülür.

### 8.12 Kural Seti Bakımı
Her ~20 çalıştırmada bir (veya bir FAZ tamamlanınca) kısa bir "kural konsolidasyonu" alt
görevi çalıştırılır: artık geçersiz/çelişen `GOVERNANCE.md` maddeleri işaretlenir/güncellenir,
`RULES_CHANGELOG.md`'ye tek satır not düşülür.

### 8.13 Hata Sınırı / Güvenli Mod
Ana alt sistemler (ejderha AI, hayvan AI, diyalog, dünya olayları) try/catch ile sarılır;
biri patlarsa tüm oyun çökmez, sadece o alt sistem loglanıp devre dışı kalır. Yeni
yazılan/dokunulan alt sistemlerde uygulanır; mevcutları zorla geriye dönük sarma — fırsat
çıktıkça ekle.

### 8.14 Eşzamanlılık Kontrolü (run 57'de eklendi)
Birden fazla otonom oturum aynı anda çalışıyor olabilir (aynı GOVERNANCE.md öncelik listesinden
aynı maddeyi paralel seçip iki kere yapma riski — run 57'de gerçekten yaşandı: iki oturum
bağımsız olarak aynı yol-ağı özelliğini inşa etti, biri push etmeden önce fark edip kendi
kopyasını attı). Bir alt göreve BAŞLAMADAN ÖNCE `git fetch origin main` (veya ana dal adı neyse)
çalıştırılır ve sonucu yerel bilinen son commit ile karşılaştırılır; `origin` ileri gitmişse önce
`git merge --ff-only`/`git checkout -B main origin/main` ile senkronize olunur ve
`3D_GAME_PROGRESS.md`'nin en son "This Run" girdisi okunarak o an gerçekten hangi öncelik
maddesinin hâlâ yapılmamış olduğu teyit edilir — liste sırası tek başına yeterli değildir,
başka bir oturum aynı anda üstündeki maddeyi bitirmiş olabilir. Commit atmadan HEMEN ÖNCE de
aynı `git fetch` tekrarlanır (bir alt görev sürerken de başka bir oturum push etmiş olabilir);
çakışma varsa GOVERNANCE.md/kod hangi sürümün gerçek çalışan+doğrulanmış olduğu karşılaştırılıp
karar verilir, iki rakip kopya asla aynı anda push edilmez.

---

## 9. ADR / Kayıt Standardı

**Minimum içerik:** Karar / Neden / Alternatifler / Sonuç / Etkilenen sistemler / Geri
alma planı.

**Risk Seviyesi etiketi:** LOW / MEDIUM / HIGH / IRREVERSIBLE.

## 10. Asset / Lisans

- Yeni asset öncesi: lisans + hafif kalite notu (poly count, texture çözünürlüğü, LOD, PBR)
  `assets_manifest.json`'a eklenir.
- **CREDITS.md / Atıf Defteri:** CC-BY lisanslı (veya atıf gerektirebilecek) her asset için
  yazar/kaynak/lisans metni `CREDITS.md`'ye eklenir (private repo olması atıf yükümlülüğünü
  kaldırmaz).
- **Kaynak URL + Tarih Kaydı:** `assets_manifest.json`'daki her asset girdisine indirilen
  URL (`sourceUrl` — zaten var) + `dateAdded` eklenir.

## 11. Yerleşim / Dünya (yalnızca GELECEKTEKİ yeni yerleşimler — mevcut 14 koltuk retroaktif değil)

Yeni yerleşim eklerken: su kaynağına mantıklı uzaklık, yol ağına bağlanabilirlik, uygun
rakım kontrolü.

## 12. Dinamik Öncelik / Borç

**Dinamik Öncelik Ayarı** — öncelik şu durumlarda güncellenir:
- Coverage < %98
- performans limiti %90+ doluysa
- teknik borç 3 çalıştırmada arttıysa
- yeni görsel şikayet geldiyse

**Hafif Teknik Borç Sayacı:** her özette tek bir tam sayı.

## 13. Raporlama

- **World Evolution Report:** her çalıştırma sonunda delta tablo (yol km, orman km²,
  kale/NPC/event/hayvan sayısı, coverage%, toplam asset/diyalog/ADR sayısı) + "oyuncu fark
  eder mi" notu.
- **İnsan Yakalama Özeti:** her 10 çalıştırmada bir, `CATCH_UP.md`'ye 5-10 cümlelik
  jargonsuz "oyunda yeni ne var" özeti eklenir (en yeni en üstte).
- **Hafif Performans Günlüğü:** her çalıştırma sonunda FPS/drawcall/triangle/mem değerleri
  tek satır olarak `perf_log.csv`'ye eklenir (dashboard/grafik yok, sadece ham veri).

## 14. Karar Eskalasyonu

**`QUESTIONS_FOR_OWNER.md`:** bir tasarım/ürün kararı (API değil) belirsizse tahmin
edilmez — bu dosyaya tek satırlık soru + geçici/varsayılan seçim eklenir, sıradaki alt
göreve geçilir.

## 15. Dil / Platform

- **Oyun-içi metnin dili:** TÜRKÇE sabit (mevcut diyaloglar zaten Türkçe). Kod/yorum dili
  (İngilizce kalabilir) ile oyun-içi metin dili karıştırılmaz.
- **PWA Cache Versiyonlama:** 3D mod asset sayısı büyüdükçe service worker
  cache-invalidation (versiyon numarası, eski cache temizliği) ve offline depolama kotası
  izlemesi tanımlanır — 2D oyunun service worker'ı daha önce zaten denetlenmişti, bu onu 3D
  asset'lerine genişletir.
- **Periyodik Platform Kontrolü:** ~ayda bir (20-30 çalıştırmada bir) `npm audit`, PWA hâlâ
  kurulabiliyor mu, WebGL bekleneni veriyor mu kontrol edilir.

---

## 16. Ertelenmiş Kurallar (koşullu reddedilenler — aktivasyon koşulu gerçekleşince otomatik aktif)

| Kural | Aktivasyon koşulu |
|---|---|
| Save Game Uyumluluk Kapısı | `SaveSystem` gerçekten eklenince |
| API Kararlılığı etiketleri (breaking/minor/patch) | public API/mod desteği eklenene kadar hayır |
| Tam Test Piramidi (7 katman) | mevcut smoke test yetersiz kalmaya başlarsa (sık regresyon kaçıyorsa) |
| Frame Budget alt-sistem süre ölçümü | F2 panelinin `renderer.info` istatistikleri yetersiz kalırsa (FPS düşüyor ama nedeni belirsizse) |
| Resmi 1-10 Kod Kalite Skoru | uygulanmıyor — Oturum Kalite Kapısı'nın 1-5 güven skoru yeterli kabul edildi |
| 30-commit performans trend grafiği | `perf_log.csv` 30+ satır biriktirdikten sonra düşünülebilir |

---

## 17. Yol Haritası (özet — güncel durum için `3D_GAME_PROGRESS.md`'ye bakılır)

FAZ 0-1 TAMAMLANDI. FAZ 2 ~%95. FAZ 3 ~%90. FAZ 4 TAMAMLANDI. FAZ 5: NPC diyalog 13/14.
FAZ 6: kurt tamam, at/araba/köpek-kedi/kuş kaldı. FAZ 7: ilk ejderha (fark etme var,
reaktif uçuş yok). FAZ 8: dünya olayları büyüyor. FAZ 9-10 başlamadı.

## 18. Görev Öncelik Sırası (güncel)

1. Arazi makro relıyefi (küçük tepe + büyük dağ) — Arazi Değişiklik Güvenlik Kontrolü'ne tabi
2. Yol ağı (patika + at arabası yolu)
3. Zemin yeşil/çim renk düzeltmesi
4. Gerçek kale modellerini dokulandır
5. Syntax hataları
6. Blocking buglar
7. Performans
8. Memory leak
9. Teknik borç
10. Smoke test
11. World Coverage
12. FAZ 7 ejderha / FAZ 5-6
13. Yeni özellik

## 19. Çalıştırma İçinde Zincirleme

Bir alt görevi bitirip commit attıktan sonra durma — Oturum Kalite Kapısı + Çalışma Süresi
Sınırı + Çalıştırma Geneli Süre Tavanı izin verdiği ve bütçe (1200 satır / 25 dosya)
müsaitse sıradaki maddeye geç.

## 20. Session Snapshot (her çalıştırma başında okunur)

`GOVERNANCE.md` (bu dosya), `3D_GAME_PROGRESS.md`, `git log -10`, `DECISIONS.md` son 3
karar, `QUESTIONS_FOR_OWNER.md` (varsa), 7+ gün geçtiyse `ARCHITECTURE.md`.

## 21. Çalıştırma Sonu Zorunlu Özet

Tamamlanan alt görev sayısı + özeti (kanıtla + DoD durumu), faz, değişen dosyalar, World
Coverage, smoke test, performans, teknik borç sayısı, sıradaki adım, risk, World Evolution
Report.

## 22. Regression Guard

Her alt görev öncesi/sonrası smoke test. Aynı hatada 2 başarısız denemeden sonra bırak,
geri al, sıradakine geç.
