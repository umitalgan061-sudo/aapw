# GOVERNANCE.md — Westeros 3D RPG kalıcı yönetişim kuralları

Bu dosya, saatlik/günlük çalışan otonom geliştirme rutininin (RemoteTrigger,
"Westeros 3D RPG - Günlük Geliştirme") her çalıştırmasında **Session Snapshot**
adımında okuması gereken kalıcı kural setidir. Buradaki kurallar, ayrı ayrı her
seferinde talimat mesajına tekrar yazılmak yerine burada birikir — proje
sahibi yeni bir kural eklemek istediğinde bu dosyayı günceller, sadece kısa bir
not gönderir.

Not: Bu dosya proje sahibinin (Claude Code oturumu üzerinden) elle oluşturduğu
bir ilk sürümdür — eğer rutin kendi çalıştırmasında da bu dosyayı oluşturduysa
(ayrı bir dalda/commit'te), iki sürüm arasında bir merge/çakışma çözümü
gerekebilir; çakışırsa içerikleri birleştir, hiçbirini sessizce at.

## 1. Definition of Done (ZORUNLU)

Bir alt görev aşağıdaki checklist'in HEPSİ işaretlenmeden DONE sayılamaz ve commit atılamaz:
- ☐ `node --check` geçti (dokunulan tüm dosyalar)
- ☐ Smoke test suite geçti (regresyon yok)
- ☐ Görsel iddia varsa Görsel Doğrulama Standardı'na uygun kanıt var
- ☐ Performans gerilemedi (FPS/draw call/texture mem bütçesi kontrol edildi)
- ☐ Teknik borç fark edilir şekilde artmadı (arttıysa açıkça not düşüldü)
- ☐ `3D_GAME_PROGRESS.md` güncellendi
- ☐ Gerekiyorsa ADR yazıldı (Risk Seviyesi etiketiyle, bkz. §7)
- ☐ Commit atıldı (Conventional Commit, doğrudan main push)
- ☐ Tarayıcı konsolunda yakalanmamış hata/uyarı yok

## 2. Root Cause Analysis

Aynı hata/bug daha önce en az bir kez görülmüşse (git log/DECISIONS.md/PROGRESS.md'de
kontrol et) — doğrudan düzeltme yazma. Önce yaz: (1) Root Cause — gerçekte neden
tekrar oldu, (2) Prevention — yapısal önlem, (3) Regression Test — bunu bir daha
yakalayacak somut bir smoke test. Sonra kodu yaz. Tek seferlik/yeni hatalarda bu
ağır süreç gerekmez.

## 3. AI Self-Review: 2. Geçiş

Commit atmadan hemen önce, yazılan kodu İKİNCİ kez, kıdemli bir motor/oyun
programcısı gözüyle eleştirel oku: mantık hatası, kenar durum, performans
tuzağı, isimlendirme, gereksiz karmaşıklık ara. Ciddi bir sorun bulunursa
commit'i atma, önce düzelt.

## 4. Değişiklik Etki Analizi (ZORUNLU — arazi/yükseklik/noise/dünya ölçeği değişikliklerinde)

Önce: (1) etkilenen sistemleri listele (nehir, göl, yol, kale, bitki, renk,
collision, chunk streaming...), (2) her biri için risk yaz (Yüksek/Orta/Düşük),
(3) Risk Yüksek olanlar için koruma kodu ya da ADR'de "bilinen risk" notu,
(4) değişiklikten sonra etkilenen sistemlerin smoke testini tekrar çalıştır.
Ayrıca sor: "Bu değişiklik henüz başlamamış/tamamlanmamış fazları nasıl
etkiler?" (Gelecek Faz Etkisi).

### 4a. Arazi Değişikliği Güvenlik Kontrolü
`sampleHeightMeters` değişikliğinden ÖNCE ve SONRA otomatik kontrol: 14 krallık
koltuğunun hiçbiri su altında değil, hiçbiri gidilemez eğimde değil, yol
bağlantıları geçerli.

## 5. Görsel Doğrulama Standardı

Görsel iddia içeren her alt görevde: en az 2 farklı kamera açısı/yükseklik, F4
serbest kamera ile hem uzaktan hem yakından kanıt, mümkünse önce/sonra
karşılaştırması. Kanıt yetersizse DONE sayılmaz, "kanıt zayıf" notu düşülür.

## 6. Oturum Kalite Kapısı ve Süre Sınırları

- Aynı çalıştırmada 3. alt görevden sonra: self-review güven skoru (1-5) <4
  ise dur; "6 ay sonra hâlâ net mi" tereddüdü varsa dur.
- Aynı dosyada/alt sistemde 90dk+ takılırsan bırak, geri dön, sıradakine geç.
- Tek bir çalıştırma (zincirleme dahil) ~6-8 saati ya da makul bir alt görev
  sayısını aşmasın; aşarsa kalite kapısı geçse bile çalıştırmayı sonlandır.

## 7. ADR Kuralları

Her yeni ADR şunları içermeli: Karar / Neden / Alternatifler (en az 1-2) /
Sonuç-trade-off / Etkilenen sistemler / Geri alma planı. Risk etiketi ekle:
LOW / MEDIUM / HIGH / IRREVERSIBLE (örn. terrain/height sampler → HIGH; texture
rengi → LOW; dünya ölçeği/koordinat sistemi → IRREVERSIBLE).

## 8. "Geçici Çözüm Yok" Kuralı

Kodda `TEMP`/`HACK`/`FIXME`/`WORKAROUND` yorumu bırakma. Gerekiyorsa ADR aç,
nedenini ve kaldırılacağı fazı/koşulu yaz.

## 9. Prosedürel Regresyon Kontrolü

Sabit seed+koordinat için beklenen değerler bir JSON fixture'da saklanır
(örn. `scripts/proceduralRegressionFixture.json`). Prosedürel üreteçleri
(arazi/yol/bitki) büyük ölçüde değiştiren her alt görevden sonra fixture
kontrol edilir; sapma varsa düzeltilir ya da ADR'de "bilinçli breaking change"
olarak kaydedilir. Ek olarak: sabit-seed çıktısının checksum'ı saklanabilir
(Deterministik Regresyon Snapshot).

## 10. Dünya Tutarlılık Kuralları (Yol + Arazi)

- Ana yollar (at arabası) eğime duyarlı, düşük eğimli koridorları tercih
  etsin — düz çizgi değil.
- Patikalar daha serbest/organik olabilir.
- Yol, dağın dik yamacından düz geçmesin — dolansın ya da makul eğimle tırmansın.
- Nehir dağın içinden delip geçmiyor olsun (kaynak noktası dağ boşluklarına
  göre kaydırılır ya da risk ADR'ye yazılır).
- Kale yerleşimleri yol ağına mantıklı şekilde bağlansın.

## 11. Kararlı Kontrol Noktaları

Her çalıştırma sonunda Oturum Kalite Kapısı geçti + oyun sorunsuz açılıyorsa:
`git tag stable-YYYY-MM-DD-HHmm` at, `STABLE_TAGS.md`'ye tek satır not düş.

## 12. Kural Seti Bakımı

Her ~20 çalıştırmada bir (veya bir FAZ tamamlanınca): kısa bir "kural
konsolidasyonu" alt görevi çalıştır — geçersiz/çelişen `GOVERNANCE.md`
maddelerini işaretle/güncelle, `RULES_CHANGELOG.md`'ye tek satır not düş.

## 13. Hata Sınırı / Güvenli Mod

Ana alt sistemler (ejderha AI, hayvan AI, diyalog, dünya olayları) try/catch
ile sarılsın; biri patlarsa tüm oyun çökmesin, sadece o alt sistem loglanıp
devre dışı kalsın. Yeni yazılan/dokunulan alt sistemlerde uygula, mevcutları
zorla geriye dönük sarma — fırsat çıktıkça ekle.

## 14. Asset / Lisans Kuralları

- Yeni asset öncesi lisans + hafif kalite notu (poly count, texture
  çözünürlüğü, LOD, PBR) manifest'e yazılır.
- **CREDITS.md / Atıf Defteri:** CC-BY lisanslı her asset için yazar/kaynak/
  lisans metni `CREDITS.md`'ye eklenir (private repo olması atıf
  yükümlülüğünü kaldırmıyor).
- `assets_manifest.json`'a her asset için indirilen URL+tarih eklenir (biliniyorsa).
- **Boyut/format kapısı (YENİ — 2026-07-31 eklendi):** 2026-07-31'de
  Downloads klasörüne, oyunla ilgisiz veya aşırı büyük yüzlerce dosya
  (bazıları 100MB-1.2GB, `.rar`/`.7z`/`.blend`/`.max`/`.obj` gibi
  onaylanmamış formatlarda, çoğu birden fazla kez indirilmiş kopya) birikti.
  Bundan sonra: (1) Ham/sıkıştırılmamış tek bir 3D model dosyası 30MB'ı
  geçiyorsa, decimate/optimize etmeden manifest'e ekleme — önce
  `gltf-transform` ile küçült (bkz. dragon decimation ADR'leri, aynı teknik).
  (2) `.blend`/`.max`/`.rar`/`.7z`/`.obj` gibi onaylı olmayan formatları
  DOĞRUDAN kullanma — önce GLTF/GLB/FBX'e dönüştür ya da atla. (3) Tema ile
  açıkça ilgisiz görünen (rastgele isimli texture'lar, başka bir projeye ait
  gibi duran dosyalar — örn. "hasan_specmap", "skincolorr") dosyaları
  sorgusuzca içe aktarma, önce proje sahibine sor. (4) Gerçek, isimli
  tarihi/coğrafi yapıların (örn. belirli bir gerçek kale/şehir) fotogrametri
  taramaları farklı bir lisans rejimine tabi olabilir — CC0/CC-BY
  doğrulanmadan içe aktarma.

## 15. Yeni Yerleşim Gerçekçiliği (sadece gelecekteki yeni yerleşimler)

Mevcut 14 krallık koltuğu için retroaktif değil. Yeni bir yerleşim/kale/kamp
eklerken: su kaynağına mantıklı uzaklık, yol ağına bağlanabilirlik, uygun
rakım kontrolü.

## 16. Raporlama

- **World Evolution Report:** her çalıştırma sonunda delta tablo (yol km,
  orman km², kale/NPC/event/hayvan sayısı, coverage%, toplam asset/diyalog/ADR
  sayısı) + "oyuncu fark eder mi" notu.
- **Hafif Teknik Borç Sayacı:** her özette tek bir tam sayı.
- **Hafif Performans Günlüğü:** her çalıştırma sonunda FPS/drawcall/triangle/
  mem değerlerini tek satır olarak `perf_log.csv`'ye ekle.
- **İnsan Yakalama Özeti:** her 10 çalıştırmada bir, `CATCH_UP.md`'ye 5-10
  cümlelik jargonsuz "oyunda yeni ne var" özeti (en yeni en üstte).

## 17. Karar Eskalasyonu

`QUESTIONS_FOR_OWNER.md`: bir tasarım/ürün kararı (API değil) belirsizse
tahmin etme — bu dosyaya tek satırlık soru + geçici/varsayılan seçim ekle,
sıradaki alt göreve geç.

## 18. Dil ve Platform

- Oyun-içi metin dili: TÜRKÇE (kod/yorum dili İngilizce kalabilir, karışmasın).
- PWA Cache Versiyonlama: 3D mod asset sayısı büyüdükçe service worker
  cache-invalidation (versiyon numarası, eski cache temizliği) tanımlansın.
- Periyodik Platform Kontrolü: ~ayda bir `npm audit`, PWA kurulabilirlik,
  WebGL kontrolü.

## 19. Dinamik Öncelik Ayarı

Her çalıştırma başında: World Coverage <%98 → coverage önceliği artar; draw
call/texture memory %90+ yaklaştıysa → performans önceliği en üste çıkar;
teknik borç 3 çalıştırmada arttıysa → borç azaltma zorunlu; yeni görsel
şikayet geldiyse → o görev otomatik en üste çıkar.

## 20. Ertelenmiş Kurallar (koşullu red — kalıcı red DEĞİL)

- **Save Game Uyumluluk Kapısı** → SaveSystem gerçekten eklenince otomatik aktif.
- **API Kararlılığı etiketleri** (breaking/minor/patch) → public API/mod desteği eklenene kadar hayır.
- **Tam Test Piramidi** (7 katman) → mevcut smoke test yetersiz kalmaya başlarsa devreye al.
- **Frame Budget alt-sistem süre ölçümü** → F2 panelinin renderer.info istatistikleri yetersiz kalırsa ayrı görev olarak ele al.
- **Resmi 1-10 Kod Kalite Skoru** → uygulanmıyor, Oturum Kalite Kapısı'nın 1-5 güven skoru yeterli.
- **30-commit performans trend grafiği** → `perf_log.csv` yeterince veri biriktirdikten sonra (30+ satır) düşünülebilir.

## 21. Zemin Çim Kullanımı (YENİ — 2026-07-31, proje sahibinin doğrudan isteği)

**Asset hazır:** `veg_realistic_grass_ground_cover`
(`assets/models/vegetation/grass_ground_cover.fbx`, ~9.5MB, Autodesk FBX
formatı, `FBXLoader` zaten projede kurulu). Proje sahibi bu gerçek çim
modelinin zeminde kullanılmasını özellikle istedi.

**İSTENEN ÇÖZÜM:**
1. `world/terrain.js`'in mevcut prosedürel vertex-color çim rengini (LOW_COLOR,
   az önce düzeltilen clamp/canlı-yeşil işiyle) DEĞİŞTİRME — bu, zeminin temel
   rengi/malzemesi olarak kalmaya devam etsin (performans/tutarlılık için).
2. Bunun yerine, bu gerçek `Grass.fbx` modelini **ayrı bir vegetation/ground-cover
   katmanı** olarak ekle: düşük-orta yükseklikteki (yani "çim" rengi baskın
   olan, `HIGH_COLOR`/kaya rengi baskın OLMAYAN) terrain bölgelerine, seeded/
   deterministik bir dağılımla, `InstancedMesh` ile serpiştir (HEDEF MİMARİ'nin
   zaten öngördüğü "world/Vegetation" sistemi — DÜNYA/TERRAIN kuralının
   "Bitki InstancedMesh" maddesiyle birebir örtüşüyor, bu ilk gerçek örneği
   olacak).
3. Yoğunluk/draw-call bütçesine dikkat et (Desktop DrawCalls<2500,
   Mobil<500) — çim, tek bir `InstancedMesh` ile binlerce instance'ı tek
   draw call'da render etmeli, chunk streaming ile birlikte çalışmalı (sadece
   yakın chunk'larda render, uzak chunk'larda yoğunluk azalt/kapat — mobil
   performans bütçesini zorlamasın).
4. Bu görev, Değişiklik Etki Analizi'ne tabi değil (mevcut terrain rengini/
   yüksekliğini değiştirmiyor, sadece üzerine yeni bir katman ekliyor) ama
   Görsel Doğrulama Standardı'na tabi — F4 kamerasıyla hem yakından (tekil çim
   kümeleri görünür) hem uzaktan (performans/yoğunluk makul) kanıtla.
5. `DECISIONS.md`'ye bir ADR ekle (Risk: LOW — yeni, izole bir görsel katman,
   mevcut sistemleri değiştirmiyor).

**Öncelik:** Bu görev, mevcut öncelik sırasındaki diğer görsel/arazi
görevleriyle (makro-relyef, yol ağı, kale dokulandırma) AYNI seviyede —
proje sahibi doğrudan istedi, sıradaki ilk uygun alt görev olarak ele alınmalı.

## 22. 2026-07-31 Downloads Taraması — Kısıtlı Kabul (iki geçiş)

Proje sahibi 31 Temmuz'da Downloads klasörüne çok büyük bir hacimde (200+
dosya, bazıları 1GB'a yakın) çeşitli 3D asset indirdi. İki ayrı geçişte
işlendi:

**1. geçiş:** 116 adet küçük/orta boyutlu Sketchfab asset'i (hayvan/bitki/
yerleşim/karakter/prop, `.glb`) + gerçek çim modeli (§21, `Grass.fbx`).

**2. geçiş — `.obj`/`.rar`/`.7z` dönüştürme:** Sistemde bulunan `7z.exe`
(ArcGIS Pro ile gelen) ve `WinRAR/UnRAR.exe` ile arşivler açılıp içerikleri
tek tek kontrol edildi; `npx obj2gltf` ile OBJ→GLB dönüştürüldü. Sonuç:
- **36 yeni asset eklendi:** 7 tekil OBJ dosyası (settlements/props/animals/
  vegetation), AncientGreekCity [GameReadyPack] arşivinden 27 mimari/heykel/
  çiçek OBJ'i (SADECE geometri — pakette orijinal 16-67MB'lık ham texture'lar
  bilinçli olarak alınmadı, `castle_*` modellerindeki gibi prosedürel malzeme
  bekliyor), Sword_FBX.rar'dan hazır bir FBX+texture, Medieval_House_Asset_
  Pack_All_Files.7z'den paketin hazır FBX varyantı (pakette ayrıca çok daha
  büyük bir .blend ve bir .obj varyantı da vardı, sadece FBX alındı).
- **`SUPER_TERRAIN_obj.rar` bilinçli olarak DIŞLANDI** — format uygun (OBJ)
  olsa da, statik/baked bir terrain mesh'i projenin prosedürel arazi
  mimarisiyle (`world/terrain.js`, seeded noise, tek gerçek kaynak
  `sampleHeightMeters`) doğrudan çelişiyor; format değil, mimari uyumsuzluk
  sebebiyle atlandı.
- **`.blend` / `.max` dosyaları dönüştürülemedi** — bu makinede ne Blender ne
  3ds Max kurulu, headless/CLI-only güvenilir bir alternatif yok. Etkilenen:
  12 tekil `.blend` dosyası (BodyMaleTemplate, Buffalo, CoastScan,
  FreeAllBLEND, Mongoose, bridge1, castle, female_blender_5.0, low_poly_lion,
  pine_realistic, riggedcat, son), `CHARACTER.max`, ve ~30 arşiv (çoğu
  "...BLENDER.rar" adında, içeriği sadece `.blend` olduğu spot-check'lerle
  doğrulandı — `Blender_File.rar`, `Viking_Sword_Blend.rar`,
  `MedievalPackSTY.rar`, `Medieval_Market_Asset_Pack.7z`,
  `Ancient_Assets_Pack.7z`, `Ancient_Columns_Blend.7z`,
  `MY_REALISTIC_GRASS_ASSISSTANCE.rar` dahil). `Wolf3.1.rar` sadece doku+Maya
  rig dosyası içeriyordu, örgü/mesh yoktu — atlandı. `textures.rar` tek bir
  ilgisiz doku içeriyordu — atlandı. `Solar_System_Asset_Pack.7z` temaya
  tamamen yabancı (güneş sistemi) — kontrol edilmeden atlandı. Kasıtlı ikinci
  kopyalar (proje sahibinin kendisinin belirttiği yanlışlıkla 2. indirmeler:
  `AncientHouseV5BLENDER (1).rar`, `Ancient_Assets_Pack (1).7z`,
  `Free_templeBLENDER (1).rar`, `Free_tower22BLENDER (1)/(2).rar`,
  `terrain_obj (1).zip`) hiç dokunulmadı.
- Bu blocked listedeki içerik Blender kurulursa (veya proje sahibi başka bir
  yolla .blend/.max dosyalarını GLTF/FBX'e export ederse) ileride tekrar
  değerlendirilebilir — kalıcı red değil, sadece araç eksikliği.
