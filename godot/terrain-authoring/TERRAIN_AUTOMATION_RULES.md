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

### 1.1 Ortak, sürümlü map-derived geography package

Dört ajan aynı kaynak piksellerini bağımsız ve çelişkili biçimde yorumlayamaz. Tek bir sürümlü,
checksum'lı ve deterministik **map-derived geography package** bütün authoring/runtime tüketicilerinin
ortak girdisidir. Bu pakette en az aşağıdakiler bulunur:

- `sourceMapSha256`, kaynak boyutu, extractor/algoritma sürümü ve her katman için provenance;
- yazı, şehir/kale işareti, arma, dekoratif sınır ve ikonları dışlayan `label_symbol_mask`;
- `land/ocean`, kıyı sığlığı/shelf ve lagoon alt sınıfları;
- sabit `lake_id`, kapalı lake maskesi, göl su kotu ve spill point/havza ilişkisi;
- yönlü river graph ile source/tributary/outlet ve flow-accumulation verisi;
- ridge/peak/valley/pass eksenleri; yön, genişlik ve göreli prominence;
- forest/biome/ice/desert/marsh olasılık alanları;
- düşük güvenli bölgeler için confidence; ajan burada keskin uydurma özellik üretmez.

Harita yazısı veya şehir ikonu dağa; etiket boşluğu göle; noktalı sınır ormana dönüşemez. Ortak paket
değişikliği ayrı bir ledger lease/PR, checksum sürüm artışı ve dört quadrant regresyonu ister.
`map.png` rengi makro sınıf/olasılık kanıtıdır; düz, literal final albedo değildir.

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

Her turun ilk işi, son **gerçek runtime full-world 3D renderı** ile yazı/simge maskeli map.png arasında
çok ölçekli bir hata ısı haritası çıkarmaktır. Coast, ocean/lake topology, river graph, mountain/ridge,
forest/biome, seam ve runtime/physics parity kusurları önem sırasıyla listelenir.

- Devam eden geçerli lease veya yarım feature varsa önce güvenle bitirilir.
- Aksi halde ajan, kendi quadrant'ındaki **en yüksek görsel/oyunsal şiddetli sahiplenilmemiş hatayı**
  seçer. Köşeye Chebyshev/halka uzaklığı yalnız eşitlik bozucudur; düşük etkili yakın hücre, bütün
  dünyada kayıp dağ zinciri veya yanlış deniz/göl topolojisinin önüne geçemez.
- Dağ zinciri, nehir havzası, göl ve orman gibi hücre aşan işler `feature_id + GeoCell listesi +
  guard-band` lease'i alır. Guard band yalnız ölçüm değil, aynı feature'ın sınırda kesilmesini
  engelleyen sözleşmedir; komşu hücrenin merkez sahipliğini devretmez.
- Başka ajan daha iyi kanıtla tamamladıysa rastgele rewrite yapılmaz; refinement ancak baseline'a
  göre sayısal iyileşme ve gerçek runtime görsel farkı gösteriyorsa açılır.

## 4. GeoCell kabul sırası — adım adım gerçekçilik

Bir hücre tek commit/PR'da devasa biçimde yeniden yazılmaz. Aşağıdaki katmanlar sırayla ölçülür ve iyileştirilir:

1. **Coast/Hydrology** — deniz, göl ve kara sınırı; görünür piksel merdiveni olmadan sürekli kıyı.
2. **Macro Albedo/Biome** — map.png kara renk/bitki-toprak karakteri; blok renk adaları yerine doğal geçiş.
3. **Relief/Height Character** — dağ, ova, sırt, geçit; yerleşim/yol güvenliği bozulmadan Terrain3D yüksekliği.
4. **Rock/Snow** — kaynak konumuna ve relief/yüksekliğe bağlı dağılım; slope/height/biome ile fiziksel tutarlılık.
5. **Road/Path** — referans yol izi + mevcut deterministic yol güvenliği; araziye gömülmeyen/askıda kalmayan doğal kesit.
6. **Near Detail** — normal/roughness/detiling/microvariation/foliage/instance; uzaktan harita eşleşmesini bozmaz.
7. **Terrain3D Bake/Runtime parity** — authoring çıktısı deterministik bake edilir ve Three.js runtime'da aynı makro araziyi üretir.

Bir üst katmana geçmek için önceki katman regresyon yapmamalıdır. Bir hücre yalnız Coast/Hydrology tamamlandı diye "tamamlandı" sayılmaz; tam-dünya bitişi için yedi katmanın tamamı gerekir. Maske/JSON veya semantic görsel tek başına hiçbir katmanı tamamlamaz; özellik gerçek runtime sahnede görünür, ölçülebilir ve fizik ile aynı kaynakta olmalıdır.

### 4.1 Ocean, lake ve river topoloji sözleşmesi

- **Ocean**, görüntü/dünya dış sınırına su üzerinden bağlı bileşendir. **Lake**, tamamen kara içinde
  kapalı, sabit `lake_id` ve düz su kotu olan bileşendir. **River**, yönlü grafiktir. Açık mavi
  kıyı sığlığı/shelf veya deniz içi renk poligonu göl değildir; denizde lake geometry sayısı sıfırdır.
- Tek dev water plane'in karayı örtmesi göl üretimi sayılmaz. Ocean ve lake mask/geometry/material
  katmanları ayrı doğrulanır; terrain kıyısı ile su sınırı aynı topoloji paketini kullanır.
- Heightfield, Priority-Flood veya belgelenmiş eşdeğer ile yapay pitlerden arındırılır; D8/D∞ ya da
  kanıtlanmış eşdeğer akış yönü ve flow accumulation nehir grafiğini üretir.
- Nehir source → tributary → main channel → lake/ocean zincirinde kesintisiz ve monoton aşağı
  akmalıdır. Uphill segment, yetim uç, geçersiz outlet, yüzen mavi yama, kuru göl çıkışı ve kıyıda
  cyan speckle sıfır olmalıdır.
- Ocean shader dalga/foam/depth geçişi; lake shader daha sakin normal/roughness kullanır. Tam-dünya
  uzak görünümünde oyun-kamerası foam/specular'ı sahte göl poligonuna dönüşemez.

### 4.2 Gerçek heightfield, dağ zinciri ve erozyon

- Üretim yüksekliği 8-bit PNG, düşük `DEFAULT_MAX_HEIGHT_METERS` veya bağımsız FBM olamaz.
  16/32-bit EXR/R16 ya da eşdeğer metre-değerli master kullanılır; sea datum, min/max metre,
  import scale/offset, vertex spacing ve vertical aspect ratio manifestte kayıtlıdır.
- Önce kısıtlı çok ölçekli makro şekil kurulur: kıyı sea datum; ridge/peak pozitif yükseklik ve
  gradient; valley/pass/river azalan/negatif gradient kısıtıdır. Kontrollü erosion ve mikro-noise
  ancak bundan sonra uygulanır; kıyı, ana ridge yönü ve feature ayak izi silinemez.
- Haritadaki dağlar izole koni/noise kabarcığı değil; geniş ayak izli, yan sırtlı, vadili, geçitli,
  kaynak doğrultusuna hizalı **kesintisiz zincirler** olmalıdır. Peak prominence, ridge coverage,
  yön sapması, chain continuity, relief range ve slope dağılımı ölçülür.
- Dağ gerçek runtime orthographic hillshade/shadow/normal kanıtında belirgin değilse Relief tamam
  değildir. Yalnız kanıt görüntüsünde capture-only height exaggeration yapıp üretim mesh/collider'ını
  düz bırakmak nihai çözüm değildir; diagnostik görüntü metadata'sında açıkça ayrılır.

### 4.3 PBR zemin, iklim ve biyom

- Terrain3D Height + Control + Color/Roughness gerçekten üretilir/import edilir. Materyal kararı
  slope, elevation, moisture/flow accumulation, latitude, continentality, rain shadow, shore
  distance ve map biome olasılığını birlikte kullanır.
- Steep yüzeyde triplanar rock; kıyıda ıslaklık/kum/çakıl; vadide toprak/çayır; iklime bağlı snow/ice;
  arid bölgede rock/sand uygulanır. Geçişler sürekli ağırlık/SDF ile organiktir.
- Normal, roughness ve macro/micro albedo tekrarını kır; uzaktan düz boya, yakından görünür tiling
  veya GeoCell bloğu üretme. Sıcak Yi Ti/Jogos Nhai ve sıcak alçak arazide salt noise/yükseklik
  yüzünden sahte kar yasaktır.

### 4.4 Ağaç ve orman yerleşimi

- map.png orman lekesi makro density envelope'tur. Yoğunluk bu zarf ile biome, nem, slope, elevation,
  shore/river mesafesini birlikte kullanır; haritada orman olmayan çöl/tundra/steppe rastgele kapanmaz.
- Deterministik seed, blue-noise/Poisson benzeri aralık, cluster+gap, yumuşak orman kenarı ve
  tür/yaş/boy/rotasyon çeşitliliği kullanılır.
- Ağaç ocean/lake/river, yol, yerleşim, dik cliff, çıplak yüksek dağ, aktif snow/ice veya biome dışı
  alana giremez. Aynı live terrain sampler'dan height/normal/surface alır; yüzen/gömülü ağaç sıfırdır.
- Yakında kaliteli mesh/wind/shadow; uzakta LOD/HLOD/impostor; spatial chunk'lı
  MultiMesh/InstancedMesh ve doğru AABB/bounds kullanılır. Collider yalnız gameplay yakınında
  etkinleşir. Desktop ve mobile/PWA için p95 frame time, draw-call, triangle, instance ve bellek
  bütçeleri baseline ile raporlanır.

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
- tam-dünya kilometrelerce üstten görünümde kaynak coğrafya eşleşmesi ve yakında fiziksel yüzey gerçekçiliği;
- coastline IoU + symmetric Chamfer/Hausdorff; ridge alignment/coverage/continuity/prominence;
  lake component/id/planarity/land-containment; river connectivity/downhill/outlet; forest
  precision/recall/alan ve illegal-instance; seam height/normal/control/foliage ölçümleri;
- renderer, Terrain3D bake, collider, navmesh/player grounding, water/river, roads, settlements ve
  vegetation için tek `currentTerrain/world-data` sampler + aynı source checksum; görsel/fizik
  yükseklik farkı FAIL;
- yazı/simge kaynaklı false-positive feature sayısı ve ocean↔lake topoloji hatası sıfır;
- sürüm kontrollü kabul eşikleri ve önceki baseline'a karşı no-regression; metrik yoksa PASS yok.

### 6.1 Zorunlu gerçek full-world 3D orthographic kanıt

Semantic/reference kanıt ile oyun sahnesi kanıtı ayrı artefact'tir:

- `g10-relief-full-world-topdown.png` yalnız semantic/reference top-down;
- `artifacts/nw-g10-relief-visual/g10-relief-full-world-3d-topdown.png` gerçek runtime terrain mesh,
  water, üretim PBR ve uygun vegetation içeren kullanıcıya gösterilecek "tepeden harita"dır.

Gerçek kanıt 1536x1024 tek kareye bütün world bounds'u sığdıran tam 90° aşağı bakan
`THREE.OrthographicCamera` kullanır. Eğik Perspective veya semantic reconstruction bunun yerine
geçmez. Üretim yüksekliği sabit eğik güneş, shadow/AO ve normals ile okunur; grid/helper overlay
kapalıdır.

Companion metadata en az `cameraType=OrthographicCamera`, `topDownDegrees=90`, world bounds,
source/runtime SHA-256, render SHA-256, `visibleGeoCellOverlay=false`, dimensions, nonblank
coverage ve `consoleErrors=[]` taşır. `checkNWG10FullWorld3DTopdown.mjs` veya aynı sözleşmenin
güncel checker'ı; eksik/küçük/blank frame, yanlış kamera, eksik dünya, console/page/network error,
checksum yokluğu, görünür grid/seam, cyan ocean artefactı ya da okunmayan reliefte CI'ı düşürür.
Workflow PNG+JSON'u upload eder ve PR açıklaması gerçek before/after render ile error heatmap'i içerir.

Terrain3D veya HTerrain yalnız araç değildir: bu proje için **Terrain3D authoring + deterministik web runtime parity** hedef mimaridir; yine de nihai kabul ölçütü kaynak doğruluğu, doğal görünüm, performans ve güvenliktir.

## 7. Dört ajanın ortak tam-dünya görevi

Dört köşe ajanının tamamı bundan sonra aynı nihai hedefe çalışır: **64 GeoCell'in tamamını Terrain3D ile author edilmiş, komşularla dikişsiz, gerçekçi ve Three.js runtime'a deterministik bake edilmiş tek bir dünya haline getirmek.**

- **Buzul Muhafızı / NW:** Westeros kuzeyi, Lands of Always Winter, Wall çevresi, haritadaki büyük
  kuzey ridge/Frostfang-benzeri zincirler, batı adaları, wolfswood/temperate forest ve tundra/ice
  geçişi. Dağlar top-down gölgede bağlı kütle olarak okunur; düşük rakıma tekdüze beyaz boya sürülmez.
- **Şafak Kartalı / NE:** northern/eastern Essos, Shivering Sea adaları, kuzey orman/taiga kuşağı,
  steppe/Jogos Nhai geçişi ve Bone Mountains dahil büyük kuzey-güney/doğu mountain spine'ları.
  Rain-shadow okunur; kar yalnız enlem+irtifa+nem uygunsa çıkar.
- **Günbatımı Ustası / SW:** southern Westeros/Dorne, Stepstones, Summer Isles ve western Sothoryos.
  Dorne'da kuru/kızıl sırt ve seyrek scrub; ada/güneyde tropik orman; kıyıda shelf/reef. Küçük adalar
  korunur, turkuaz deniz sığlığı göl yapılmaz.
- **Kızıl Ufuk / SE:** eastern/southern Essos, Red Waste, Yi Ti, Jogos Nhai, doğu yüksek sıraları,
  Sothoryos/Ullthos. Dev dağ kuşakları geniş ayak izli ve kesintisiz; rain-shadow çölü, havzalar
  göl/nehri, sıcak güney yoğun jungle'ı besler; sıcak lowland'de sahte kar yoktur.

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
- Three.js oyun/PWA tam smoke testinde konsol hatası yok;
- source-map label/symbol false-positive'i, denizde lake geometry ve geçersiz river outlet sıfır;
- haritadaki büyük mountain-chain ve forest envelope'ları gerçek runtime sahnede ölçülebilir;
- kullanıcıya gösterilen tam-harita tepeden kanıt semantic değil gerçek 3D orthographic artefact;
- renderer/collider/water/road/settlement/vegetation tek live terrain sampler ile parity içinde.

## 8.1 Araştırma dayanakları ve sürüm sınırı

Bu kuralların teknik dayanağı aşağıdaki birincil/resmî kaynaklardır; görev, API'yi tahmin etmek yerine
kilitli sürüm davranışını ve ilgili dokümanı okur:

- [Terrain3D Heightmaps](https://terrain3d.readthedocs.io/en/stable/docs/heightmaps.html) ve
  [Import/Export](https://terrain3d.readthedocs.io/en/stable/docs/import_export.html):
  16/32-bit height, metre/scale/offset/spacing ve region verisi;
- Guérin vd., [*Gradient Terrain Authoring*](https://hal.science/hal-03577171/):
  elevation + gradient/ridge/valley constraint yaklaşımı;
- Barnes vd., [*Priority-Flood*](https://arxiv.org/abs/1511.04463):
  pit conditioning ve drenaj garantisi;
- Godot resmî [MultiMesh](https://docs.godotengine.org/en/stable/classes/class_multimesh.html) +
  [Visibility Ranges/HLOD](https://docs.godotengine.org/en/stable/tutorials/3d/visibility_ranges.html):
  spatial chunking, instancing ve uzak impostor;
- Three.js resmî [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html) +
  [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html):
  tam-dünya kanıtı ve web instance bütçesi.

Araştırma yeni bir upstream sürüm bulsa bile `terrain3d.lock.json` sessiz değiştirilmez. Yeni algoritma
önce fixture/baseline, determinism, map-fidelity, safety ve perf testli ayrı PR'da sürümlenir.

## 9. Görev çıktısı

Her tur sonunda görev adı, köşe, GeoCell, tamamlanan katman, başlangıç/bitiş kalite ölçüleri, kullanılan motor (`HTerrain`, `Terrain3D`, `Three.js runtime` veya kombinasyonu), Terrain3D bake/provenance bilgisi, değiştirilmiş dosyalar, testler, görsel etki, seam ölçümü ve sonraki hücre kaydedilir. Kanıtsız `PASS` veya `DONE` yazılmaz.
