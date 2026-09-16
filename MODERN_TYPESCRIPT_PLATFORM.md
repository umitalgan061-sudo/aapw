# Modern TypeScript Platform

## Amaç

AAPW'nin mevcut JavaScript tabanlı oyun kodunu tek gecede kırmadan TypeScript-first bir runtime mimarisine taşımak.
Bu geçişte dünya içeriği, mevcut Three.js entegrasyonu ve PWA yüzeyi korunurken yeni sistemlerin sözleşmeleri
strict TypeScript ile tanımlanır. Eski modüller yeni modüllere bir uyumluluk sınırı üzerinden bağlanır.

## Neden şimdi?

Repository bugün JavaScript ağırlıklı ve kök seviyede daha önce bir npm manifesti bulunmuyordu. Bu durum doğrudan
kullanıcı deneyimini bozmasa da tip denetimi, tek komutla reproducible build, bağımlılık güvenliği ve ölçeklenebilir
modül sınırları açısından teknik borç yaratıyordu.

Bu turda seçilen teknoloji hattı:

- Node.js 24 LTS: üretim ve CI için stabil çalışma zamanı.
- TypeScript 7 strict: uygulama kodu için statik tip sistemi.
- Vite 8.x / Rolldown: modern ESM geliştirme ve üretim paketleme.
- Vitest 5.x: hızlı, TypeScript-native birim ve kontrat testleri.
- Native ESM: yeni modüllerde CommonJS olmadan tek modül modeli.

Node.js 24.21.0, 2026-09-09 itibarıyla LTS hattındadır. Node.js 26.8.2 aynı tarihte Current hattındadır;
üretim CI'sinde LTS tercih edilmiştir. Vite 8 serisi Rolldown tabanlıdır ve Mart 2026'dan beri modern bundler
mimarisinin ana hattını oluşturur. TypeScript 7.0.x 2026 itibarıyla güncel kararlı major sürümdür.

## Katmanlar

### 1. `types.ts`

Tüm alt sistemlerde paylaşılan veri sözleşmeleridir. `EntityId`, `FrameId` ve `WorldSeed` branded type'ları,
aynı primitive değerlerin yanlış API'lere geçirilmesini azaltır. `Result<T, E>` tipi beklenen runtime hatalarını
exception ile kontrolsüz biçimde yaymak yerine açıkça taşır.

Bu katmanda Three.js sınıfları kullanılmaz. `Vec3`, `Quaternion`, `CameraState`, `PressureState`, `RenderCapabilities`
ve diğer DTO'lar yalnızca veri taşır. Böylece worker veya server tarafına taşınmaları ileride mümkündür.

### 2. Determinism

`deterministic.ts` çağrı sırasına bağlı olmayan counter-based örnekleme sağlar. Dünya süslemeleri, procedural nüfus
ve replay kayıtları aynı seed + index birleşiminden aynı sonucu üretir. `stableStringify` anahtarları sıralayarak
JSON kaynaklı sahte checksum farklılıklarını engeller.

Deterministik modüller `Math.random()` veya doğrudan `Date.now()` kullanmaz. Zaman gerekiyorsa `FixedStepClock` gibi
kontrollü saatler geçirilir. Böylece aynı komut günlüğü aynı başlangıç state'i ile tekrar oynatıldığında aynı sonuç
beklenebilir.

### 3. Eventing

`TypedEventBus` mevcut sistemlerin basit publish/subscribe modelini korur fakat event payload'larını statik olarak
tipler. Listener kapasitesi sınırlıdır; bu, UI veya scene teardown sırasında fark edilmeyen listener sızıntılarının
sınırsız büyümesini engelleyen bir güvenlik valfidir.

Handler exception'ları diğer listener'ların çalışmasını durdurmaz. `once()` otomatik unsubscribe sağlar. `snapshot()`
debug panellerinin listener büyümesini takip etmesine izin verir.

### 4. State

`ModernStateStore` state mutationlarını doğrular ve snapshotları kopyalar. `loadProgress`, `fps` ve `frameMs`
gibi alanlarda NaN veya anlamsız aralıklar kabul edilmez.

State erişimi primitive `get/set` fonksiyonları üzerinden yürür. `snapshot()` ile persistence, telemetry veya debug
katmanına mutable object referansı taşınmaz.

### 5. Runtime scheduler

`RuntimeScheduler`, frame başına hem görev sayısı hem CPU bütçesi uygular. Her görev priority, affinity ve estimated
cost bildirir. Planlayıcı önce explicit priority'yi, sonra tahmini maliyeti ve deterministik insertion sırasını
kullanır.

Bu model şu anki modüler oyun altyapısı için önemlidir: terrain streaming, animation update, persistence flush ve
render hazırlığının hepsinin aynı frame'i sınırsız tüketmesi engellenebilir.

`DeterministicRuntimeLoop` fixed-step clock ile gerçek duvar saatini ayrıştırır. Çok büyük browser gecikmeleri tek
frame'de yüzlerce simulation step çalıştırmak yerine clamp edilir.

### 6. Input

`InputRouter` keyboard, touch, pointer, gamepad ve virtual controls için aynı action modelini kullanır. Bu sayede
oyuncu hareketi cihaz tipine göre farklı event formatlarına bağımlı kalmaz.

Action kayıtları DOM event'i değil kullanıcı niyetidir. `InputRecorder` bunları zaman sırasına koyup checksum üretir.
`createReplayCursor` aynı action dizisini daha sonra yeniden oynatabilir.

Bu, özellikle aşağıdaki hataları araştırırken faydalıdır:

- mobil ve desktop giriş davranışlarının ayrışması,
- tuş tekrarından kaynaklanan iki kere uygulama,
- touch joystick ile keyboard arasında farklı hareket ölçekleri,
- performans probleminde frame içindeki kullanıcı niyetinin yeniden üretilememesi.

### 7. Persistence

`SaveSystem` versioned envelope kullanır. Her kayıt schema, version, creation timestamp ve checksum taşır.
Migration fonksiyonları eski save sürümlerini yeni domain modeline kademeli dönüştürür.

LocalStorage varsayılan küçük ortam fallback'idir. Adaptör sözleşmesi IndexedDB veya başka bir durable backend'e
geçişe hazırdır. Böylece oyun state'i taşıyan domain kodu storage teknolojisine bağlanmaz.

Save yükleme sonucu `Result<T>` döner. Bozuk checksum, yanlış schema ve eksik migration ayrı hata kodları olarak
izlenebilir.

### 8. Resource registry

`ResourceRegistry` assetleri ref-counted hale getirir. Texture, mesh, animation, audio veya JSON fark etmeksizin
aynı lifecycle modeli kullanılabilir.

Resident memory bütçesi aşıldığında kullanılmayan kaynaklar en eski kullanım zamanına ve priority'ye göre evict edilir.
Loader adapter sayesinde gerçek Three.js loader'ları daha sonra doğrudan bağlanabilir.

Bu katman mevcut `AssetLoader` modülünü bir anda değiştirmek için değil, asset lifecycle sözleşmesini modernleştirmek
ve ileride streaming worker'ına taşımak için oluşturuldu.

### 9. Rendering capability + adaptive quality

`negotiateRenderCapabilities()` WebGPU'yu sadece API var diye değil gerçek adapter/device kurulumu başarılı olduğunda
aktif eder. Başarısız WebGPU denemesi WebGL2'ye kontrollü fallback yapar.

`calculatePressure()` CPU, GPU, frame, memory ve thermal pressure'ı tek bir bounded score'a dönüştürür.

`AdaptiveQualityController` quality tier değişimlerini hysteresis + dwell ile kontrol eder. Böylece 0.61 / 0.62 gibi
sınır değerlerinde her frame kalite değiştirmez. `qualityDecision()` tier'dan render scale, shadow ve effect seti üretir.

### 10. Frame graph

`FrameGraphBuilder` render kaynaklarını ve pass'leri declarative olarak tanımlar. Kaynak yazan pass ile okuyan pass
arasındaki dependency çıkarılır. Cycle tespit edilir ve transient kaynakların aynı anda canlı olan bölümlerinin peak
memory maliyeti hesaplanır.

Bu model, mevcut büyük render orchestrator'ının üzerine zamanla gerçek Three.js/WebGPU pipeline bağlantıları kurmak
için bir sözleşme görevi görür.

### 11. Render frame packet

`RenderFrameBuilder` immutable bir frame packet üretir. Draw item'lar deterministic sıraya sokulur; transparent ve
opaque işlerin ayrımı explicit tutulur. Paket checksum'ı telemetry veya replay testlerinde frame kaynaklı
non-determinism'i tespit etmek için kullanılabilir.

Renderer katmanı bu paketi Three.js veya WebGPU command encoder'a çevirebilir. Böylece oyun state'i ile render API'si
birbirine doğrudan karışmaz.

### 12. ECS + command journal

`EntityWorld` position, velocity, health ve active gibi sparse component store'ları kullanır. Snapshot ve checksum
fonksiyonları deterministik debug sağlar.

`CommandJournal` kullanıcı/AI niyetini state mutation'ından ayırır. Her command explicit tick taşır. Reducer'lar
kaydedildikten sonra aynı command dizisi yeniden oynatılabilir. Bu yapı ileride multiplayer authority veya replay
sisteminin tabanı olabilir.

### 13. Streaming

`StreamingPlanner`, mevcut chunk sisteminin yerine tek başına geçmez. Önce load/retain/unload kararının deterministik,
bounded ve hysteretic sözleşmesini tanımlar.

Load radius ile unload radius ayrımı sayesinde hareket eden kamera kenarında sürekli load/unload churn oluşmaz. Per-frame
load/unload bütçeleri ağ, disk ve GPU upload patlamalarını sınırlar.

### 14. Worker bridge

`WorkerBridge`, request/response ID'leriyle worker işlerindeki timeout ve hata sınırını tanımlar. Worker transportu
DOM Worker'a bağlanabilir ama sözleşme worker türünden bağımsızdır.

Bu sayede yüksek maliyetli terrain generation, path planning, navmesh hazırlığı veya asset parsing daha sonra
OffscreenCanvas / Dedicated Worker'a taşınabilir.

### 15. Diagnostics

`Diagnostics`, console log'larını tek başına gözlem mekanizması olmaktan çıkarıp bounded, export edilebilir bir sağlık
modeli sağlar. `HealthReport` error/warning sayılarını, 0-100 health score'u ve digest'i içerir.

Bu skor karar vermek için değil gözlem içindir. Production runtime ileride telemetry endpoint'ine yalnızca izin verilen
özeti gönderebilir.

## Geçiş stratejisi

Geçiş dört aşamada ilerlemelidir.

**Aşama A — foundation.** Yeni çekirdek sözleşmeler TS ile yazılır. Legacy JS runtime aynı şekilde çalışır.

**Aşama B — adapting.** `LegacyRuntimeBridge`, eski `GameState` ve renderer nesnelerini modern servislerle bağlar.
Eski API'ler bir anda kaldırılmaz.

**Aşama C — parity.** Her yeni TS modülünün gerçek legacy davranışını kapsayan contract testleri yazılır.
Determinism, snapshot ve replay testleri burada zorunludur.

**Aşama D — cut-over.** Yetki modern TS modülüne geçtiğinde migration manifest üzerindeki hedef `cut-over` yapılır.
Eski JS dosyası yalnızca başka consumer kalmadığı kanıtlandıktan sonra kaldırılır.

## Güvenlik ve dayanıklılık

Asset URL doğrulaması manifest seviyesinde yapılır. İzin verilen protokoller, maksimum URL uzunluğu, same-origin
kuralı ve asset byte bütçesi tek policy üzerinden kontrol edilir.

Runtime scheduler ve resource registry bounded yapılmıştır. Bounded olmak performansın her zaman yüksek olacağı
anlamına gelmez; önemli olan sistemin kötü durumda bile kontrolsüz büyümemesidir.

Persistence checksum'ları saldırı tespiti için kriptografik imza değildir. Amaç uygulama içindeki bozuk/kısmi kayıtları
ayıklamaktır. Güvenilmeyen çok oyunculu data için daha güçlü doğrulama katmanı ayrıca eklenmelidir.

## Test yaklaşımı

Vitest suite'i deterministic primitives, typed event bus, ECS query, command replay, frame graph, streaming, motion
state machine, adaptive quality, telemetry, render packets, persistence, resource lifecycle ve diagnostics yüzeylerini
kapsar.

Testler gerçek browser API'sine bağımlı olmayan saf domain modüllerini Node ortamında çalıştırır. Browser'a özgü
capability probing üretim runtime'ında çalışır ve uygulama seviyesinde smoke test ile tamamlanmalıdır.

## CI kapıları

`modern-typescript-platform.yml` şu sıralamayı uygular:

1. Node 24 kurulumu.
2. Dependency install.
3. Modern manifest doğrulaması.
4. TypeScript strict typecheck.
5. Vitest suite.
6. Vite production build.
7. Deterministik kaynaklarda `Math.random()` ve `Date.now()` guard.

Bunlar legacy bütün repository'nin tek seferde TS'e çevrildiği anlamına gelmez. Ama artık yeni modern platform
kodunun kalitesiz bir JS adası olarak büyümesini engeller.

## Gelecek cut-over hedefleri

İlk gerçek migration adayı `eventBus.js` + `state.js` kombinasyonudur; bunlar bağımlılık grafiğinin tabanında olduğundan
küçük davranış farkları bile bütün runtime'ı etkileyebilir. Sonraki aday input, asset lifecycle, chunk streaming ve
render policy katmanlarıdır.

`game3d.js` en son taşınmalıdır. Dosya mevcut runtime'ın composition root'u olduğu için doğrudan yeniden yazmak, bug
alanını gereksiz yere büyütür. Modern runtime önce servis sözleşmesi olarak onun etrafında stabilize edilmelidir.

## Operasyon notları

Bir yeni TS modülü eklenirken:

- Three.js sınıfını domain kontratına sokma.
- Global singleton kullanımını minimumda tut.
- Deterministic sistemlerde wall clock/random erişimini doğrudan kullanma.
- Her sınırsız koleksiyon için kapasite veya eviction modeli düşün.
- Save/network/replay gibi dış sınırlar için version + checksum ekle.
- Browser API'sini domain koduna değil adapter'a koy.
- Her yeni scheduler işi için priority ve estimated cost yaz.
- Render paketini immutable tut.

Bu kurallar performans optimizasyonundan önce sistemin kontrol edilebilirliğini korur. Büyük dünya + canlı NPC + fauna +
render streaming kombinasyonunda bu sınırlar sonradan düzeltme maliyetini ciddi biçimde azaltır.
