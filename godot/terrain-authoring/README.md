# Westeros Terrain Authoring

Bu klasör mevcut HTML/JavaScript/Three.js oyundan izole bir Godot authoring çalışma alanıdır. Web/PWA oyununun yerine geçmez; HTerrain ve Terrain3D ile heightmap, splat/texture, detail/grass, yüksek çözünürlüklü kıyı/hidrografi ve LOD verisi üretmek için kullanılır.

## Açılış

1. Godot 4.6.x ile bu klasördeki `project.godot` dosyasını aç.
2. İlk kurulumda `python3 godot/terrain-authoring/tools/install_terrain3d.py` çalıştır. Script TokisanGames tarafından yayınlanan kilitli resmi Terrain3D binary release'ini indirir, SHA256 doğrular ve `addons/terrain_3d` altına kurar.
3. `Heightmap Terrain` ve `Terrain3D` eklentileri proje ayarından etkinleşir. Godot arayüzünde karşılığı `Project -> Project Settings -> Plugins` altında ikisinin de Enabled olmasıdır.
4. Terrain3D kurulumundan sonra Godot'u/reload current project'i yeniden başlat.
5. Ana sahne `scenes/westeros_terrain_authoring.tscn` olarak açılır.
6. Mevcut HTerrain node'u ve terrain_data zinciri korunur; Terrain3D ikinci authoring motoru olarak kontrollü/geçişli kullanılır.

## Terrain3D upstream ve kilit

- Yetkili kaynak: `TokisanGames/Terrain3D`.
- Godot Asset Library: `3892`.
- Sürüm, release asset ve SHA256 `terrain3d.lock.json` içinde pinlidir.
- Zamanlanmış görevler upstream son sürümü `python3 godot/terrain-authoring/tools/install_terrain3d.py --check-upstream` ile okuyabilir; fakat otomatik/sessiz upgrade yapamaz.
- Detaylı otonom terrain kuralları: `TERRAIN_AUTOMATION_RULES.md`.
- Dört köşe görev koordinasyonu: `four_corner_ledger.json`.

## Hazır araçlar

- HTerrain Heightmap: Raise, Lower, Smooth, Flatten, Level ve Erode.
- HTerrain texture painting: başlangıç için çim, toprak, kaya ve kar olmak üzere dört Classic4Lite katmanı.
- HTerrain grass/detail: `HTerrain/GrassDetailLayer` ve ilk detail map hazırdır; density map terrain fırçasıyla boyanabilir.
- Terrain3D: GPU clipmap terrain, çoklu texture painting, heightmap import, LOD, foliage instance LOD, holes, renk/wetness ve yüksek çözünürlüklü bölgesel authoring araçları.
- Collision: mevcut HTerrain collider Terrain Data ile birlikte güncellenir; Terrain3D collision kullanımı ayrı doğrulama olmadan production fiziğinin yerine geçirilmez.
- Determinizm: başlangıç grass detail layer sabit seed kullanır; Terrain3D kullanan otomasyonlar da aynı determinism ve güvenlik kapılarına tabidir.

Başlangıç dokuları yalnız authoring projesinin kullanılabilir bir ilk durumla açılması içindir. Texture Editor üzerinden gerçek proje dokuları eklendiğinde bootstrap mevcut texture slotlarını değiştirmez. Mevcut Terrain Data bulunduğunda da yükseklik veya detail verisi yeniden oluşturulmaz.
