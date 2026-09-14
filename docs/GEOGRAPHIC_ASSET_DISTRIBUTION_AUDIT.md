# Şafak Kartalı — Geographic Asset / Material / Placement Audit

## 1. Turun amacı

Bu çalışma, yaşayan dünya sistemine yeni bir NPC/faction framework'ü eklemek için yapılmadı. Mevcut Three.js üretim zincirindeki görsel boşluğu hedefliyor: gerçek model ailelerinin doğru coğrafyada görünmesi, ground/water/slope/road/settlement bağlamının korunması ve model materyallerinin tek yüzeye indirgenmemesi.

Tur başlangıcında canlı `origin/main` exact head'i yeniden okundu. Bu dosya, o anki canonical dünya sözleşmelerini özetler; tarihsel SHA'ları yeni tur için otorite kabul etmez.

## 2. Mevcut coğrafya otoriteleri

`src/3d/world/worldReferenceMap.js` sahibi tarafından verilen 1536×1024 referans görüntüsünün normalize koordinat uzayını canonical kaynak kabul ediyor. X ekseni batıdan doğuya, Y ekseni kuzeyden güneye. Referans map SHA-256'sı kod içinde pinlenmiş durumda.

`REFERENCE_BIOME_ZONES` içinde kar, soğuk çayır, bataklık, dağ, kayalık tepe, verimli çayır, çöl, kıyı, step, arid, orman/jungle gibi bölgeler zaten tanımlı. Su ve relief zincirleri de aynı referans uzayında tutuluyor.

`src/3d/world/worldReferenceAlignment.js` aynı referansı 9000×7000 2D map canvas'a bağlıyor. Böylece üç ayrı dünya dönüşümü icat etmek yerine mevcut map→world dönüşüm tekrar kullanılıyor.

Bu durum önemli: asset placement katmanı yeni bir koordinat sistemi üretmemeli. Asset seçimi önce canonical geography'den, world konumu sonra mevcut alignment'tan gelmeli.

## 3. Haritada bulunan fakat görsel nüfusta eksik kalan katman

Mevcut canlı dünyada gerçek karakter asset'leri var. `peasant_girl.fbx`, `paladin_j_nordstrom.fbx` ve `erika_archer.fbx` gibi kaynaklar service worker shell graph içinde de görülebiliyor. Buna rağmen asset path'in var olması, asset'in doğru coğrafi profile sahip olduğu anlamına gelmiyor.

Önceki zincirlerde NPC/animal/creature/dragon üretimi daha çok entity davranışı ve güvenli spawn üzerine yoğunlaşıyor. Bu turda tespit edilen görsel boşluk, aynı gerçek asset ailesinin bölgeye göre seçilip placement manifest ile izlenmemesi.

Bu nedenle yeni director dört şeyi birlikte taşıyor:

1. canonical biome kimliği;
2. gerçek model kaynağı;
3. ground/road/settlement/water/slope sonucu;
4. material assignment ve texture provenance.

Bu dört veri olmadan bir karakterin doğru yerde olduğu söylenemez.

## 4. Neden settlement ring kullanılıyor

Ambient insan nüfusu settlement'ın tam merkezine basılmamalı. Merkez zaten yapı, yol, kapı, kale, quest/NPC ve collision objeleriyle kalabalıklaşıyor. Bunun yerine 108–238 metre arası deterministic bir ring kullanılıyor. Ayrıca 88 metreye kadar settlement-core dışlama uygulanıyor.

Bu iki mesafe aynı işi yapmıyor. İlki aday üretim bandı; ikincisi kabul sırasında güvenlik tamponu. Böylece küçük bir yerleşimde NPC duvarın içine, büyük bir kale alanında ise kapı eşiğine düşmüyor.

## 5. Road tamponu

Road ribbon canonical hareket ağının görsel ve fiziksel omurgası. Ambient karakter yolun tam üstüne basarsa doğal görünmez ve ileride navigation ownership çakışması çıkar. Bu nedenle 4 metre minimum road mesafesi uygulanıyor.

Road edge girdisi yoksa director yeni bir yol üretmiyor. Bu önemli bir sahiplik kuralı: mevcut road authority ne veriyorsa placement katmanı onu tüketiyor.

## 6. Ground ve slope

Ground örneği canonical `groundCollider.getGroundHeight()` üzerinden alınıyor. Aday kabul edilmeden önce aynı noktaya küçük finite-difference örnekleri uygulanıp slope derecesi hesaplanıyor. 24 derecenin üzeri ambient insan için fail.

Buradaki amaç görsel kalite kadar fiziksel inandırıcılık. 25–40 derece gibi yamaçlarda duran farmer, peasant veya guard oyuncuya hemen “spawn edildi” hissi verir. Aşırı eğimin reddedilmesi daha pahalı procedural düzeltmelerden önce en ucuz doğrulama.

Ground örneği finite değilse aday reddediliyor. Director bunu düz bir fallback zeminle gizlemiyor.

## 7. Water

Water level canonical `WORLD_DEFAULTS.WATER_LEVEL_METERS` üzerinden okunuyor. Ambient karakter için 0.02 metre üzeri su derinliği doğrudan reject.

Denizin ortasında NPC üretmek veya kıyıda ayak bileği kadar gömülü karakter kabul etmek yerine fail-closed yaklaşım kullanılıyor. Suya yakın ama su üstünde olmayan adaylar yine slope/road/settlement filtrelerinden geçiyor.

## 8. Biome→asset ilişkisi

Yeni dağıtım sözleşmesi bölgeyi yalnızca renk etiketi olarak değil, gerçek asset ailesi seçimi olarak kullanıyor.

### Permanent winter / snow

Kuzeyde soğuk ekipmanlı `paladin_j_nordstrom.fbx` gibi zırhlı/koruyucu profil öne çıkıyor. Peasant profili yasaklı görsel seçenek olarak işaretleniyor. Böylece kar biyomunda yazlık/yeşil çayırlık karakter dağılımı azaltılıyor.

### Cold grassland

Guard ile worker arasında geçiş yapılabiliyor. Burada hem soğuk bölge karakteri hem de kuzey yerleşim işçisi mantıklı.

### Marsh

Düşük zemin, su ve bataklık dokusu nedeniyle daha sakin settlement-worker profili kullanılıyor. Ağır şövalye profili görsel olarak gereksiz.

### Mountain / rocky hills

Yüksek relief ve taş ağırlıklı alanlarda guard/scout profilleri; görünür yırtıcı habitatında wolf gibi fauna profilleri kullanıma açık.

### Reach / lush grassland / temperate coast

Peasant ve ranger profilleri ana ambient insan aileleri. Kıyıda guard da mümkün, fakat bölgeyi tamamen şövalye kalabalığına dönüştürmemek için dağıtım dar tutuluyor.

### Desert / arid / steppe

Frontier scout/ranger sınıfı baskın. Yeşil çayır worker'ı gibi uygunsuz asset ailesi yasaklı.

### Jungle

Peasant ve scout birlikte destekleniyor. Wolf/dragon gibi mevcut gerçek fauna kaynakları için ayrı habitat profilleri de aynı sözleşmede yer alıyor.

## 9. Asset-first kuralı

Director primitive box/capsule/placeholder kullanmıyor. Önce gerçek asset yolu resolve ediliyor. `AssetLoader.loadFBXModel()` gerçek dosya ile çağrılıyor; LFS pointer kalmışsa proof katmanı bunu ayrı problem olarak yakalıyor.

Bir asset eksikse sahneye sahte model koymak yerine placement reject ediliyor. Böylece “3D sahnede obje var” ile “doğru asset sahnede” birbirinden ayrılıyor.

## 10. Material-first kuralı

İyi authored material varsa korunuyor. Director bütün modeli tek bir bölgesel renge boyamıyor.

Yalnız material/map yoksa `MaterialAssignmentCore.autoAssignMaterials()` fallback'i kullanılıyor. Sonrasında `validateMaterialAssignment()` çalışıyor ve `createMaterialManifest()` ile kanıt üretiliyor.

Human için hedef yüzey dili skin/hair/eyes/clothing/boots/gear; horse için coat/mane/tail/hoof/saddle/harness; wolf/creature için fur/eye/claw/tooth; dragon için scale/wing/eye/horn/claw.

Bu turdaki asset director gerçek imported slot'ları bozmak yerine provenance kaydı oluşturuyor. Bir sonraki creature/fauna genişlemesi aynı çekirdeği kullanmalı.

## 11. Named-part ve layered fallback

Asset tek mesh veya tek material olduğunda tek renk bırakmak kabul edilmiyor. Shared core'un named/layered yaklaşımı kullanılmalı. Bu turda human/horse/wolf/dragon surface vocab testleri ayrıca eklendi.

Bu testler gerçek kaynak modelin “hangi isimleri içerdiğini” uydurmuyor. Bunun yerine material engine'in named/layered contract'ı bozulmadan çalıştığını fixture üzerinde doğruluyor. Gerçek FBX proof ise ayrı browser testinde yapılacak.

## 12. Deterministic placement

Aday açı, yarıçap ve ölçek stable FNV-1a benzeri hash akışından geliyor. `Math.random()` kullanılmıyor.

Seed + settlement id + candidate index aynı kaldığı sürece aynı placement planı üretiliyor. Bu hem görsel yeniden üretilebilirlik hem de world event determinism açısından önemli.

Farklı seed aynı tüm sonuçları üretmemeli; testte bunun da kontrollü divergence şartı bulunuyor.

## 13. Population LOD

Director tam NPC behavior tick'i çalıştırmıyor. Bu intentionally render-only ambient layer. Her 0.20 saniyede bir uzaklık değerlendirmesi yapıp 700/920 metre hysteresis kullanıyor.

700 ve 920'nin ayrı olması sınır titreşimini önlüyor. Uzak nüfus görünürlükten kaldırılıyor; yeni AI tick framework'ü yaratılmıyor.

Desktop bütçesi 12, mobile bütçesi 5. Bu değerler “ne kadar çok NPC o kadar iyi” düşüncesi yerine PWA/telefon performansına bağlı görsel yoğunluk hedefli.

## 14. Mevcut owner'larla sınırlar

Bu tur özellikle `sceneManager.js`, `livingWorldSpawner.js`, `vegetation.js`, `creatureSpawner.js`, animal configuration, service worker ve diğer açık PR production lane'lerine yeniden implementasyon yapmıyor.

Yeni director yalnız mevcut canonical state'i consume eden bir adapter katmanı olarak tasarlandı. Runtime entegrasyonu yapılırken game3d tick/lifecycle noktası kullanılmalı; scene construction veya existing fauna controller'ın yerine geçirilmemeli.

Service worker owner lane'i de bu turda değiştirilmedi. Yeni modülün offline shell'e eklenmesi ayrı bir PWA ownership kararıdır ve mevcut owner'ın contract'ı korunarak yapılmalıdır.

## 15. Mevcut harita/asset zincirindeki gerçek boşluk

Bu incelemenin en net sonucu şudur:

- Map geography canonical ve oldukça geniş.
- Water/relief/cryosphere gibi alt sistemler referans map'ten zaten besleniyor.
- Real character assets mevcut.
- Material core mevcut.
- Placement core mevcut.
- Ancak bu parçaların hepsini “ambient visual population” için tek bir geographic provenance kaydında birleştiren runtime adapter yok.

Bu yüzden eksik parça yeni bir framework değil; mevcut sistemler arasında düzgün bir tüketici/adapter.

## 16. Proof standardı

Director için PASS sayılacak minimum görsel/teknik proof şunları içermeli:

- gerçek asset kaynağı ve file hydration sonucu;
- mesh ve material surface sayısı;
- texture map boyutları;
- authored vs layered fallback durumu;
- canonical biome id/kind;
- ground Y ve slope;
- road distance;
- settlement distance;
- water depth;
- placement manifest;
- missing/placeholder asset sayısı;
- console/page error sayısı;
- görünür NPC sayısı ve LOD sınırı.

Sadece authoring preview, bir mesh'in sahneye geldiğini gösterir; doğru coğrafi dağıtımı kanıtlamaz.

## 17. Sonraki teknik katman

Bu PR'ın güvenli hedefi önce geographic ambient humans. Sonraki aşama aynı distribution contract ile:

- horse/pack animal;
- wolf/pack fauna;
- creature habitat;
- dragon aerial habitat;
- ambient cart/traffic;

profillerini mevcut controller'lara adapter üzerinden bağlamak.

Özellikle fauna tarafında yeni spawn framework kurulmayacak. Mevcut `animalConfig`, `creatureBrain`, `dragonController` ve living-world spawn zincirleri authoritative kalacak.

## 18. Sonuç

Haritanın coğrafi görünümünü daha canlı kılmanın doğru yolu her bölgeye rastgele model serpiştirmek değil. Geography → habitat → asset family → material provenance → ground/water/slope validation → bounded visibility şeklinde tek yönlü bir zincir kurmak.

Bu turun eklediği geographic ambient director bu zincirin ilk insan/ambient halkasıdır. Asset yükleme, material assignment ve placement mevcut ortak çekirdeklerden geçtiği için ileride horse/wolf/creature/dragon genişlemesi aynı kanalı kullanabilir.

En önemli görsel kalite kuralı: bir assetin dosya olarak mevcut olması yeterli değildir; coğrafi olarak doğru, zemine oturmuş, su/road/settlement bağlamında makul ve materyal yüzeyleri birbirinden ayrışmış olmalıdır.
