# Terrain Polish Log

## Çalıştırma Geçmişi

### Iteration #01 — 2026-08-11 16:06 Europe/Istanbul
**Seçilen iyileştirme:** Çim katmanında HTerrain Classic4Lite tiling reduction etkinleştirildi.
**Neden bu seçildi:** Başlangıç çim dokusu 64x64 olduğu için yakın/orta mesafede tekrar eden diyagonal desen üretmeye en yatkın katman. Mevcut HTerrain shader'ı çekirdek dosya değişikliği gerektirmeden birinci texture slotu için anti-tiling örnekleme yolunu zaten destekliyor; bu nedenle küçük, geri alınabilir ve görsel etkisi yüksek bir ilk cilalama adımı.
**Yapılan değişiklikler:** `scenes/westeros_terrain_authoring.tscn` içindeki HTerrain node'una `shader_params/u_tile_reduction = Vector4(1, 0, 0, 0)` eklendi. Yalnız çim slotu etkilenir; toprak, kaya ve kar katmanları aynı kalır. `addons/zylann.hterrain/` çekirdek dosyalarına dokunulmadı.
**Test sonucu:** GitHub Actions üzerinde Godot 4.6.3 headless import/editor, temel HTerrain doğrulaması, Iteration #01 shader-param doğrulaması, PWA/cache, mobil performans, determinism/world-safety, teknik borç, browser smoke ve final concurrency/additive-only kapıları çalıştırılmak üzere bu iterasyona özel doğrulama eklendi.
**Gözlem:** Beklenen görsel etki, özellikle geniş çim alanlarında 64x64 başlangıç dokusunun yönlü tekrar deseninin kırılmasıdır. Shader'ın anti-tiling yolu ikinci bir döndürülmüş/ölçeklenmiş örneklemi derinlik benzeri geçişle karıştırır.
**Risk / Geri alma notu:** Çim piksellerinde ek texture fetch maliyeti vardır. Performans bütçesi aşılırsa tek sahne satırı kaldırılarak tamamen geri alınabilir. Diğer texture slotlarında anti-tiling açılmadığı için maliyet ve kapsam sınırlandırılmıştır.
**Bir sonraki çalıştırma için öneri:** Testler ve performans bütçesi temiz kalırsa ikinci aday olarak yamaç/kaya slotunun triplanar kullanımını değerlendirmeden önce texture slot sıralamasını ve gerçek cliff katmanını doğrula; mevcut Classic4Lite triplanar yolu yalnız son slotu hedefler.

## Başarılı İyileştirmeler

- Iteration #01 adayı: çim katmanında tek-slot tiling reduction. Başarı durumu CI/DoD sonucu ile kesinleşir.

## Denenip Geri Alınanlar

- Henüz yok.

## Sıradaki Öncelikli Adaylar

- Kaya/cliff slotunun gerçek kullanımını doğrulayıp yalnız uygun slotta triplanar mapping değerlendirmek.
- Gerçek PBR normal/roughness kaynakları eklenmeden önce mevcut starter texture setinin geçici olduğunu korumak.
- Heightmap gerçek veri üretmeye başladığında doğal makro-form ve erozyon hissini ayrı bir iterasyonda ölçmek.

## Bilinen Sorunlar / Riskler

- Başlangıç texture'ları authoring bootstrap için düşük çözünürlüklü geçici SVG kaynaklardır; gerçek üretim PBR seti değildir.
- Classic4Lite triplanar desteği yalnız dördüncü texture slotunu işler; mevcut slot sırasını varsayarak açmak yanlış katmanı etkileyebilir.
- Terrain Data repository'de kalıcı authoring çıktısı olarak tutulmuyor; gerçek heightmap kalitesi çalışma verisi oluşmadan nesnel görsel karşılaştırmaya açık değildir.

### Iteration #01 DoD sonucu — 2026-08-11 16:11 Europe/Istanbul
- GitHub Actions `Terrain Polish Iteration 001` run #1 PASS oldu: Godot 4.6.3 import/editor, `HTERRAIN_AUTHORING_VALIDATION_OK`, `TERRAIN_POLISH_ITERATION_01_OK tile_reduction=(1.0, 0.0, 0.0, 0.0)`, PWA/cache/installability, mobil performans, determinism, 14/14 terrain-seat güvenliği, 14/14 yol bağlantısı, teknik borç, tam browser smoke/console ve final remote-main/additive-only kapıları geçti.
- Ölçülen mobil örnek 35 draw call ve 195929 triangle ile tanımlı 500 draw call / 500000 triangle bütçesinin altında kaldı.
- Headless Godot tarafında HTerrain eklentisinden gelen mevcut normalmap-baker shader compiler mesajı ile bazı UID fallback uyarıları görüldü; doğrulamalar başarıyla tamamlandığı ve bu iterasyonda `addons/zylann.hterrain/` değişmediği için çekirdek eklentiye müdahale edilmedi.
- Iteration #01 başarılı kabul edildi; sonraki çalışma aynı fikri tekrar etmemeli.
