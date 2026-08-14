# Westeros World Editor

Tarayıcı içinde çalışan, ana oyundan ayrılmış 3D authoring katmanıdır. Amaç Unity/Blender benzeri temel dünya yerleştirme işlerini herhangi bir masaüstü editörüne bağlı kalmadan `editor.html` üzerinden yapmaktır.

## Açılış

Projeyi mevcut HTTP sunucusuyla çalıştırın ve `/editor.html` adresini açın. ES module ve model loader'ları nedeniyle `file://` yerine HTTP origin kullanılmalıdır. Editör mevcut vendored Three.js, OrbitControls, GLTFLoader ve FBXLoader dosyalarını kullanır; CDN gerektirmez.

## İlk sürüm özellikleri

- Three.js 3D viewport + OrbitControls.
- Asset kategorileri ve arama.
- Repo içindeki GLB/GLTF ve FBX dosyalarını aynı asset manager üzerinden yükleme.
- Tıklayarak obje seçme, Hierarchy ve X/Y/Z Inspector.
- Kopyalama (`Ctrl/Cmd+D`) ve silme (`Delete`).
- Grid görünürlüğünü bağımsız aç/kapatma.
- 1 metre varsayılan snap; snap ve grid birbirinden bağımsızdır.
- `westeros-world.scene.json` indirme ve JSON yükleme.
- Aynı statik mesh'i çok sayıda tekrar için `THREE.InstancedMesh` formasyonu. Varsayılan 20×25 = 500 instance üretilebilir ve tek model dosyası yeniden indirilmez.
- Responsive HTML/CSS editör arayüzü.

## Asset registry

`src/3d/editor/editorAssetLibrary.js` editörde görünen asset kayıtlarını tutar. `format` alanı `glb`, `gltf`, `fbx` veya editör doğrulama primitive'leri için `primitive` olabilir. Gerçek asset yolu `src` alanında repo-relative tutulur.

## Scene JSON kontratı

`schemaVersion: 1` sahne formatıdır. Normal objeler `objects`, GPU-instance grupları `instanceGroups` altında tutulur. Transform değerleri Three.js koordinat sisteminde metre/radyan/ölçek sırasıyla saklanır. Runtime oyun entegrasyonu bu JSON'u doğrudan simülasyon state'i olarak değil, güvenli bir import/adaptation katmanı üzerinden okumalıdır.

## Instancing notu

`THREE.InstancedMesh` statik veya normal `Mesh` kaynakları için kullanılır. Rigged `SkinnedMesh` karakterler bu ilk sürümde GPU instance formasyonuna bilinçli olarak alınmaz; aynı dosyanın 500 kopyasını depolamak yine gereksizdir, fakat 500 animasyonlu asker için ayrı bir skinned-crowd batching/animation-texture çözümü gerekir. Bu ayrım yanlış performans vaadi vermemek için açıktır.

## TransformControls yol haritası

Repo Three.js r160 kullanıyor ancak `src/3d/vendor/three/addons/controls/TransformControls.js` henüz vendored değildir. Editör shell ve JSON/asset/selection/instancing temeli mevcut oyun dosyalarına dokunmadan kurulmuştur. Bir sonraki güvenli alt görev aynı r160 TransformControls addon'unu local vendor ağacına ekleyip W/E/R translate/rotate/scale gizmosunu ve 1 m translation snap'i Inspector ile çift yönlü bağlamaktır.

## Oyun sınırı

Editör `game3d.js`, 2D oyun veya RTS simulation ownership'ini değiştirmez. Editörün çıktısı JSON authoring verisidir. Oyun runtime adapter'ı ayrı bir alt görevdir; böylece editördeki bir hata mevcut oynanışı etkilemez.
