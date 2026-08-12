# Terrain Automation Rules — Map.png + HTerrain + Terrain3D

Bu dosya, zamanlanmış/otonom zemin görevleri için zorunlu çalışma sözleşmesidir. Her terrain görevi `GOVERNANCE.md` sonrasında bu dosyayı ve `terrain3d.lock.json` dosyasını okumalıdır.

## 1. Değişmez görsel kaynak

- `map.png` (1536x1024) 3D coğrafyanın ana görsel doğruluk kaynağıdır.
- Amaç 2D görüntüyü zemine yapıştırmak değil; kıyı/deniz-göl sınırları, kara biyomları, kaya, kar, yükseklik karakteri ve yolları 3D fiziksel karşılıklarına dönüştürmektir.
- Harita yazıları, etiketler, arma/dekoratif işaretler terrain verisi sayılmaz.
- Her değişiklik ölçülebilir bir kaynak-eşleşme iyileştirmesi göstermelidir. Sadece estetik olarak farklı olmak yeterli değildir.

## 2. Terrain motorları birlikte kullanılacak

### HTerrain

- Mevcut `addons/zylann.hterrain/`, terrain_data, authored probes ve kabul edilmiş doğrulamalar korunur.
- Mevcut üretim/veri zinciri kanıtsız biçimde Terrain3D'ye topluca taşınmaz.

### Terrain3D

- Yetkili upstream: `TokisanGames/Terrain3D`.
- Godot Asset Library kimliği: `3892`.
- Kilitli sürüm ve SHA256 yalnız `terrain3d.lock.json` üzerinden okunur.
- Kurulum: `python3 godot/terrain-authoring/tools/install_terrain3d.py`.
- `project.godot` içinde `res://addons/terrain_3d/plugin.cfg` etkin olmalıdır; bu, Godot arayüzündeki `Project -> Project Settings -> Plugins -> Terrain3D = Enabled` durumunun proje dosyasındaki karşılığıdır.
- Zamanlanmış görevler gerektiğinde `python3 godot/terrain-authoring/tools/install_terrain3d.py --check-upstream` ile upstream son release bilgisini okuyabilir.
- Upstream değişti diye otomatik sürüm yükseltme YASAKTIR. Yeni sürüm ayrı PR'da Godot headless, determinism, performans, map-fidelity, yol ve 14 yerleşim güvenliği testlerinden sonra kilide alınır.
- Terrain3D; GPU clipmap/LOD, çoklu texture painting, heightmap import, foliage/instance LOD, holes ve daha yüksek çözünürlüklü kaynak eşleme gibi alanlarda tercih edilen ikinci authoring motorudur. Kullanım kararı her alt görevde fayda/risk ile gerekçelendirilir.

## 3. 4-köşe paralel geliştirme düzeni

Kaynak harita 8x8 adet **GeoCell**'e ayrılır. Her GeoCell 192x128 kaynak pikseldir. Böylece 1536x1024 map.png tam ve kayıpsız olarak 64 çalışma hücresine bölünür.

Koordinatlar: `gx=0..7` batıdan doğuya, `gy=0..7` kuzeyden güneye.

Dört ana ajan aynı anda başlar:

1. **Kuzeybatı — Buzul Muhafızı**: `(0,0)` köşesinden merkeze doğru.
2. **Kuzeydoğu — Şafak Kartalı**: `(7,0)` köşesinden merkeze doğru.
3. **Güneybatı — Günbatımı Ustası**: `(0,7)` köşesinden merkeze doğru.
4. **Güneydoğu — Kızıl Ufuk**: `(7,7)` köşesinden merkeze doğru.

Her ajan kendi köşesine Chebyshev/halka uzaklığı en küçük olan tamamlanmamış GeoCell'i seçer ve merkeze doğru ilerler. Aynı hücre başka bir ajan tarafından bitirilmişse iş yapmak için rastgele değiştirme yapmaz; mevcut kanıtı ölçer ve yalnız kalite skorunu artırabildiği durumda refinement PR'ı açar.

## 4. GeoCell kabul sırası

Bir hücre tek commit/PR'da devasa biçimde yeniden yazılmaz. Aşağıdaki katmanlar sırayla ölçülür ve iyileştirilir:

1. **Coast/Hydrology** — deniz, göl ve kara sınırı.
2. **Macro Albedo/Biome** — map.png kara renk/bitki-toprak karakteri.
3. **Relief/Height Character** — dağ, ova, sırt, geçit; yerleşim/yol güvenliği bozulmadan.
4. **Rock/Snow** — kaynak konumuna ve relief/yüksekliğe bağlı dağılım.
5. **Road/Path** — referans yol izi + mevcut deterministic yol güvenliği.
6. **Near Detail** — normal/roughness/detiling/microvariation/foliage; uzaktan harita eşleşmesini bozmaz.

Bir üst katmana geçmek için önceki katman regresyon yapmamalıdır.

## 5. Çakışma ve buluşma kuralı

- Her görev başlangıcında `main` yeniden okunur; stale branch üstüne çalışma yapılmaz.
- İki ajan aynı GeoCell'e ulaştığında ilk hedef kod birleştirmek değil, **ölçüm birleştirmektir**.
- Daha yeni hücre kalite skoru, kaynak renk/semantic hatası, kıyı IoU/mesafe metriği ve görsel kanıt karşılaştırılır.
- İkinci ajan yalnız daha iyi ölçülebilir sonuç üretiyorsa değişiklik yapar; aksi halde sıradaki hücreye geçer.
- Aynı dosyayı paralel değiştirmek gerekiyorsa sorumluluk küçük veri/atlas/parça dosyalarına bölünür; ortak entegrasyon dosyası Merkez Hakemi görevine bırakılır.

## 6. Zorunlu doğrulamalar

Her terrain PR'ında uygun olanların tamamı çalıştırılır:

- exact-main / concurrency kontrolü;
- Godot 4.6.x headless import/editor;
- HTerrain mevcut doğrulamaları;
- Terrain3D kurulum + plugin load doğrulaması, Terrain3D kullanılıyorsa;
- map.png kaynak/hash ve GeoCell koordinat doğrulaması;
- deterministic tekrar üretim;
- 14/14 settlement terrain safety;
- road network safety;
- desktop/mobile performans bütçesi;
- tam browser smoke ve temiz console;
- en az yakın + uzak görsel kanıt ve mümkünse before/after.

Terrain3D veya HTerrain bir araçtır; testleri geçen daha doğru kaynak eşlemesi nihai ölçüttür.

## 7. Görev çıktısı

Her tur sonunda görev adı, köşe, GeoCell, başlangıç/bitiş kalite ölçüleri, kullanılan motor (`HTerrain`, `Terrain3D`, `Three.js runtime` veya kombinasyonu), değiştirilmiş dosyalar, testler, görsel etki ve sonraki hücre kaydedilir. Kanıtsız `PASS` veya `DONE` yazılmaz.
