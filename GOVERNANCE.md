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
9. **🔴 KALDIRILDI (2026-08-12, sahip doğrudan talimatı — canlı konuşma, "sadece ekle, asla
   satır silme kuralını kaldırıyorum"):** Aşağıdaki additive-only guard artık YÜRÜRLÜKTE DEĞİL.
   Gerekçe: kural, run 133/137/142/145/149'da (bkz. `QUESTIONS_FOR_OWNER.md`) birden fazla gerçek
   iş kalemini (mobil görüş yarıçapı artışı, `game3d.js` bölünmesi, dünya-olayı kataloğu büyümesi)
   yapısal olarak kilitlemişti — sahip bunu kaldırarak o kilitleri açtı. `scripts/checkAdditiveOnlyDiff.js`
   artık no-op (her zaman PASS döner, bkz. dosyanın kendi başlığı); DoD checklist'teki madde (§8.1)
   buna göre güncellendi. Bundan sonra normal düzenleme/refactor/silme kuralları geçerli (Altın Kural 6:
   refactor yalnız bug/perf/okunabilirlik/mimari nedenlerle) — sınırsız/gerekçesiz satır silme serbest
   bırakılmadı, sadece additive-only ZORUNLULUĞU kalktı. Aşağıdaki metin, kuralın ne talep ettiğinin
   tarihsel kaydı olarak korunuyor:

   Eski kural metni (run 126, proje sahibi tarafından doğrudan `main`'e eklendi —
   commit `3c7e4fb`, `scripts/checkAdditiveOnlyDiff.js`): her commit'ten önce
   `node scripts/checkAdditiveOnlyDiff.js` (varsayılan `origin/main...HEAD`) çalıştırılırdı.
   Kaynak dosyalarda (`.js/.mjs/.cjs/.html/.css/.json/.xml/.glsl/.vert/.frag`) satır SİLİNEMEZ
   veya DEĞİŞTİRİLEMEZ (bir satırı değiştirmek git diff'te 1 silme + 1 ekleme sayılır ve guard'ı
   FAIL ettirir) — yalnız yeni satır EKLENEBİLİR. Mevcut bir davranışı düzeltmek gerekiyorsa: eski
   kodu olduğu gibi bırakıp yanına/üstüne yeni bir ekleme ile üzerine yazacak bir yapı kur (ör. yeni
   bir opsiyonel parametre, yeni bir sarmalayıcı fonksiyon, yeni bir koşul dalı) — tıpkı
   ADR-0111'in `nightFactor` opsiyonel parametresinde veya `ARCHITECTURE.md`'nin 3D mod/2D oyun
   sınırında zaten yıllardır uygulanan "yalnız ekleme, asla mevcut satırı değiştirme" desenini genel
   kaynak ağacına yaymak gibi düşünülebilir. FAIL olursa: değişikliği sadece-ekleme biçiminde yeniden
   tasarla; bu mümkün değilse (gerçek bir satır silme/değiştirme zorunluysa) commit atma, durumu
   `QUESTIONS_FOR_OWNER.md`'ye kısa bir satır olarak düş ve sahibin açık onayını bekle. Belgeleme
   dosyaları (`.md`) guard kapsamı dışında ama iyi pratik olarak mümkün olduğunca additive tutulur.

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
- [ ] ~~**Additive-only guard:** `node scripts/checkAdditiveOnlyDiff.js` PASS~~ — **KALDIRILDI
      (2026-08-12, sahip talimatı, bkz. §2 madde 9).** Script artık no-op; bu checklist maddesi
      artık zorunlu değil, geriye dönük kayıt olarak bırakıldı.

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

**Bilinen ortam kısıtı (run 58'den beri, run 76'da GOVERNANCE.md'ye kayıtlı hale getirildi):**
bu container'ın remote'unda `git push origin <tag>` tutarlı biçimde `HTTP 403` ile reddediliyor
(branch push'ları — `git push origin main` — sorunsuz çalışıyor, sadece tag push engelli). Bu artık
her çalıştırmada yeniden keşfedilecek yeni bir bulgu değil, bilinen ve kalıcı bir kısıt: kontrol
noktası için **yerel tag + `STABLE_TAGS.md` girdisi yeterli sayılır**; `git push origin <tag>`
yine de denenir (maliyeti düşük, bir olası ileride-düzeltme'yi kaçırmamak için) ama başarısız
olması bu maddeyi engellemez/DONE'u bloklamaz — sonucu artık sürpriz sayılmıyor. Bu, proje
sahibi için düzeltilebilecek bir izin boşluğu
olabilir (bkz. `3D_GAME_PROGRESS.md` run 56/57 notları) — dilerse `QUESTIONS_FOR_OWNER.md`'ye
taşınabilir, ama bir "soru" değil salt bilgi olduğundan orada tutulmuyor.

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
  asset'lerine genişletir. **Her iki yarı da tamamlandı:** cache-tamlığı run 65'te
  (`checkServiceWorkerCache.js`, ADR-0083), kota izlemesi run 66'da (F2 panelinin
  `navigator.storage.estimate()` satırı, ADR-0084) — ikisi de kalıcı regresyon korumasıyla.
- **Periyodik Platform Kontrolü:** ~ayda bir (20-30 çalıştırmada bir) `npm audit`, PWA hâlâ
  kurulabiliyor mu, WebGL bekleneni veriyor mu kontrol edilir. **Son kontrol: run 156 (2026-08-07,
  bu çalıştırma, §8.12 kural konsolidasyonu geçişiyle birlikte — yeni ADR yok, bulgular değişmedi,
  sadece yeniden doğrulandı)** — `npm audit`: hâlâ N/A (repoda hâlâ `package.json`/npm bağımlılığı
  yok). PWA kurulabilirliği: `checkPwaInstallability.js` yeniden çalıştırıldı, hâlâ OK.
  Service-worker cache tamlığı: `checkServiceWorkerCache.js` yeniden çalıştırıldı, hâlâ OK. WebGL:
  `smokeTestGame3D.js` (34/34 PASS) bu run'ın kendi baseline'ında temiz. (Önceki kontrol: run 143,
  2026-08-07 — bu maddenin run 112'den beri güncellenmediği fark edildi ve düzeltildi; run 143'ün
  kendi kontrolü zaten yapılmıştı ama bu satıra hiç işlenmemişti, §8.12'nin kendisinin yakalaması
  gereken tam da bu tür bir "geçersiz kalmış madde" örneğiydi.) Bir sonraki kontrol ~run 176-186
  civarında.

---

## 16. Ertelenmiş Kurallar (koşullu reddedilenler — aktivasyon koşulu gerçekleşince otomatik aktif)

| Kural | Aktivasyon koşulu |
|---|---|
| Save Game Uyumluluk Kapısı | `SaveSystem` gerçekten eklenince |
| API Kararlılığı etiketleri (breaking/minor/patch) | public API/mod desteği eklenene kadar hayır |
| Tam Test Piramidi (7 katman) | mevcut smoke test yetersiz kalmaya başlarsa (sık regresyon kaçıyorsa) |
| Frame Budget alt-sistem süre ölçümü | F2 panelinin `renderer.info` istatistikleri yetersiz kalırsa (FPS düşüyor ama nedeni belirsizse) |
| Resmi 1-10 Kod Kalite Skoru | uygulanmıyor — Oturum Kalite Kapısı'nın 1-5 güven skoru yeterli kabul edildi |
| 30-commit performans trend grafiği | **✅ Ele alındı (run 110, ADR-0137):** `scripts/analyzePerfTrend.js` — `perf_log.csv` üzerinden min/max/ortalama + ilk-yarı/son-yarı `jsHeapUsedMB` sürüklenme kontrolü, düz metin tablo (bilinçli olarak grafik/PNG değil — ADR-0137'nin Alternatives bölümüne bakılır, tek npm bağımlılığı olmayan bu repo için ek karmaşıklık gerekçesiz bulundu). Aktivasyon koşulu (30+ satır, run 96'da geçildi) karşılandı ve madde kapatıldı; tabloda sadece kayıt için tutuluyor. |

---

## 17. Yol Haritası (özet — güncel durum için `3D_GAME_PROGRESS.md`'ye bakılır)

FAZ 0-1 TAMAMLANDI. FAZ 2 ~%95. FAZ 3 ~%90. FAZ 4 TAMAMLANDI. **FAZ 5: NPC diyalog 13/14 —
tasarım gereği TAMAM, eksik değil.** (Run 83'te netleştirildi: 14. NPC olan `jon-guard-1`'in
diyalog seçeneği yok çünkü ADR-0058'in "Alternatives considered" bölümünde bilinçli olarak dışarıda
bırakıldı — Gece Nöbeti nöbetçisinin kapalı/uğursuz tek satırlık selamlaması
[`'Duvar'ın ötesinde ne olduğunu bilmek istemezsin.'`] "sana şunları sorabilirsin" listesiyle
zayıflıyor. "13/14" ifadesi bir eksik iş gibi okunduğu için birçok çalıştırma aynı sahte boşluğu
tekrar tekrar keşfetti. Bu bir ürün/tasarım kararı olduğundan geri çevrilmesi §14 gereği sahibe
soruldu — bkz. `QUESTIONS_FOR_OWNER.md`. Sahip aksini söylemedikçe FAZ 5 kapalı sayılır.)
FAZ 6: **TAMAMLANDI.** kurt (asset-driven) tamam; at/köpek/kedi (run 326-329, prosedürel
`creatureBrain.js` rig+gait+wander/reactive) ve kuş (kuzgun/kartal/tavuk — run 334, ADR-0280, gerçek
climb/cruise/land uçuş davranışı) da tamam — bu üçü `assets_manifest.json`'da hiç model olmadığı için
(run 326'nın kendi bulgusu) gerçek asset yerine prosedürel gövde/rig kullanıyor, kurt gibi ayrı bir
asset-driven model değil. **araba** (at arabası/kağnı — run 336, ADR-0282, `gameplay/cartBrain.js`)
FAZ 6'nın son maddesiydi: prosedürel at+kağnı gövdesi gerçek `world/roads.js` at-arabası-yolu
kenarları boyunca gidip geliyor (ping-pong), tekerlekler dönüyor — bir canlı değil, bir taşıt
olduğu için `creatureBrain.js`'in wander/flee mantığını paylaşmıyor, kendi path-following state
machine'i var. **FAZ 7: TAMAMLANDI** (fark etme + reaktif
uçuş + dalış/swoop + gerçek sürekli kovalama — run 66/ADR-0085: ejderha kalesini terk edip
oyuncuyu 18 saniye boyunca kovalıyor, sonra vazgeçip dönüyor — **+ gerçek saldırı/hasar — run
90/ADR-0116:** sürekli kışkırtma bir ısırık lunge'ına eskale oluyor, `gameplay/health.js` +
`ui/healthBar.js` can/hasar durumunu yönetiyor, ölüm oyuncuyu spawn noktasında tam canla
yeniden başlatıyor — bu satır run 137'de düzeltildi, önceki metin run 90'dan sonra
güncellenmemişti). FAZ 8: dünya olayları büyüyor.
FAZ 9-10 başlamadı. **FAZ 11 (run 72, ADR-0095, sahibin canlı çalıştırma dışı canlı istek): Canlı
Çeşitliliği** — her canlı türü için karakteristik hareket/davranış planı `src/3d/gameplay/
creatureSpeciesConfig.js`'deki `CREATURE_SPECIES` registry'sinde veri olarak kayıtlı (15 tür: kedi,
köpek, kral, ejderha, asker, kuş, ceylan, geyik, erkek/kadın insan, köylü + önerilen at/kuzgun/koyun/
yaban domuzu). Modeller sahip tarafından ileride yüklenecek — her tür kendi modeli gelince ayrı bir
alt görev olarak (kendi ADR'si + gerçek modelle smoke test + görsel kanıtla) uygulanır; bu registry
sadece ortak referans/plan, henüz hiçbir runtime kodu import etmiyor. Detay için o dosyanın kendi
header'ına ve ADR-0095'e bakılır.

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
13. FAZ 11 canlı türleri — model yüklendikçe, tür başına tek alt görev (bkz. `creatureSpeciesConfig.js`)
14. Yeni özellik

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


---

## 23. Mobil World Coverage Büyütme Politikası (run 130)

Proje sahibinin mobil World Coverage'i yükseltme talebi kalıcı bir mühendislik hedefidir. Bu hedef
"daha fazla chunk'ı aynı anda telefona yükle" şeklinde uygulanmaz; mobil bütçeyi koruyan kademeli
**streaming + eviction + LOD/asset optimizasyonu** programı olarak yürütülür.

1. **Bounded streaming zorunlu:** mobil/coarse-pointer cihazda oyuncu ilerledikçe yeni chunk'lar
   yüklenebilir fakat aktif yarıçapın dışında kalan terrain chunk'ları GPU/RAM'den boşaltılır.
   `everGenerated` korunur; böylece kümülatif keşif/World Coverage büyürken resident bellek sınırsız
   büyümez.
2. **Kademeli radius artışı:** her radius artışı ayrı bir alt görevdir. Önce mevcut mobile bütçeler
   (`DrawCalls<500`, `Triangles<500K`, `TextureMem<512MB`, hedef 30-60 FPS), sonra coarse-pointer
   runtime testi, sonra full browser smoke kontrol edilir. Bütçe aşılırsa radius geri büyütülmez;
   önce LOD/culling/texture optimizasyonu yapılır.
3. **Run 130 başlangıç seviyesi:** mobil streaming radius 2'den 3'e çıkarılır. Kare footprint 25
   chunk'tan 49 chunk'a, 6.25 km²'den 12.25 km²'ye çıkar; 137.5 km² dünya hedefi bazında başlangıç
   footprint coverage yaklaşık %4.5'ten %8.9'a yükselir. Bu değer gerçek mobil runtime testleriyle
   doğrulanmadan daha yüksek bir oran raporlanmaz.
4. **Sonraki optimizasyon sırası:** (a) mesafe tabanlı terrain/vegetation LOD, (b) frustum ve mümkün
   olduğunda occlusion culling, (c) kale/ağaç uzak-mesafe düşük-poly veya impostor yaklaşımı,
   (d) texture atlas/sıkıştırma ve mobil texture boyutu, (e) ölçüm sonrası yeni radius artışı.
5. **Görsel kalite koruması:** LOD geçişleri belirgin pop-in üretmemeli; yeni mobil coverage alt
   görevlerinde yakın+uzak en az iki görsel kanıt ve F4/free-camera kontrolü tutulur.
6. **PWA/offline koruması:** streaming yalnız repoda/service-worker cache politikasınca erişilebilir
   asset'leri kullanır. Mobil coverage artırmak CDN/HBO asset bağımlılığı eklemek için gerekçe değildir.
7. **Deterministik dünya korunur:** chunk unload/reload aynı seed+koordinatta aynı terrain sonucunu
   üretmek zorundadır; eviction kümülatif `everGenerated` metriğini veya prosedürel checksum
   kurallarını sıfırlayamaz.
8. **Dinamik öncelik:** mobil World Coverage %98'in altındayken ve daha üst sırada blocking bug /
   performans / memory-leak problemi yokken bu program aktif iyileştirme alanlarından biridir.


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


## 25. Mobil Terrain Mesafe-LOD Kapısı (run 134)

Mobil/coarse-pointer terrain resident alanı büyütülmeden önce aktif radius içindeki geometry yükü
mesafeye göre kademelendirilir. Run 134 referans politikası: streaming merkezine Chebyshev uzaklığı
0-1 chunk olan yakın halka 64 segment/kenar ile mevcut tam terrain ayrıntısını korur; uzaklık 2 olan
orta halka 32 segment/kenar; uzaklık 3 olan dış halka 16 segment/kenar kullanır. Oyuncu chunk sınırı
geçtiğinde halkası değişen resident chunk aynı deterministik seed + flatten-pad sampler ile yeniden
üretilir ve eski geometry/material hemen dispose edilir. Böylece collider/height sampler gerçeği
değişmez, yalnız render mesh tessellation maliyeti düşer. Desktop davranışı bu LOD katmanından
etkilenmez. Her LOD değişikliği `checkMobileTerrainLod.js`, `checkMobileChunkStreaming.js`, gerçek
mobil render bütçesi kapısı (§24), 34+ browser smoke ve iki mobil görsel kanıtı birlikte geçmelidir.
Belirgin pop-in veya yakın halkada geometri kaybı görülürse sonraki radius artışı yapılmaz; önce LOD
bantları yeniden değerlendirilir. Bu optimizasyon coverage yüzdesini tek başına yükseltmez; radius
3'ün yaklaşık %8.9 resident footprint'ini daha düşük GPU/triangle maliyetiyle güvenli tutarak sonraki
radius artışı için performans marjı üretir.


## 26. Mobil Vegetation Geometry-LOD Kapısı

Mobil World Coverage büyütme programında terrain LOD'den sonraki vegetation adımı ölçümlü ve
regresyon-korumalı ilerler:

- Coarse-pointer mobil yolunda deterministik ağaç yerleşimi, tür dağılımı, instance transformları ve
  materyaller korunur; yalnız primitive geometrisinin segment sayısı düşürülebilir.
- Masaüstü vegetation geometrisi aynı kalır. Mobil optimizasyon masaüstü görsel kalitesini azaltamaz.
- Geometry değiştirildiğinde eski geometry aynı işlemde `dispose()` edilmelidir; ikinci bir tam
  geometry kopyası GPU belleğinde tutulamaz.
- `scripts/checkMobileVegetationLod.js` gerçek mobile/touch Chromium context'inde çalışmalı; mobil
  LOD'nin aktif olduğunu, instance sayılarının korunduğunu ve vegetation triangle yükünün desktop
  geometrisine göre en az %25 düştüğünü doğrulamalıdır.
- Bu kapı `scripts/checkMobilePerfBudget.js` ve `scripts/checkMobileSpawnVegetation.js` ile birlikte
  PASS olmadan vegetation optimizasyonu veya sonraki mobil radius artışı DONE sayılamaz.
- Görsel doğrulama en az iki mobil açıyla yapılır; belirgin silhouette kaybı/bozuk mesh varsa daha
  yüksek segment seviyesi seçilir.


## 27. Mobil Radius Readiness Kanıt Kapısı (run 139)

Canlı mobil streaming radius'u, `QUESTIONS_FOR_OWNER.md` / ADR-0157'deki sahip kararı çözülmeden değiştirilemez.
`scripts/checkMobileRadiusReadiness.js` mevcut radius-3 + terrain FAR=16 politikasını doğrular, gerçek mobile/touch
Chromium render örneğini alır ve radius 4'e eklenecek 32 dış-halka terrain chunk'ının tamamı aynı karede çiziliyormuş
gibi kötümser bir üst sınır hesaplar. Üst sınır DrawCalls<500 ve Triangles<500K kapılarını geçse bile bu yalnız
"ölçülebilir render bütçesi açısından hazır" sinyalidir; sahip onayının yerine geçmez. Texture-memory <512 MB ve
gerçek telefon 30-60 FPS hedefleri uygun gerçek cihaz/profiler olmadan uydurulmaz.


## 28. Mobil Radius-4 Canlı-Dünya Aktivasyon Kapısı (run 140)

Mobil World Coverage radius artışı artık iki ayrı sözleşmeyi birlikte korur:

1. **Tarihsel/generic regression sözleşmesi:** `scripts/checkMobileChunkStreaming.js`, run 130'un
   bağımsız `ChunkManager` davranışını 49 resident chunk / 12.25 km² olarak doğrulamaya devam eder.
   Bu test silinmez, gevşetilmez veya atlanmaz.
2. **Canlı oyun dünyası sözleşmesi:** gerçek `sceneManager` tarafından settlement flatten-pad setiyle
   oluşturulan ve mobil boot `loadSquare(0,0,STREAM_RADIUS_CHUNKS)` yolundan geçen manager, additive
   run-140 sarmalayıcısı ile radius 4'e yükselir: 81 resident chunk / 20.25 km² (~%14.7 resident
   footprint). Run-134 terrain LOD dış halkayı FAR=16 segmentte tutar.
3. Radius-4 DONE sayılmadan önce hem eski radius-3 regression guard hem yeni
   `scripts/checkMobileRadius4LiveWorld.js`, `scripts/checkMobilePerfBudget.js`, 34/34 browser smoke,
   additive-only guard, PWA/cache/terrain/road/checkpoint kapıları PASS olmalıdır.
4. Canlı mobil render ölçümü `<500 draw call` ve `<500K triangle` bütçelerini aşarsa radius 4
   yayınlanmaz; branch geri alınır veya sonraki optimizasyon görevine dönülür.
5. Desktop davranışı değiştirilemez. Yeni radius artışları (4→5+) ayrıca yeni readiness ölçümü,
   görsel kanıt ve ayrı ADR gerektirir; run 140 otomatik emsal sayılmaz.

Bu desen, additive-only kuralını delmeden eski regression sözleşmesini koruyup gerçek oyun manager'ı
ayrı bir opt-in/live-runtime yolu olarak büyütür. Yeni test veya runtime kodu bu ayrımı belirsizleştirirse
6 ay sonra okunabilirlik kapısı gereği refactor/ADR değerlendirmesi yapılır.

## 29. Mobil Vegetation Distance-Culling Kapısı (run 141)

Mobil/coarse-pointer sahnede vegetation diskleri yalnız oyuncunun resident terrain komşuluğuyla
kesişebilecek durumdaysa render-visible kalır. Uzak disklerin instance verisi silinmez; oyuncu geri
yaklaşınca aynı deterministik ağaçlar yeniden görünür.

- Culling eşiğinin resident-terrain kısmı sabit bir radius kopyasından hesaplanamaz; `chunkManager.js`
  içindeki `MOBILE_LIVE_WORLD_RADIUS_CHUNKS` live binding'i kullanılmalıdır. Her gelecekteki radius
  artışı bu binding'i aynı additive değişiklikte güncellemek zorundadır.
- Vegetation disk yarıçapı `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS * CHUNK_SIZE_METERS` üzerinden türetilir;
  tek serbest tuning değeri config'teki güvenlik marjıdır.
- Desktop görünürlüğü değiştirilemez. Mobil updater yalnız whole-group `visible` durumunu değiştirir;
  seed, instance matrix, geometry/material veya placement verisini mutasyona uğratamaz.
- Yeni runtime modülü service-worker 3D shell precache listesinde bulunmadan PWA cache kapısı PASS
  sayılamaz.
- `checkMobileVegetationCullingRun141.js`, mobile render budget, radius-4 live guard, vegetation LOD,
  34+ browser smoke ve iki mobil görsel kanıt birlikte PASS olmadan DONE yoktur.
- Bu optimizasyon coverage yüzdesini tek başına artırmaz; radius-4 (~%14.7 resident footprint) üzerinde
  gereksiz uzak vegetation çizimini engelleyerek sonraki coverage artışları için güvenli temel sağlar.


## 30. Fiziksel Dünya / Sanat Yönü — Owner Direktifi (run 177, 2026-08-08)

Proje sahibi fiziksel dünya görünümünü aktif ürün önceliği olarak belirledi. Aşağıdaki maddeler artık
owner kararı bekleyen fikirler değil, kalıcı sanat/dünya hedefleridir; her biri mevcut DoD, determinism,
additive-only, PWA ve mobil performans kapılarına tabidir.

1. **Ortaçağ yol ağı:** Tüm canonical krallık koltukları tek, ulaşılabilir bir yol grafiğinde bağlı
   kalmalıdır. Mevcut eğime duyarlı MST bağlantısı korunabilir/genişletilebilir; amaç her koltuk çifti
   arasında doğrudan yol çizmek değil, bütün krallıkların gerçekçi bir ağ üzerinden birbirine
   ulaşabilmesidir. Yol görünümü modern/asfalt değil; toprak, teker izi, aşınma, yerel taş/çamur
   varyasyonu ve araziye oturan Game-of-Thrones-esintili ortaçağ karakteri taşımalıdır. Topoloji,
   maksimum eğim ve nehir/dağ güvenliği mevcut road safety guard'larını geçmeye devam eder.
2. **Çimen ve rüzgâr:** Açık arazide deterministik çimen/ot katmanı oluşturulur. Rüzgâr etkisi doğal,
   sürekli ve GPU-dostu salınım olarak uygulanır; yol, su, kale/yerleşim ve uygunsuz dik yüzeylerde
   çimen spawn edilmez. Mobilde LOD/culling/yoğunluk bütçesi zorunludur; masaüstü kalite korunur.
3. **Taş, kaya ve dağ zenginliği:** Araziye küçük taşlardan büyük kaya kümelerine ve belirgin dağ
   kütlelerine kadar ölçekli fiziksel detay eklenir. Makro relief değişiklikleri §8.4 Arazi Değişikliği
   Güvenlik Kontrolü'ne tabidir; 14 koltuk, yollar, su ve deterministik height sampler bozulamaz.
4. **Büyük mağaralar:** Tepeler/dağlarda büyük, okunabilir mağara girişleri ve mağara habitatları
   bulunacaktır. Yerleşimler deterministik olmalı; girişler erişilebilir araziye oturmalı ve gelecek
   vahşi ejderha habitatı için metadata/anchor sağlayabilmelidir. İç mekân kapsamı ayrı alt görevdir.
5. **Vahşi ejderha habitatı:** Vahşi ejderhalar dağ/mağara habitatlarıyla ilişkilendirilecektir.
   Habitat yerleşimi ile mevcut ejderha saldırı/kovalama AI'sı ayrı sorumluluklardır; AI kalibrasyonu
   yalnız kendi alt görevinde ve mevcut gameplay guard'larıyla değiştirilir.
6. **Dragonstone büyük mağarası:** Canonical Dragonstone yerleşiminin altında/içinde özel, büyük bir
   ejderha mağarası hedeflenir ve eğitimli ejderhaların ana habitatı olarak tasarlanır. Repo içindeki
   canonical Dragonstone kimliği/koordinatı mevcut settlement verisinden doğrulanmadan tahmin edilmez;
   doğrulandıktan sonra özel landmark/habitat olarak uygulanır.
7. **Eğitimli/vahşi ayrımı:** Eğitimli ejderha anchor'ları ile vahşi habitat spawn noktaları veri
   seviyesinde ayrıdır; biri diğerinin davranışını veya spawn politikasını sessizce devralamaz.
8. **Uygulama sırası:** güvenli varsayılan sıra ortaçağ yol görünümü → çimen+rüzgâr → kaya/dağ →
   mağara girişleri → vahşi ejderha habitatı → Dragonstone büyük mağarası/eğitimli ejderhalardır.
   Her adım ayrı ölçüm, ADR ve pre/post smoke ile yayınlanır; tek dev commit halinde topluca yapılmaz.

## 31. Canonical 2D → 3D Harita Referansı — Owner Direktifi (run 179, 2026-08-08)

Proje sahibinin 2026-08-08'de paylaştığı 1536x1024 dünya haritası, 3D dünyanın **canonical makro-coğrafya referansıdır**. Bundan sonraki fiziksel dünya çalışmaları rastgele Westeros-benzeri bir arazi üretmek yerine bu haritanın kara/deniz dağılımını, ana kıyı karakterini, dağ zincirlerini, kar-soğuk bölgeleri, bataklıkları, bozkırları, orman/jungle alanlarını, çölleri ve büyük yol yönelimlerini kademeli olarak 3D dünyaya taşır.

1. Harita yönü normalize görüntü uzayında x=batı→doğu, y=kuzey→güney olarak sabittir; kalıcı kontrol noktaları `worldReferenceMap.js` ve ondan türetilen versioned veri modüllerinde tutulur.
2. Mevcut canonical kingdom-seat koordinatları sessizce taşınamaz. Harita-görseli ile mevcut 2D marker/world koordinat sistemi arasında runtime dönüşümü uygulanmadan önce hizalama doğrulanmalı; doğrudan [0,1] world-extent eşlemesi varsayılmamalıdır.
3. Arazi yüksekliği/kıyı runtime'ına geçen her adım §8.4 terrain-seat safety + road safety + deterministic snapshot + browser smoke + console + mobile perf + PWA/cache kapılarını geçer. Bir koltuğu su altına sokan veya mevcut yol erişilebilirliğini bozan makro-coğrafya değişikliği yayınlanmaz.
4. Canonical haritanın kendisi runtime'da OCR/renk sınıflandırmasına tabi tutulmaz. Görselden çıkarılan maskeler/anchor'lar repoda deterministik, checksum'lı, gözden geçirilebilir veri olarak saklanır.
5. Uygulama katmanları ayrı yayımlanır: referans sözleşmesi → kıyı/su maskesi → koordinat hizalama → makro relief/dağ → biyom materyalleri → nehir/yol uyarlaması → yerel fiziksel detay. Tek dev terrain rewrite yasaktır.


## 32. Canonical Yol/Su Taş Kemer Köprü Politikası — Owner Direktifi (run 191, 2026-08-08)

Proje sahibi Run188/ADR-0208 yol-su kararını doğrudan çözdü: **bir yol dere, göl veya canonical su yüzeyini kesiyorsa yol suyun içinden yürütülmez; kesişime ortaçağa uygun taş kemer köprü yapılır.** Bu karar gelecekteki canonical road/water çalışmalarında kalıcı ürün politikasıdır.

1. **Policy = bridge:** Ferry, su içinden yol ve otomatik dry-reroute varsayılanı kullanılmaz. Su kesişimi varsa yol bağlantısı taş kemer köprü ile korunur.
2. **Ortaçağ sanat dili:** Köprü yüzeyi modern beton/asfalt değil; yaşlanmış taş blok örgü, belirgin harç derzleri, hafif renk/aşınma varyasyonu ve taş parapet/korkuluk taşır. Dış HBO asseti kullanılmaz; original/procedural veya uygun lisanslı generic materyal kullanılır.
3. **Açıklığa göre çoklu kemer:** Uzun su geçişleri tek fiziksel olarak anlamsız dev kemer yapılmaz. Aynı deterministic bridge segmenti içinde açıklık bütçesine göre birden çok masonry arch/pier üretilir; yol genişliği mevcut ana cart-road genişliğiyle uyumlu kalır.
4. **Determinism + güvenlik:** Bridge anchor/crossing listesi canonical hydrology + road route girdilerinden deterministik üretilir. Yol connectivity, <=20° live cart-road güvenliği, settlement protection, hydrology, PWA ve mobile perf kapıları korunmadan canlı adoption yapılmaz.
5. **Kademeli yayın:** Run191 gerçek THREE geometry/materialı shadow-only kanıtlar. Live terrain/road scene adoption ayrı bir alt görevdir; önce bridge fixture, iki görsel açı, renderer budget, dispose ve pre/post smoke PASS olmalıdır.


## 33. "Tam Anlamıyla Bir Oyun" — Owner Direktifi (2026-08-13)

**Durum: AKTİF, KALICI, HER ÇALIŞTIRMADA GEÇERLİ.** Proje sahibinin 2026-08-13 tarihli doğrudan
talimatı: *"Senden tam anlamıyla bir oyun yapmanı istiyorum. Bunu kurallara ekle ve her rutininde
senden tam anlamıyla bir oyun istediğimi düşünerek aksiyonlar al."*

### 33.1 Her çalıştırmanın ölçütü

Bir alt görev seçilirken tek soru şudur: **"Bu, projeyi oynanabilir bir oyuna yaklaştırıyor mu?"**
Teknik olarak doğru ama oyuncunun asla fark etmeyeceği işler (shadow/adapter katmanları, yalnızca
önizleme yolunda kalan görsel katmanlar, yalnızca doğrulama üreten çalıştırmalar) artık **varsayılan
öncelik değildir**. Bunlar ancak gerçek bir oyun özelliğini bloke ediyorlarsa öne alınır.

Bir çalıştırma sonunda "oyuncu ne fark etti?" sorusuna somut bir cevap yazılamıyorsa, o çalıştırma
öncelik seçimini yanlış yapmış sayılır — `3D_GAME_PROGRESS.md`'deki World Evolution Report'un
"oyuncu fark eder mi" satırı bu direktifin denetim noktasıdır.

### 33.2 Oyun neyi gerektirir (eksik olanlar açık iş listesidir)

"Tam anlamıyla oyun" bu projede en az şunları gerektirir; her biri kendi alt görev zincirini hak
eden gerçek boşluklardır ve hiçbiri "gelecekte bir gün" kategorisinde değildir:

1. **Amaç/ilerleme:** görev (quest) sistemi, hedefler, tamamlama koşulu. Bugün yok.
2. **Kayıt/yükleme:** `SaveSystem` — bugün yok (§16'daki Save Game Uyumluluk Kapısı bu yüzden hâlâ pasif).
3. **Etkileşim derinliği:** envanter, eşya, ekonomi/takas. Bugün yok.
4. **Çatışma:** oyuncunun kendi saldırısı — bugün yalnız ejderha oyuncuya hasar veriyor, tersi yok.
5. **Dolu dünya:** yerleşim = yalnız kale değil; ev, ahır, çit, yol kenarı yapıları, kalabalık.
6. **Ses:** müzik ve efekt. `assets/audio/` bugün fiilen boş.
7. **Menü/akış:** başlangıç, duraklat, ayarlar, ölüm/yeniden başlama akışı.

Bu liste `3D_GAME_PROGRESS.md`'nin FAZ tablosunun yerine geçmez, onun üstünde bir **ürün** ölçütüdür:
FAZ'lar teknik olarak tamamlansa bile yukarıdakiler yoksa proje "oyun" sayılmaz.

### 33.3 Asset kullanımı — karantina kaldırıldı

Aynı talimatla proje sahibi şunu da açıkça söyledi: *"Assets klasöründeki her şeyi kullanmanı
istiyorum. Hiçbir şeyi karantinaya alma."* ve *"Lisansı olmasa bile 3d haritaya yerleştir."*

Buna göre:

- `assets/` altındaki **her dosya runtime kullanımı için sahip tarafından onaylanmıştır**. Bir
  asset'i "provenance belirsiz" gerekçesiyle kullanım dışı bırakmak (karantina) artık yapılmaz;
  `assets_manifest.quarantine.json` bu direktifle feshedilmiştir.
- Lisans/atıf **kayıt tutma** yükümlülüğü kalkmadı: `CREDITS.md` ve `assets_manifest.json` bilinen
  kaynak/lisans bilgisini kaydetmeye devam eder, bilinmeyen için `license: "UNKNOWN — owner-approved
  for runtime use (§33.3)"` yazılır. Kayıt tutmak kullanımı engellemez.
- **Tek kalıcı kısıt değişmedi:** gerçek HBO görsel/ses materyali indirilmez. Bu, sahibin kendi
  koyduğu tek sınırdır ve bu direktif onu kaldırmaz.
- Dürüst risk notu (kural değil, bilgi): repository 2026-08-10'da public yapıldı. Kaynağı belirsiz
  bir asset'i public bir repoda dağıtmak, private bir repoda kullanmaktan farklı bir hukuki
  maruziyettir. Sahip bunu bilerek karar verdi; ajan bu kararı tekrar tekrar sorgulamaz, yalnız bu
  satırı kayıt olarak korur.

### 33.4 Öncelik sırasına etkisi

§18'deki öncelik sırası korunur, ancak eşit güvenlikteki iki alt görev arasında seçim yapılırken
**oyuncuya görünen/oynanabilirliği artıran olan kazanır**. §33.2'deki yedi maddeden herhangi biri,
"yeni özellik" (§18 madde 10) kategorisinde değil, kendi başına birinci sınıf iş olarak ele alınır.

### Run199 platform-control superseding note (2026-08-08 23:29 UTC)
GOVERNANCE §15'teki eski “Son kontrol: run 156” metni tarihsel kayıt olarak korunur; en yeni periyodik platform kontrolü **run 199 (2026-08-09)**'dur. package.json/npm bağımlılığı hâlâ yok (npm audit N/A); PWA installability, service-worker cache completeness, Chromium/WebGL 3D boot, console cleanliness, mobile streaming/LOD/perf ve perf trend kontrolleri yeniden PASS oldu. Bir sonraki periyodik platform kontrolü yaklaşık run 219-229 civarında yapılmalıdır. Bu not additive-only kuralı nedeniyle eski satırı silmeden/değiştirmeden onu supersede eder.

### Run235 platform-control superseding note (2026-08-11)
The latest periodic platform control is now **run 235 (2026-08-11)**, superseding the historical run199 maintenance note without deleting it. `package.json` remains absent, so `npm audit` remains N/A. PWA installability and service-worker cache completeness PASS; mobile Chromium render sampling remains inside budget at 35 draw calls / 195929 triangles / 30 geometries / 22 textures; seeded-random, canonical world-reference/water/alignment/hydrology, 14/14 terrain-seat safety and the 14-seat road network all PASS; performance-trend analysis reports no sustained heap drift; technical-debt guard and full 2D-offline + 3D-WebGL browser smoke PASS. The initial Run235 proof exposed only a missing Playwright prerequisite in the verification harness; the clean publication includes the corrected harness only. The next periodic platform-control window is approximately **run 255-265**, unless a phase completion or material platform change justifies an earlier check.

### Run291 platform-control + rule-consolidation superseding note (2026-08-12)
The latest periodic platform control is now **run 291 (2026-08-12)**, superseding the historical run235 maintenance note without deleting it (§8.12's own window — run235's next target was ~255-265 — was overdue by the time this run started, so this check-in also folds in the §8.12 Kural Seti Bakımı consolidation pass; see `RULES_CHANGELOG.md`). `package.json` remains absent, so `npm audit` remains N/A (`npm audit` itself confirms `ENOLOCK`/no lockfile, same as every prior check). PWA installability (`checkPwaInstallability.js`) and service-worker cache completeness (`checkServiceWorkerCache.js`) PASS. All 34/34 `smokeTestGame3D.js` checks PASS (2D offline shell + 3D WebGL boot, zero uncaught page errors, zero console errors beyond the known blocked-CDN/gitignored-media soft warnings). `checkMobilePerfBudget.js` PASS on a real mobile/coarse-pointer Chromium context: 35 draw calls / 195929 triangles / 30 geometries / 22 textures, inside the `<500` / `<500K` budgets (texture-memory bytes remain unmeasurable from `renderer.info` alone, same known gap as every prior run). Canonical world-reference/water-mask/alignment/hydrology checks, 14/14 terrain-seat safety, the 14-seat road network, `checkWorldEventDeterminism.js` and `checkTechnicalDebt.js` all PASS. `analyzePerfTrend.js` reports no sustained `jsHeapUsedMB` drift (first-half avg 316.0MB vs second-half avg 333.0MB, ratio 1.05x — within run-to-run noise). `checkAdditiveOnlyDiff.js` PASS against `origin/main...HEAD`. This session also found the local container checkout's `main` had drifted from `origin/main` (a stale pre-Run283 local ref, superseded by 110 newer commits already on `origin/main` through Run290); per §8.14 it was resynchronized to `origin/main` before any work started, discarding no pushed work. Rule-consolidation review (§8.12): re-read every numbered section; no stale or internally-conflicting rule found. §16's deferred-rule activation conditions remain unmet (`SaveSystem` still does not exist — confirmed via `grep -rn SaveSystem src/`; no public API/mod support added). The next periodic platform-control **and** rule-consolidation window is approximately **run 311-321**, unless a phase completion or material platform change justifies an earlier check.

### Run321 platform-control + rule-consolidation superseding note (2026-08-12)
The latest periodic platform control is now **run 321 (2026-08-12)**, superseding the historical run291 maintenance note without deleting it — run291's own window (~311-321) was due; concurrency was clean (`git fetch origin main` matched `HEAD` exactly, `405b8fa`, no drift, no resync needed). `package.json` remains absent, so `npm audit` remains N/A (`ENOLOCK`, same as every prior check). Full sweep re-run fresh, not restated from memory: `smokeTestGame3D.js` **34/34 PASS** (zero uncaught page/console errors beyond the known blocked-CDN/gitignored-media soft warnings); `checkPwaInstallability.js`/`checkServiceWorkerCache.js` (165 JS files) PASS; `checkWorldReferenceMap.js`/`checkWorldReferenceAlignment.js`/`checkWorldReferenceHydrologyExtent.js`/`checkWorldReferenceWaterMask.js` PASS; `checkWorldEventDeterminism.js` PASS (24-emission checksum match); `checkMobilePerfBudget.js` PASS (35 draw calls / 195929 triangles / 30 geometries / 25 textures, inside `<500`/`<500K`); `terrainSeatSafetyCheck.js` PASS 14/14; `roadNetworkSafetyCheck.js` PASS (mountain-avoidance + river non-collision, 20.24km network); `checkTechnicalDebt.js` PASS (0 new debt); `checkSmokeCheckRegistry.js` OK (same 2 pre-existing WARNs, neither touched this run: `game3d.js` 547/600, `worldReferenceSceneShadowAdapter.js` 562/600); `analyzePerfTrend.js` — 220 rows, no sustained `jsHeapUsedMB` drift (first-half avg 317.3MB vs second-half avg 332.8MB, ratio 1.05x). `perf_log.csv` gained one real sample (`run321-platform-control`). Rule-consolidation review (§8.12): every numbered section re-read; no stale or internally-conflicting rule found. §16's deferred-rule activation conditions remain unmet (`SaveSystem` still absent; no public API/mod support). No code/gameplay/world delta this run — pure verification + governance bookkeeping. The next periodic platform-control **and** rule-consolidation window is approximately **run 341-351**, unless a phase completion or material platform change justifies an earlier check.
