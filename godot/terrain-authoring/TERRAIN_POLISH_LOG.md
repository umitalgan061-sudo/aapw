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

### Iteration #04 — 2026-08-11 23:05 Europe/Istanbul
**Seçilen iyileştirme:** `GrassDetailLayer` yerleşik shader'ında zemine yakın bölümde güçlü, uçlarda hafif global-map tint kullanmak (`u_globalmap_tint_bottom = 0.55`, `u_globalmap_tint_top = 0.10`).
**Neden bu seçildi:** Son üç iterasyon sırasıyla zemin tekrarını, yüzey parlaklığını ve çim taban temasını iyileştirdi. Kalan en zayıf güvenli nokta, starter grass albedosunun farklı arazi renklerinde zeminden kopuk görünme ihtimali. Resmî HTerrain detail-layer dokümantasyonu global-map tint seçeneğinin çimi çevreyle daha iyi karıştırmaya yaradığını açıkça belirtiyor; mevcut eklenti shader'ı bu iki uniformu zaten içeriyor. Bu nedenle core dosya değiştirmeden, yeni geometri eklemeden ve mevcut texture örnekleme yolunu genişletmeden uygulanabiliyor.
**Yapılan değişiklikler:** `scenes/westeros_terrain_authoring.tscn` içindeki `GrassDetailLayer` node'una yalnız `shader_params/u_globalmap_tint_bottom = 0.55` ve `shader_params/u_globalmap_tint_top = 0.10` eklendi. Önceki `u_bottom_ao = 0.35`, density `4.0`, view distance `120.0`, deterministic seed ve HTerrain zemin shader parametreleri korunuyor. `addons/zylann.hterrain/` çekirdek dosyalarına dokunulmadı.
**Test sonucu:** Iteration #04 doğrulaması iki tint değerini ve bottom > top gradyan sözleşmesini, önceki #01/#02/#03 parametrelerini, density/view-distance ve deterministic seed'i birlikte denetleyecek. GitHub Actions zinciri Godot 4.6.3 headless import/editor, HTerrain authoring validation, PWA/cache/installability, mobil performans, determinism/world-reference, terrain/road safety, teknik borç, tam Chromium smoke ve exact-main/additive-only kapılarını çalıştıracak.
**Gözlem:** Beklenen görsel etki, çim tabanının bulunduğu arazi rengini daha güçlü devralması ve uçlara doğru özgün çim renginin büyük ölçüde korunmasıdır; özellikle farklı splat bölgeleri arasında çimin yapıştırılmış görünmesi azalmalıdır.
**Risk / Geri alma notu:** Risk düşüktür. Çok doygun global-map bölgelerinde taban rengi gereğinden fazla etkilenebilir; iki sahne parametresi tek iterasyon davranışı olarak kaldırılarak tamamen geri alınabilir. Shader global-map örneklemesini zaten yaptığı için yeni geometri veya ek texture-fetch yolu eklenmez.
**Bir sonraki çalıştırma için öneri:** Bu iterasyon DoD'dan geçerse starter PBR eksikliğini çözmeden agresif shader özelliklerine geçme; kaya triplanar slot-4 sorunu nedeniyle hâlâ ertelenmeli. Sonraki güvenli aday çim `u_roughness` değerinin mevcut 0.9 varsayılanında kalmasının görsel olarak yeterli olup olmadığını ölçmek veya gerçek PBR asset geçiş planını hazırlamaktır.

### Iteration #04 DoD sonucu — 2026-08-12 07:50 Europe/Istanbul
- **Sonuç:** PASS. `Terrain Polish Iteration 004` run #11 exact `main` `33ecda3ffa60238cb1b0dcb967b05c53e4d986d3` üzerinde Godot 4.6.3 import/editor, temel HTerrain doğrulaması, `TERRAIN_POLISH_ITERATION_04_OK`, PWA/cache/installability, mobil performans, determinism/world-reference, terrain/road safety, teknik borç, tam Chromium smoke ve final exact-main/additive-only kapılarını başarıyla tamamladı.
- **Görsel kanıt:** Xvfb + Godot Compatibility gerçek render ile iki kamera mesafesinde before/after PNG üretildi. Ölçülen fark yakın görünümde `changed=34319`, `mean_delta=0.242130`; uzak görünümde `changed=15706`, `mean_delta=0.091072`. Dört PNG `terrain-polish-004-visual-proof-0793d6ebaf699f94af7aa10b7292814342c8aa24` artifact'i olarak yüklendi.
- **Gözlem:** Yakın görünümde kahverengi/toprak tarafındaki çim tabanları belirgin biçimde zemin tonuna yaklaşırken yeşil tarafta çim karakteri korunuyor; uzak görünümde kahverengi bölgelerdeki parlak yeşil beneklenme azalıyor. Bu, hedeflenen grass/global-map bütünleşmesini doğruluyor.
- **Doğrulama altyapısı notu:** İlk iki görsel-proof denemesi yalnız test helper sıralaması ve baker tamamlanma gözlemi nedeniyle başarısız oldu; production terrain sözleşmesi bu denemelerde bozulmadı. Helper, HTerrain çekirdek dosyalarına dokunmadan düzeltildi.
- **Kalan risk:** Gerçek üretim global-map verisi çok doygun olduğunda `0.55` taban tint güçlü görünebilir; davranış iki izole sahne parametresiyle geri alınabilir.
- **Sonraki öncelik:** Iteration #04 tekrar edilmemeli. Bir sonraki güvenli küçük aday, starter albedo-only zeminde gerçek PBR normal/roughness kalitesini izole biçimde iyileştirmektir; kaya triplanar mevcut slot-4 semantiği çözülmeden ertelenmelidir.
