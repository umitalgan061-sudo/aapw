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

### Iteration #03 DoD sonucu — 2026-08-11 19:29 Europe/Istanbul
- GitHub Actions `Terrain Polish Iteration 003 Rerun` run #4 PASS oldu: exact-main/additive giriş kapıları, Godot 4.6.3 import/editor, `HTERRAIN_AUTHORING_VALIDATION_OK`, `TERRAIN_POLISH_ITERATION_03_OK bottom_ao=0.35 specular=0.25 tile_reduction=(1.0, 0.0, 0.0, 0.0)`, PWA/cache/installability, determinism/world-reference, teknik borç, tam Chromium smoke ve final exact-main/additive kapıları geçti.
- Mobil örnek 35 draw call ve 195929 triangle ile 500 draw call / 500000 triangle bütçesinin altında kaldı; 14/14 terrain seat ve 14/14 yol bağlantısı güvenlik kontrolleri PASS oldu.
- HTerrain çekirdek eklenti dosyaları değiştirilmedi. Godot headless logunda mevcut normalmap-baker shader compiler mesajı ve UID fallback uyarıları tekrar görüldü; doğrulama sonucu başarılı olduğu için çekirdeğe müdahale edilmedi.
- Iteration #03 başarılı kabul edildi. Sonraki terrain polish çalıştırması aynı bottom-AO fikrini tekrar etmemeli; bir sonraki güvenli aday starter grass/global-map tint uyumudur, kaya triplanar ise slot-4 semantiği çözülmeden ertelenmelidir.

### Iteration #04 — 2026-08-12 08:00 Europe/Istanbul
**Seçilen iyileştirme:** `GrassDetailLayer` için yerleşik HTerrain global-map tint karışımını kökte 0.22, uçta 0.08 olarak etkinleştirmek.
**Neden bu seçildi:** Son üç başarılı iterasyon sırasıyla tiling, aşırı speküler tepki ve çim-zemin temasını iyileştirdi. Resmi HTerrain dokümantasyonu global map'in detail grass'ı zeminin ortalama albedosuna tint ederek çevreye daha iyi karıştırmak için kullanıldığını belirtir; repodaki yerleşik `detail.gdshader` da `u_globalmap_tint_bottom` ve `u_globalmap_tint_top` uniformlarını doğrudan destekliyor. Kaya triplanar adayı ise Classic4Lite'ın yalnız dördüncü slot semantiği nedeniyle hedef dışı kar katmanını etkileme riskini koruyor.
**Yapılan değişiklikler:** `scenes/westeros_terrain_authoring.tscn` içindeki `GrassDetailLayer` node'una yalnız `shader_params/u_globalmap_tint_bottom = 0.22` ve `shader_params/u_globalmap_tint_top = 0.08` eklendi. Önceki bottom-AO, terrain specular, tile-reduction, density, view-distance ve deterministic seed sözleşmeleri korunuyor. `addons/zylann.hterrain/` çekirdek dosyalarına dokunulmadı.
**Test sonucu:** Iteration #04 doğrulaması iki tint değerini, kök tintinin uç tintinden güçlü olmasını ve Iteration #01-#03 sözleşmelerinin değişmediğini denetleyecek. GitHub Actions zinciri Godot 4.6.3 headless import/editor, temel HTerrain doğrulaması, PWA/cache/installability, mobil performans, determinism/world-safety, teknik borç, tam browser smoke ve final concurrency/additive-only kapılarını çalıştıracak.
**Gözlem:** Beklenen görsel etki, grass quad'larının özellikle kök kısmında bulundukları arazi renginden hafifçe pay alarak zemine daha doğal oturması; uçlarda yalnız hafif tint bırakıldığı için starter grass dokusunun kendi renk karakterinin korunmasıdır.
**Risk / Geri alma notu:** Risk düşüktür ve ek geometri/texture fetch eklemez; shader zaten global map örneklemesini yapıyor. Global map aşırı koyu/açık bir çalışma verisi içerirse kök rengi gereğinden fazla kayabilir. İki sahne parametresi kaldırılarak tamamen geri alınabilir.
**Bir sonraki çalıştırma için öneri:** DoD temiz kalırsa yeni texture veya shader mimarisi eklemeden önce gerçek authoring global-map/heightmap verisinin kalıcılığını ölç; starter veri hâlâ sentetikse görsel tuning yerine veri-kalitesi darboğazını önceliklendir.

### Iteration #04 DoD sonucu — 2026-08-12 08:35 Europe/Istanbul
- GitHub Actions `Terrain Polish Iteration 004` run #16 PASS oldu: exact-main/additive giriş kapıları, Godot 4.6.3 import/editor, `HTERRAIN_AUTHORING_VALIDATION_OK`, `TERRAIN_POLISH_ITERATION_04_OK tint_bottom=0.22 tint_top=0.08 bottom_ao=0.35 specular=0.25 tile_reduction=(1.0, 0.0, 0.0, 0.0)`, PWA/cache/installability, determinism/world-reference, teknik borç, tam Chromium smoke ve final exact-main/additive kapıları geçti.
- Mobil örnek 35 draw call ve 195929 triangle ile 500 draw call / 500000 triangle bütçesinin altında kaldı; 14/14 terrain seat ve 14/14 yol bağlantısı güvenlik kontrolleri PASS oldu.
- HTerrain çekirdek eklenti dosyaları değiştirilmedi. Godot headless logunda mevcut normalmap-baker shader compiler mesajı, UID fallback uyarıları ve kapanışta ObjectDB/resource uyarıları tekrar görüldü; özel ve temel terrain doğrulamaları başarılı olduğu için çekirdeğe müdahale edilmedi.
- Iteration #04 başarılı kabul edildi. Sonraki terrain polish çalıştırması aynı global-map tint fikrini tekrar etmemeli; önce gerçek authoring global-map/heightmap verisinin kalıcılığı ve veri kalitesi doğrulanmalıdır.

### Iteration #05 — 2026-08-12 08:50 Europe/Istanbul
**Seçilen iyileştirme:** Temiz authoring başlangıcında HTerrain için deterministik bir starter global albedo map oluşturmak ve Terrain Data ile birlikte diske kaydetmek.
**Neden bu seçildi:** Iteration #04 grass global-map tint sözleşmesini ekledi, ancak HTerrain `CHANNEL_GLOBAL_ALBEDO` kanalı varsayılan olarak sıfır haritayla başlıyor ve repodaki `terrain_data/` yalnız `.gitkeep` içeriyor. Bu nedenle temiz checkout'ta tint parametreleri gerçek bir global map üretilene kadar görsel veri alamıyordu. Starter zemin ilk splat slotunda tamamen grass ile başladığı için, başlangıç `ground_grass.svg` taban rengi `#557340` güvenli ve deterministik bir başlangıç global albedosu sağlıyor.
**Yapılan değişiklikler:** `terrain_authoring_bootstrap.gd`, yalnız `initial_data_creation` doğruyken ve global albedo map yokken tek bir `CHANNEL_GLOBAL_ALBEDO` haritası ekliyor, RGB `#557340` ile dolduruyor ve mevcut `save_data()` akışıyla `res://terrain_data` altına kaydediyor. Mevcut Terrain Data veya önceden üretilmiş/custom global map hiçbir şekilde değiştirilmez. `addons/zylann.hterrain/` çekirdek dosyalarına dokunulmadı.
**Test sonucu:** Iteration #05 doğrulaması global-map sayısını, RGB8 formatını, terrain çözünürlüğüyle eşleşmesini, üç ayrı piksel örneğini, `data.hterrain` metadata kanal kaydını ve diske yazılmış `global_albedo*.png` içeriğini kontrol edecek. Iteration #04 tint, Iteration #03 bottom-AO ve deterministic grass seed sözleşmeleri de birlikte korunacak. Tam GitHub Actions zinciri Godot 4.6.3, PWA, performans, determinism/world-safety, browser smoke ve final exact-main/additive kapılarını çalıştıracak.
**Gözlem:** Beklenen etki, yeni authoring çalışma alanının ilk açılışından itibaren grass detail tint'in gerçek bir terrain global-map girdisi alması ve starter yüzeyin uzak/ortalama albedo referansının boş kalmamasıdır. Bu starter harita bilinçli olarak uniformdur; gerçek splat/texture authoring başladığında HTerrain global-map baker ile üretilen veri onun yerini almalıdır.
**Risk / Geri alma notu:** Risk düşüktür. Yeni harita yalnız ilk veri oluşturma anında yaratılır ve 513x513 RGB8 tek map ile sınırlıdır. Existing authoring verisini ezmez; bootstrap'a eklenen blok kaldırılarak tamamen geri alınabilir. Uniform starter renk gerçek üretim global map'i yerine geçmez, yalnız başlangıç veri boşluğunu kapatır.
**Bir sonraki çalıştırma için öneri:** DoD temiz kalırsa yeni shader tuning eklemek yerine gerçek `terrain_data` authoring çıktısının version-control/asset-pipeline stratejisini belirle; height/splat verisi üretime geçtiğinde global map'in HTerrain baker ile yeniden üretildiğini ve starter haritanın otomatik olarak üzerine yazılabildiğini doğrula.

### Iteration #05 DoD sonucu — 2026-08-12 09:11 Europe/Istanbul
- GitHub Actions `Terrain Polish Iteration 005` run #5 PASS oldu: exact-main/additive giriş kapıları, Godot 4.6.3 import/editor, `HTERRAIN_AUTHORING_VALIDATION_OK resolution=513 texture_slots=4 detail_maps=1 seed=20260811 collision=true`, `TERRAIN_POLISH_ITERATION_05_OK global_maps=1 resolution=513 residency=texture persisted=res://terrain_data/global_albedo.png tint_bottom=0.22 tint_top=0.08`, PWA/cache/installability, determinism/world-reference, teknik borç, tam Chromium smoke ve final exact-main/additive kapıları geçti.
- Clean authoring bootstrap CI sırasında `data.hterrain` ve `global_albedo.png` üretti; global albedo metadata kanalında tek map olarak kaydedildi ve `#557340` RGB8, 513x513 round-trip doğrulaması geçti. Headless runtime bağlamında map `Texture2D` residency ile yüklendi; bu HTerrain'ın beklenen runtime davranışıdır.
- Mobil örnek 35 draw call ve 195929 triangle ile 500 draw call / 500000 triangle bütçelerinin altında kaldı; 14/14 terrain seat ve 14/14 yol bağlantısı PASS oldu.
- HTerrain çekirdek dosyaları değiştirilmedi. Mevcut normalmap-baker shader compiler mesajı, UID fallback ve kapanış ObjectDB/resource uyarıları tekrar görüldü; doğrulamalar başarılı olduğu için çekirdeğe müdahale edilmedi.
- Iteration #05 başarılı kabul edildi. Sonraki çalışma starter global-map fikrini tekrar etmemeli; gerçek `terrain_data`/height/splat çıktılarının asset/version-control stratejisi ve HTerrain baker tarafından gerçek global map'e geçiş önceliklidir.
