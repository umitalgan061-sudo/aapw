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

### Iteration #02 — 2026-08-11 17:02 Europe/Istanbul
**Seçilen iyileştirme:** Geçici albedo-only terrain materyalinin speküler seviyesini 0.50 varsayılanından 0.25'e düşürmek.
**Neden bu seçildi:** Son iterasyonun önerisi doğrulanırken texture slot sırasının `grass, earth, rock, snow` olduğu görüldü; HTerrain Classic4Lite triplanar yolu yalnız 4. slotu işlediği için triplanar'ı şimdi açmak kaya yerine kar katmanını etkileyerek hedef dışı bir değişiklik olurdu. Mevcut starter texture'lar gerçek roughness/normal PBR seti olmadığı için varsayılan `u_specular = 0.5` daha yapay/parlak bir yüzey hissi üretebilir. 0.25 değeri yalnız materyal yansıma tepkisini yumuşatan, texture fetch ve geometri maliyeti eklemeyen küçük bir cilalama adımıdır.
**Yapılan değişiklikler:** `scenes/westeros_terrain_authoring.tscn` içindeki HTerrain node'una yalnız `shader_params/u_specular = 0.25` eklendi. Iteration #01 `u_tile_reduction` ayarı aynen korunuyor; `addons/zylann.hterrain/` çekirdek dosyalarına dokunulmadı.
**Test sonucu:** Bu iterasyona özel Godot doğrulaması `u_specular == 0.25` ve önceki çim anti-tiling sözleşmesinin değişmediğini denetliyor. GitHub Actions zinciri Godot 4.6.3 headless import/editor, temel HTerrain doğrulaması, PWA/cache, mobil performans, determinism/world-safety, teknik borç, browser smoke, concurrency ve additive-only kapılarını çalıştıracak.
**Gözlem:** Beklenen görsel etki, özellikle güneş alan geniş düzlük ve yamaçlarda geçici starter dokuların parlak/plastik algısının azalması; daha mat ve doğal bir arazi tepkisi. Renk, splat ağırlıkları, UV ölçeği, geometri, LOD ve detay yoğunluğu değişmez.
**Risk / Geri alma notu:** Risk düşüktür; bazı ıslak/buzlu görünümlerde highlight etkisi azalabilir. Tek sahne parametresi kaldırılarak tamamen geri alınabilir. Performans maliyeti beklenmez.
**Bir sonraki çalıştırma için öneri:** Bu değişiklik DoD'dan geçerse kaya/cliff için triplanar açmadan önce slot mimarisini additive-only kurala uygun biçimde nasıl kaya katmanını 4. slota taşıyabileceğini veya ayrı güvenli shader seçeneğini değerlendirmek; bu mümkün değilse mevcut starter set üzerinde makro-varyasyon adayına geçmek.

### Iteration #03 — 2026-08-11 18:00 Europe/Istanbul
**Seçilen iyileştirme:** `GrassDetailLayer` için yerleşik HTerrain grass shader `u_bottom_ao` değerini 0.35 olarak etkinleştirmek.
**Neden bu seçildi:** Önceki iki iterasyon zemin tekrarı ve yüzey parlaklığını iyileştirdi. Kalan en görünür küçük sorunlardan biri geçici quad çimlerin zemine temasında kök bölgesinin düz/etiket gibi algılanabilmesi. HTerrain'in mevcut detail shader'ı ek texture veya geometri olmadan tabana doğru sahte AO koyan hazır bir parametre içeriyor; resmi HTerrain dokümantasyonu da detail layer'ların yerleşik grass shader kullandığını ve global-map tint/custom shader parametreleriyle çevreye karışmasının iyileştirilebildiğini belirtiyor.
**Yapılan değişiklikler:** `scenes/westeros_terrain_authoring.tscn` içindeki `GrassDetailLayer` node'una yalnız `shader_params/u_bottom_ao = 0.35` eklendi. Density, view distance, deterministic seed ve önceki terrain shader ayarları aynen korunuyor. `addons/zylann.hterrain/` çekirdek eklenti dosyalarına dokunulmadı.
**Test sonucu:** Iteration #03 doğrulaması bottom AO değerini, önceki Iteration #01/#02 shader sözleşmelerini, çim density/view-distance değerlerini ve deterministic seed'i birlikte kontrol edecek. GitHub Actions zinciri Godot 4.6.3 headless import/editor, temel HTerrain doğrulaması, PWA/cache/installability, mobil performans, determinism/world-safety, teknik borç, browser smoke ve final concurrency/additive-only kapılarını çalıştıracak.
**Gözlem:** Beklenen görsel etki, çim bıçaklarının zeminle birleştiği bölgede hafif koyulaşma ile daha iyi temas/derinlik hissi; çim yoğunluğu veya silueti değişmeden daha az karton-quad görünümü.
**Risk / Geri alma notu:** Risk düşüktür. 0.35 değeri bazı çok koyu global-map bölgelerinde tabanı gereğinden koyu gösterebilir; tek sahne satırı kaldırılarak tamamen geri alınabilir. Ek texture fetch veya geometri maliyeti eklenmez.
**Bir sonraki çalıştırma için öneri:** Iteration #03 DoD temiz kalırsa starter grass'ın global-map tint değerlerini ölçülü biçimde değerlendirmek; kaya triplanar konusu ise slot-4 sınırlaması çözülmeden ertelenmeli.