# Terrain Automation Rules — Map.png + HTerrain + Terrain3D

Bu dosya, zamanlanmış/otonom zemin görevleri için zorunlu çalışma sözleşmesidir. Her terrain görevi `GOVERNANCE.md` sonrasında bu dosyayı ve `terrain3d.lock.json` dosyasını okumalıdır.

## 0. Terminoloji düzeltmesi — "piksel piksel" DEĞİL, "adım adım"

- Proje sahibinin daha önce kullandığı **"piksel piksel ilerleme"** ifadesi, görsel hedef olarak kare/küp/piksel blokları üretmek anlamına GELMEZ. Doğru anlamı **"adım adım, küçük ve ölçülebilir iş parçaları halinde ilerlemek"**tir.
- GeoCell, Pindex, 96x64 maske, 192x128 kaynak alanı veya başka bir grid yalnızca **iş bölümü / ölçüm / kaynak adresleme** aracıdır; final 3D yüzey çözünürlüğü veya görsel stili değildir.
- Nihai dünya uzaktan ve yakından **kesintisiz, doğal, yüksek çözünürlüklü ve gerçekçi** görünmelidir. Görünür kare hücre sınırı, nearest-neighbour bloklaşması, basamaklı kıyı, mozaik/piksel görünümü veya GeoCell dikişi kabul edilmez.
- Düşük çözünürlüklü kaynak maskeleri karar/semantic girdisi olabilir; final geometri ve materyal üretiminde contour/SDF, spline, filtreli yüksek çözünürlüklü yeniden örnekleme, Terrain3D height/control maps ve gerektiğinde sub-cell authoring ile yumuşatılır. Bu işlem kaynak coğrafyanın merkez/alan doğruluğunu değiştirecek keyfi blur yapamaz.
- Her görev "bir hücreyi boyamak" yerine, o bölgedeki kıyı, yükselti, biyom, kaya/kar, yol ve near-detail özelliklerini komşu bölgelerle **C0/C1 görsel süreklilik** sağlayacak biçimde gerçek araziye dönüştürür.

## 1. Değişmez görsel kaynak

- `map.png` (1536x1024) 3D coğrafyanın ana görsel doğruluk kaynağıdır.
- Amaç 2D görüntüyü zemine yapıştırmak değil; kıyı/deniz-göl sınırları, kara biyomları, kaya, kar, yükseklik karakteri ve yolları 3D fiziksel karşılıklarına dönüştürmektir.
- Harita yazıları, etiketler, arma/dekoratif işaretler terrain verisi sayılmaz.
- Her değişiklik ölçülebilir bir kaynak-eşleşme iyileştirmesi göstermelidir. Sadece estetik olarak farklı olmak yeterli değildir.
- Kaynakta düşük çözünürlükte temsil edilen bir sınır final renderda aynı piksel merdiveniyle korunmaz; önce coğrafi topoloji korunur, sonra yüksek çözünürlüklü sürekli sınır üretilir.

## 2. Terrain motorları ve nihai mimari

### HTerrain

- Mevcut `addons/zylann.hterrain/`, terrain_data, authored probes ve kabul edilmiş doğrulamalar korunur.
- HTerrain bundan sonra karşılaştırma, regresyon, veri kurtarma ve geçiş güvenliği için desteklenen authoring kaynağıdır.
- Mevcut üretim/veri zinciri kanıtsız biçimde silinmez veya topluca taşınmaz; fakat yeni tam-dünya kalite hedefinin nihai authoring backend'i Terrain3D'dir.

### Terrain3D — zorunlu tam-dünya authoring backend'i

- Yetkili upstream: `https://github.com/TokisanGames/Terrain3D`.
- `TokisanGames/Terrain3DD` diye ayrı bir resmi repo yoktur; görevlerdeki olası `Terrain3DD` yazımı typo kabul edilip **Terrain3D** olarak düzeltilir.
- Godot Asset Library kimliği: `3892`.
- Kilitli sürüm ve SHA256 yalnız `terrain3d.lock.json` üzerinden okunur.
- Kurulum: `python3 godot/terrain-authoring/tools/install_terrain3d.py`.
- `project.godot` içinde `res://addons/terrain_3d/plugin.cfg` etkin olmalıdır; bu, Godot arayüzündeki `Project -> Project Settings -> Plugins -> Terrain3D = Enabled` durumunun proje dosyasındaki karşılığıdır.
- Zamanlanmış görevler gerektiğinde `python3 godot/terrain-authoring/tools/install_terrain3d.py --check-upstream` ile upstream son release bilgisini okuyabilir.
- Zamanlanmış terrain görevleri GitHub bağlantısı veya HTTPS üzerinden resmi `TokisanGames/Terrain3D` deposundaki kaynak kodu, `doc/`, örnekler, shader/brush/tool implementasyonları ve release notlarını **okuyup araştırma girdisi olarak kullanabilir**. Uygulama davranışı için önce kilitli `v1.0.2-stable` etiketi esas alınır; upstream `main` yalnız araştırma/karşılaştırma amacıyla okunabilir.
- Upstream kodundan yararlanırken API veya davranış tahmin edilmez; ilgili dosya/etiket okunur. Başka sürümden kod kopyalamak, binary değiştirmek veya lock dosyasını güncellemek ayrı upgrade PR'ı gerektirir.
- Upstream değişti diye otomatik sürüm yükseltme YASAKTIR. Yeni sürüm ayrı PR'da Godot headless, determinism, performans, map-fidelity, yol ve 14 yerleşim güvenliği testlerinden sonra kilide alınır.
- Terrain3D artık yalnız "faydalıysa kullanılacak ikinci araç" değildir. **Yeni gerçekçi tam-dünya üretiminde zorunlu authoring/bake backend'idir.** Height/region/control maps, texture layers, LOD/clipmap davranışı, holes ve instance/foliage verisi uygun olduğunda Terrain3D üzerinde doğrulanır.
- Bir GeoCell görevi yalnız JSON/maske üretip Terrain3D'yi hiç çalıştırmadan "Terrain3D işi" sayılmaz. Terrain3D kullanılan aşamada plugin load + gerçek Terrain3D data/region/import/bake kanıtı bulunmalıdır.

### Web/PWA çalışma zamanı sınırı

- Mevcut Three.js tabanlı masaüstü/mobil/PWA oyun korunur; Terrain3D Godot eklentisi tarayıcıya doğrudan yüklenmeye çalışılmaz.
- Terrain3D yüksek kaliteli **authoring ve bake kaynağıdır**. Tarayıcı çalışma zamanı, Terrain3D'den deterministik olarak üretilmiş/export edilmiş height, surface/control, biome, instance/foliage veya türetilmiş mesh/atlas verilerini mevcut Three.js dünya sistemine yükler.
- Aynı kaynak commit + aynı seed + aynı bake sürümü aynı runtime çıktısını üretmelidir. Bake çıktılarının provenance/checksum bilgisi tutulur.
- Uzun vadeli hedef: kullanıcı oyunda gezerken gördüğü coğrafya ile Terrain3D authoring görünümü arasında makro şekil, kıyı, relief ve yüzey sınıfı bakımından ölçülebilir eşleşme.

## 3. 4-köşe paralel geliştirme düzeni

Kaynak harita 8x8 adet **GeoCell çalışma parseline** ayrılır. Her GeoCell 192x128 **kaynak piksel alanını adresler**. Bu ifade final terrain'in 192x128 çözünürlüklü, bloklu veya piksel görünmesi gerektiği anlamına gelmez. Böylece 1536x1024 map.png tam ve kayıpsız olarak 64 iş alanına bölünürken final Terrain3D yüzeyi komşular arasında kesintisiz kalır.

Koordinatlar: `gx=0..7` batıdan doğuya, `gy=0..7` kuzeyden güneye.

Dört ana ajan aynı anda başlar:

1. **Kuzeybatı — Buzul Muhafızı**: `(0,0)` köşesinden merkeze doğru.
2. **Kuzeydoğu — Şafak Kartalı**: `(7,0)` köşesinden merkeze doğru.
3. **Güneybatı — Günbatımı Ustası**: `(0,7)` köşesinden merkeze doğru.
4. **Güneydoğu — Kızıl Ufuk**: `(7,7)` köşesinden merkeze doğru.

Her ajan kendi köşesine Chebyshev/halka uzaklığı en küçük olan tamamlanmamış GeoCell'i seçer ve merkeze doğru ilerler. Aynı hücre başka bir ajan tarafından bitirilmişse iş yapmak için rastgele değiştirme yapmaz; mevcut kanıtı ölçer ve yalnız kalite skorunu artırabildiği durumda refinement PR'ı açar.

Her ajan yalnız kendi hücresinin merkezini değil, dikiş kontrolü için komşu hücre sınırlarında en az bir **overlap/guard band** örnekler. Guard band sahiplik anlamına gelmez; sadece kıyı, yükseklik, normal, materyal ve foliage sürekliliğini ölçmek içindir.

## 4. GeoCell kabul sırası — adım adım gerçekçilik

Bir hücre tek commit/PR'da devasa biçimde yeniden yazılmaz. Aşağıdaki katmanlar sırayla ölçülür ve iyileştirilir:

1. **Coast/Hydrology** — deniz, göl ve kara sınırı; görünür piksel merdiveni olmadan sürekli kıyı.
2. **Macro Albedo/Biome** — map.png kara renk/bitki-toprak karakteri; blok renk adaları yerine doğal geçiş.
3. **Relief/Height Character** — dağ, ova, sırt, geçit; yerleşim/yol güvenliği bozulmadan Terrain3D yüksekliği.
4. **Rock/Snow** — kaynak konumuna ve relief/yüksekliğe bağlı dağılım; slope/height/biome ile fiziksel tutarlılık.
5. **Road/Path** — referans yol izi + mevcut deterministic yol güvenliği; araziye gömülmeyen/askıda kalmayan doğal kesit.
6. **Near Detail** — normal/roughness/detiling/microvariation/foliage/instance; uzaktan harita eşleşmesini bozmaz.
7. **Terrain3D Bake/Runtime parity** — authoring çıktısı deterministik bake edilir ve Three.js runtime'da aynı makro araziyi üretir.

Bir üst katmana geçmek için önceki katman regresyon yapmamalıdır. Bir hücre yalnız Coast/Hydrology tamamlandı diye "tamamlandı" sayılmaz; tam-dünya bitişi için yedi katmanın tamamı gerekir.

## 5. Çakışma, dikiş ve buluşma kuralı

- Her görev başlangıcında `main` yeniden okunur; stale branch üstüne çalışma yapılmaz.
- İki ajan aynı GeoCell'e ulaştığında ilk hedef kod birleştirmek değil, **ölçüm birleştirmektir**.
- Daha yeni hücre kalite skoru, kaynak renk/semantic hatası, kıyı IoU/mesafe metriği ve görsel kanıt karşılaştırılır.
- İkinci ajan yalnız daha iyi ölçülebilir sonuç üretiyorsa değişiklik yapar; aksi halde sıradaki hücreye geçer.
- Aynı dosyayı paralel değiştirmek gerekiyorsa sorumluluk küçük veri/atlas/parça dosyalarına bölünür; ortak entegrasyon dosyası Merkez Hakemi görevine bırakılır.
- GeoCell birleşimlerinde görünür çizgi/dikiş kabul edilmez. Height, normal, albedo/surface ağırlıkları, kıyı contour'u ve foliage yoğunluğu sınırın iki tarafında karşılaştırılır.
- Kaynak semantic kararını koruyan ama final görselde grid izi bırakmayan yüksek çözünürlüklü interpolation tercih edilir. "Maskede böyle kareydi" dikiş/bloklaşma için gerekçe değildir.

## 6. Zorunlu doğrulamalar

Her terrain PR'ında uygun olanların tamamı çalıştırılır:

- exact-main / concurrency kontrolü;
- Godot 4.6.x headless import/editor;
- HTerrain mevcut doğrulamaları;
- **Terrain3D pinned kurulum + plugin load doğrulaması**;
- Terrain3D kullanan katmanda gerçek region/data/import/bake çıktısı ve checksum;
- map.png kaynak/hash ve GeoCell koordinat doğrulaması;
- kaynak topolojisini koruyan yüksek çözünürlüklü kıyı/semantic yeniden örnekleme kontrolü;
- GeoCell sınır seam testi; görünür grid/pixel-block artefactı için otomatik + görsel kontrol;
- deterministic tekrar üretim;
- 14/14 settlement terrain safety;
- road network safety;
- desktop/mobile performans bütçesi;
- tam browser smoke ve temiz console;
- en az yakın + uzak görsel kanıt, mümkünse before/after;
- tam-dünya kilometrelerce üstten görünümde kaynak coğrafya eşleşmesi ve yakında fiziksel yüzey gerçekçiliği.

Terrain3D veya HTerrain yalnız araç değildir: bu proje için **Terrain3D authoring + deterministik web runtime parity** hedef mimaridir; yine de nihai kabul ölçütü kaynak doğruluğu, doğal görünüm, performans ve güvenliktir.

## 7. Dört ajanın ortak tam-dünya görevi

Dört köşe ajanının tamamı bundan sonra aynı nihai hedefe çalışır: **64 GeoCell'in tamamını Terrain3D ile author edilmiş, komşularla dikişsiz, gerçekçi ve Three.js runtime'a deterministik bake edilmiş tek bir dünya haline getirmek.**

- **Buzul Muhafızı / NW:** kuzeybatıdan merkeze; soğuk iklim, kar/buz, kuzey kıyıları ve yüksek enlem relief sürekliliği.
- **Şafak Kartalı / NE:** kuzeydoğudan merkeze; doğu denizleri, steppe/dağ geçişleri, uzak görüş ve LOD sürekliliği.
- **Günbatımı Ustası / SW:** güneybatıdan merkeze; Westeros güney/batı kıyıları, dağ-ova/çöl geçişleri, yol ve kıyı ayrıntısı.
- **Kızıl Ufuk / SE:** güneydoğudan merkeze; Yi Ti/Sothoryos/Ulthos yönü, tropik/arid geçişler, relief ve foliage çeşitliliği.

Her ajan kendi bölgesinde bütün yedi katmanı tamamlar; yalnız hydrology hücreleri üretip merkezde bırakmaz. Buluşma noktasına gelindiğinde dört yönün yükseklik, kıyı, materyal, yol ve foliage verisi tek bir Terrain3D/bake bütünlüğünde birleşmelidir.

## 8. Tam-dünya DONE kriteri

Aşağıdakilerin tamamı kanıtlanmadan "3D dünya tamamlandı" denmez:

- 64/64 GeoCell yedi katman üzerinden kabul edilmiş;
- Terrain3D pinned plugin gerçek authoring/bake zincirinde kullanılmış;
- final üstten görünümde GeoCell/Pindex/96x64 maske blokları veya görünür grid izi yok;
- kıyılar doğal ve kaynak topolojisiyle uyumlu, göl/deniz ayrımı doğru;
- büyük dağ/ova/sırt/geçit karakteri kaynağı karşılıyor;
- 14/14 yerleşim güvenli ve yol ağı geçerli;
- tüm cell seam metrikleri tolerans içinde;
- runtime bake checksum/provenance deterministik;
- desktop/mobile performans bütçeleri geçiyor;
- yakın, orta, uzak ve **tam-harita tepeden** görsel kanıt var;
- Three.js oyun/PWA tam smoke testinde konsol hatası yok.

## 9. Görev çıktısı

Her tur sonunda görev adı, köşe, GeoCell, tamamlanan katman, başlangıç/bitiş kalite ölçüleri, kullanılan motor (`HTerrain`, `Terrain3D`, `Three.js runtime` veya kombinasyonu), Terrain3D bake/provenance bilgisi, değiştirilmiş dosyalar, testler, görsel etki, seam ölçümü ve sonraki hücre kaydedilir. Kanıtsız `PASS` veya `DONE` yazılmaz.
