# Westeros Terrain Authoring

Bu klasör mevcut HTML/JavaScript/Three.js oyundan izole bir Godot authoring çalışma alanıdır. Web/PWA oyununun yerine geçmez; HTerrain ile heightmap, splat/texture ve detail/grass verisi üretmek için kullanılır.

## Açılış

1. Godot 4.6.x ile bu klasördeki `project.godot` dosyasını aç.
2. `Heightmap Terrain` eklentisi proje ayarından otomatik etkinleşir.
3. Ana sahne `scenes/westeros_terrain_authoring.tscn` olarak açılır.
4. Sahnedeki `HTerrain` node'unu seç. İlk açılışta `res://terrain_data` altında varsayılan 513x513 Terrain Data oluşturulur.

## Hazır araçlar

- Heightmap: Raise, Lower, Smooth, Flatten, Level ve Erode.
- Texture painting: başlangıç için çim, toprak, kaya ve kar olmak üzere dört Classic4Lite katmanı.
- Grass/detail: `HTerrain/GrassDetailLayer` ve ilk detail map hazırdır; density map terrain fırçasıyla boyanabilir.
- Collision: HTerrain collider Terrain Data ile birlikte güncellenir.
- Determinizm: başlangıç grass detail layer sabit seed kullanır.

Başlangıç dokuları yalnız authoring projesinin kullanılabilir bir ilk durumla açılması içindir. Texture Editor üzerinden gerçek proje dokuları eklendiğinde bootstrap mevcut texture slotlarını değiştirmez. Mevcut Terrain Data bulunduğunda da yükseklik veya detail verisi yeniden oluşturulmaz.
