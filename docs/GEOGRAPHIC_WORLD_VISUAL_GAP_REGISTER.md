# Geographic World Visual Gap Register

Bu kayıt, coğrafya ile gerçek 3D assetlerin birleşiminde tespit edilen açıkları sınıflandırır. Amaç yeni framework icat etmek değil, mevcut sistemler arasındaki eksik bağları ölçülebilir hale getirmektir.

## GAP-01 — Ambient insan katmanı runtime giriş noktası

**Durum:** Tasarım ve director hazır; shipped `game3d.js` tick/lifecycle entegrasyonu henüz yapılmadı.

**Neden önemli:** Director kendi başına çağrılmazsa gerçek oyuncu oturumunda herhangi bir karakter görünmez. Preview/proof scriptinin geçmesi shipped runtime acceptance değildir.

**Sonraki güvenli adım:** `game3d.js` mevcut lifecycle noktası kullanılmalı. `sceneManager.js` veya `livingWorldSpawner.js` içine ikinci çağrı zinciri açılmamalı.

**Kabul:** Tek bir director instance, mevcut `state.scene`, `state.settlementSeats`, `state.roadEdges`, `state.groundCollider` ve `WORLD_SCALE` ile kurulmalı; tick sırasında yalnız `update(cameraPosition, delta)` çağrılmalı; pagehide sırasında dispose edilmeli.

## GAP-02 — Offline shell kaydı

**Durum:** İnsan asset kaynakları mevcut shell graph'ta görülüyor; yeni geographic director modülü yeni bir runtime dosyası.

**Neden önemli:** PWA offline oturumunda dynamic/static import edilmeyen yeni modül cache dışında kalabilir.

**Sahiplik:** Service worker başka production lane'in alanı olduğundan bu çalışma onu yeniden yazmıyor.

**Sonraki güvenli adım:** Runtime entegrasyonu yapıldığında gerçek module graph görünürlüğü kontrol edilmeli ve service-worker owner'ın mevcut küçük değişiklik sözleşmesine uyulmalı. Büyük SW rewrite kabul edilmemeli.

## GAP-03 — Human texture provenance

**Durum:** Yeni browser proof üç gerçek FBX kaynağını mesh/surface/texture map seviyesinde incelemek için hazır.

**Neden önemli:** “model yüklendi” ile “model texture mapleriyle yüklendi” farklıdır.

**Kabul:** Her source için meshCount>0, surfaceCount>0, en az bir authored map ve HTTP/console/page error=0.

## GAP-04 — Human semantic surfaces

**Durum:** Material core fixture testi human surface vocabulary'sini doğruluyor; gerçek FBX named-part dağılımı browser proof ile ayrıca raporlanıyor.

**Neden önemli:** Bir insanı tek material ile renklendirmek kabul edilemez.

**Kabul:** Skin/hair/eyes/clothing/boots/gear gibi yüzeyler named part ile bulunabildiğinde ayrı tutulmalı; tek mesh/tek material ise shared layered fallback üzerinden ayrıştırılmalı.

## GAP-05 — Horse visual geography

**Durum:** White horse gerçek animalConfig kaynağına ve fauna habitat contract'a bağlandı; visual director için sonraki adapter aşaması hazır.

**Kabul:** Pasture/settlement-edge gibi bağlamlarda; 22° altında slope; su üzerinde değil; saddle/harness/mane/tail ayrımı korunmalı.

## GAP-06 — Wolf visual geography

**Durum:** Wolf gerçek GLB kaynağına ve habitat contract'a bağlandı.

**Kabul:** Snow/cold grassland/mountain/rocky hills/steppe/jungle habitatı; settlement core'dan uzak doğal edge placement; fur/eye/claw/tooth surface ayrımı.

## GAP-07 — Dragon visual geography

**Durum:** Dragon gerçek FBX + texture sidecar ailesine bağlandı.

**Kabul:** Mountain/desert/arid/jungle/snow aerial habitat; settlement merkezinden uzakta; scale/wing/eye/horn/claw ayrımı; gerçek color/bump/normal/fire texture provenance.

## GAP-08 — Fauna behavior ownership

**Durum:** Geographic habitat module davranış üretmiyor.

**Neden önemli:** Aynı hayvan için iki hareket state machine açmak determinism ve ownership çakışması yaratır.

**Kural:** `animalConfig`, `animals`, `creatureBrain`, `dragonController`, `livingWorldSpawner` authoritative kalır. Geographic layer yalnız seçim ve placement policy sağlar.

## GAP-09 — Vegetation visual linkage

**Durum:** Vegetation already consumes canonical terrain/seat/road constraints, fakat geographic ambient human layer ile ortak görünürlük bütçesi bulunmuyor.

**Risk:** Aynı kamera bölgesinde asset sayısı arttıkça mobile GPU yükü artabilir.

**Kural:** Yeni ambient human budget sabit kalmalı; vegetation owner'ın instance budgetı ayrıca korunmalı. İki sistemin kotaları gizlice çarpılmamalı.

## GAP-10 — Natural geology linkage

**Durum:** Geology placement ayrı owner lane'de.

**Kural:** Ambient character slope/water checks geology objectlarını yeniden üretmemeli; yalnız canonical collider sampler kullanılmalı.

## GAP-11 — Settlement readability

**Durum:** Ring placement ile core exclusion getirildi.

**Kabul:** Karakterler settlement merkezinin içine basmamalı; kapı, kale, duvar veya quest interaction alanlarını işgal etmemeli.

## GAP-12 — Road readability

**Durum:** Road edge mesafesi placement policy içine alındı.

**Kabul:** İnsan road ribbon üzerine render edilmeyecek; side-of-road context korunacak.

## GAP-13 — Biome continuity

**Durum:** Director world reference map'ten biome kind/id alıyor.

**Kabul:** Map zone center round-trip aynı biome kind'i vermeli. East/west veya north/south inversion olmamalı.

## GAP-14 — LOD stability

**Durum:** 700m show / 920m hide hysteresis ve 0.20s update cadence tanımlandı.

**Kabul:** Sınırda flicker olmamalı; uzak actor state machine tick edilmemeli.

## GAP-15 — Deterministic distribution

**Durum:** Stable hash placement kullanılıyor.

**Kabul:** Aynı seed + seat id + candidate index aynı JSON placement üretmeli. `Math.random()` kullanımı 0 olmalı.

## GAP-16 — Textureless fallback honesty

**Durum:** Director authored maps mevcutsa onları koruyor; map olmayan kaynağı shared autoAssignMaterials fallback'ine yönlendiriyor.

**Kural:** Fallback gerçek texture varmış gibi raporlanmamalı. Manifest `layered-fallback` ile `preserve-authored-material` modlarını ayırmalı.

## GAP-17 — Placeholder handling

**Durum:** Loader placeholder döndürürse placement reddediliyor.

**Kabul:** Görsel prova “magenta cube” gibi fallback nesnesini başarı saymamalı.

## GAP-18 — Runtime material authority

**Durum:** Director `MaterialAssignmentCore` ve `WorldAssetPlacementPipeline` üzerinden geçiyor.

**Kural:** `EditorMaterialStudio.js` veya DOM authoring helper'ları runtime bundle'a import edilmemeli.

## GAP-19 — Proof completeness

**Durum:** Static policy, real binary asset texture proof ve canonical createScene proof ayrıldı.

**Kabul:** Üçü de aynı exact PR head üzerinde koşmalı. Eski run SHA'ları yeni head proof'u olarak kabul edilmemeli.

## GAP-20 — PR scope

**Durum:** Bu branch sadece geography/ambient asset katmanına ait dosyalar taşıyor.

**Kabul:** Başka owner'ın runtime production file'ları eklenmemeli. Tek PR `additions + deletions <=3000` sınırında kalmalı.

## Öncelik sırası

1. GAP-01: shipped runtime integration.
2. GAP-02: offline shell owner ile küçük, deterministic registration.
3. GAP-03/04: real texture/material browser proof.
4. GAP-05/06/07: mevcut fauna controllers'a aynı geographic contract üzerinden adapter.
5. GAP-14/15: mobile LOD ve determinism regression proof.

## Son söz

Haritanın coğrafi görünümü asset sayısını artırmakla değil, doğru varlığı doğru yerde ve doğru yüzey davranışıyla göstermekle güçleniyor. Bu register özellikle “asset var mı?” sorusunu “asset bu coğrafyada neden burada ve görsel olarak doğru mu?” sorusuna dönüştürüyor.
