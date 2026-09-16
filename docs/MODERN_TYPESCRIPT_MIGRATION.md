# AAPW Modern TypeScript Platform

## Amaç

Bu çalışma, mevcut Westeros uygulamasını tek seferde kırıp yeniden yazmak yerine, üretimdeki 2D/PWA ve 3D sahiplik sınırlarını koruyarak modern bir TypeScript çalışma çekirdeğine geçirmek için hazırlanmıştır.

Ana prensip: **önce sözleşmeler, sonra adaptörler, en son sahiplik devri**.

Bu nedenle yeni çekirdek mevcut `script.js`, mevcut 2D oyun fonksiyonları veya mevcut 3D renderer sahiplerinin yerine ikinci bir oyun motoru kurmaz. Yeni katmanlar, mevcut sahiplerin çağırabileceği deterministik ve test edilebilir politika/altyapı sağlar.

## Mevcut sistem

Uygulama uzun süredir tarayıcı merkezli JavaScript ile gelişmiştir. Ana 2D giriş noktası `index.html` + `script.js`, 3D alanı ise `src/3d` altındaki modüller ve `game3d.html` üzerinden çalışır.

Bu yapı hızlı prototiplemeyi kolaylaştırmış olsa da zamanla şu maliyetleri oluşturmuştur:

- global state ve global fonksiyon sayısının artması;
- implicit veri şekilleri;
- runtime hatalarının compile-time yakalanamaması;
- farklı sistemlerin frame/update sahipliğinin birbirine yaklaşması;
- cihaz yeteneklerinin merkezden değerlendirilememesi;
- deterministik replay/test kapasitesinin sınırlı olması;
- büyük dosyalarda güvenli refactor maliyetinin yükselmesi;
- offline/PWA durumlarının uygulama mantığıyla fazla iç içe olması.

Yeni platform bu problemleri modüler sınırlar ile azaltır.

## Modern teknoloji tabanı

### Dil

Yeni çekirdekte TypeScript kullanılır.

Derleyici sözleşmesi:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`
- ES2024 hedefi
- native ESM

### Build

Vite 8 tabanlı ESM build sistemi kullanılır. MPA girişleri legacy `index.html`, `game3d.html` ve modern `modern.html` olarak ayrılmıştır.

Çekirdek modüller ayrı chunk gruplarına ayrılabilecek şekilde tasarlanır:

- `core-runtime`
- `world-runtime`
- `gameplay-runtime`
- `audio-runtime`
- `vendor`

Bu ayrım lazy loading, cache invalidation ve analiz kolaylığı sağlar.

### Test

Vitest ile deterministik unit/contract testleri bulunur. Testler Node ortamında tarayıcıdan bağımsız çekirdek sözleşmeleri doğrular.

Coverage hedefleri ölçülebilir bir taban çizgisi oluşturur; bütün yeni modüller zamanla daha yüksek kapsam seviyelerine çıkarılabilir.

## Katmanlar

### Domain

`src/core/domain/contracts.ts`

Bu katmanda gameplay veya renderer sahipliği yoktur. Burada ortak veri sözleşmeleri bulunur:

- branded ID tipleri;
- vektörler;
- dünya ve krallık modelleri;
- runtime sonuç tipleri;
- immutable yardımcıları;
- numeric normalization;
- season progression.

Domain katmanı tarayıcıya bağlı tutulmaz.

### State

`ImmutableStore` reducer tabanlı ve kimlik değişikliği üzerine güncelleme yapan bir state çekirdeğidir.

Selector abonelikleri yalnızca seçilen değer değiştiğinde çalışır. Bu, gereksiz UI ve gameplay güncellemelerini azaltır.

`HistoryStore` bounded undo/redo sağlar.

### Events

`TypedEventBus` event isimleri ve payload şekillerini compile-time olarak bağlar.

Event sistemi:

- bounded queue;
- listener limiti;
- `once` aboneliği;
- deterministik sıra;
- hata izolasyonu;
- runtime metrics

özelliklerini sağlar.

### Runtime

`RuntimeKernel` frame yaşam döngüsünü sistemlere böler.

Sistemler priority üzerinden sıralanır ve her sistemin adı benzersizdir.

Kernel:

- fixed-step simulation;
- bounded delta;
- deterministic context;
- quality feedback;
- runtime snapshot;
- graceful disposal

sağlar.

### Scheduling

`FrameScheduler` daha ayrıntılı bütçeleme sağlar.

Fazlar:

1. input
2. simulation
3. world
4. animation
5. audio
6. render
7. telemetry
8. background

Her faz için bütçe tanımlıdır. Adaptive cadence yüksek baskıda güncelleme sıklığını azaltabilir.

Bu mekanizma özellikle düşük güçlü mobil cihazlarda görünürlüğü düşük veya ikincil sistemlerin ana frame bütçesini tüketmesini engellemek için tasarlanmıştır.

### Render

`renderContract.ts` render engine API'sini backend'den ayırır.

Desteklenen düşünce modeli:

- WebGPU
- WebGL2
- Canvas 2D
- DOM fallback

Render packet immutable'dır. Kamera, kalite, visible entity listesi ve pass sırası tek bir frame sözleşmesinde birleşir.

Resource lifetime ve alias planlayıcısı geçici kaynakların tekrar kullanılmasına uygun bir veri modeli sağlar.

Bu katmanın görevi Three.js nesnelerini doğrudan yönetmek değil, gerçek renderer'ın uygulayacağı deterministik frame kararlarını üretmektir.

### Scene

`SceneGraph` hiyerarşik node modelini yönetir.

Kurallar:

- tek root;
- parent existence;
- cycle rejection;
- deterministic child order;
- bounded metadata;
- world-position hesaplama;
- audit.

### ECS

`EntityStore` küçük ve bounded bir ECS-lite altyapısıdır.

Kullanım alanları:

- oyuncu alt sistemleri;
- NPC runtime metadata;
- fauna metadata;
- VFX/audio presentation state;
- spatial query yardımcıları.

Bu yapı mevcut ActorRegistry veya gameplay authority'nin yerini almaz. İleride ihtiyaç halinde veri erişimini daha temiz hale getirecek ortak primitive sunar.

### Input

`ActionRouter` keyboard, mouse, gamepad ve touch girişlerini aynı action modeline getirir.

Oyun kodunun fiziksel tuş kodlarını bilmesi gerekmez. Böylece yeniden eşleme, accessibility ve farklı cihazlar daha temiz ele alınabilir.

### Assets

`AssetRegistry` asset lifecycle'ını bounded hale getirir:

- declaration;
- dependency ordering;
- abort;
- preload;
- ready/failed/disposed states;
- eviction;
- byte metrics.

Asset loader fonksiyonları registry dışındaki gerçek sahiplik katmanlarına bağlanabilir.

### Network

`NetworkPolicy` ve `OfflineCommandQueue` networking'e doğrudan gameplay yazmak yerine politika uygular.

Korunan özellikler:

- request budget;
- payload size limit;
- priority;
- retries;
- exponential backoff;
- idempotency;
- offline queue;
- RTT.

Böylece transient ağ problemleri dünya state'inin kontrolsüz şekilde bozulmasına yol açmaz.

### Persistence

`VersionedStorage` kayıtların schema numarası ve checksum ile saklanmasını sağlar.

Her save:

1. normalize edilir;
2. deterministic digest hesaplanır;
3. envelope içine alınır;
4. schema bilgisiyle yazılır.

Load sırasında checksum uyuşmazsa veri sessizce kabul edilmez.

Migration zinciri açıkça tanımlıdır.

### Worker runtime

`WorkerPool`, CPU yoğun veya ağdan sonra yapılan hesapların ana UI thread'ine taşınabilmesi için bounded task modeli sunar.

Sistem:

- concurrency sınırı;
- queue capacity;
- priority;
- timeout;
- cancellation;
- metrics

uygular.

`MessageMultiplexer` ise worker/rpc mesajlarının request-response ve publish/subscribe ihtiyaçlarını ayırır.

### Accessibility

Accessibility runtime seviyesinde first-class olarak ele alınır:

- reduced motion;
- high contrast;
- large text;
- captions;
- screen-reader live region;
- focus trap;
- color-blind palette;
- adaptive UI scale.

Bu tercihler yalnızca UI CSS'i olarak değil, animasyon ve sunum kararlarını etkileyen runtime girdileri olarak kullanılabilir.

### Security

`RuntimeGuard` aşağıdaki kaynaklar için bounded sayaçlar sağlar:

- event/listener sayısı;
- timer sayısı;
- fetch sayısı;
- frame başına DOM mutation;
- asset memory budget.

Ayrıca modern core'da dynamic code execution yasaktır.

## Legacy bridge stratejisi

`src/core/legacy/legacyBridge.ts` yeni TypeScript çekirdeği ile mevcut global JavaScript uygulaması arasında kontrollü bir sınırdır.

Bridge üzerinden izin verilen örnekler:

- legacy kingdoms read;
- seçili kingdom aktarımı;
- render tetikleme;
- toast bildirimi;
- modern app debug bridge.

Legacy kod modern core'a doğrudan import edilmez.

Amaç birkaç büyük dosyanın yeniden yazımını tek deployment'a sıkıştırmak yerine aşamalı migrasyondur.

## Aşamalı geçiş planı

### Faz A — altyapı

Tamamlanan çekirdek:

- TypeScript compiler contract;
- Vite build;
- typed domain;
- state;
- event bus;
- deterministic clock;
- render contract;
- input abstraction;
- asset registry;
- persistence;
- telemetry;
- worker runtime;
- ECS-lite;
- scheduler;
- accessibility;
- network policy;
- runtime guard.

### Faz B — adapterization

Bir sonraki uygulama katmanı, mevcut büyük JavaScript modüllerini küçük TypeScript adaptörleri üzerinden kullanır.

Öncelik sırası:

1. world state;
2. player state;
3. combat presentation;
4. asset registry;
5. renderer bridge;
6. audio bridge;
7. UI state.

### Faz C — authority transfer

Bir modül yeterli test kapsamına ulaştığında gerçek state mutation authority o modüle taşınabilir.

Transfer kriterleri:

- typed API;
- deterministic tests;
- browser smoke;
- mobile/PWA smoke;
- memory leak check;
- no ownership duplication.

### Faz D — legacy deletion

Legacy fonksiyon veya global sadece şu üç koşul birlikte sağlandığında kaldırılır:

- tüm çağrılar yeni API'ye geçmiş;
- release smoke başarılı;
- rollback yolu bulunuyor.

Silme operasyonları kontrollü migration PR'ları ile yapılmalıdır.

## Performans bütçeleri

Hedef bütçe 60 FPS'tir.

Pratik frame bütçesi yaklaşık 16.67 ms'dir. Sistemlerin toplamı bu değeri aşarsa adaptive quality devreye girebilir.

Önerilen ilk dağılım:

- input: 1.2 ms;
- simulation: 5.5 ms;
- world: 2.8 ms;
- animation: 2.3 ms;
- audio: 1.4 ms;
- render policy: 4.5 ms;
- telemetry: 0.7 ms;
- background: 0.6 ms.

Bu değerler donanım benchmark'ı değildir; ilk production tuning baseline'ıdır.

## Adaptive quality davranışı

Quality level 4 tam özellik setidir.

Aşağı doğru geçişlerde tipik olarak:

- resolution scale;
- shadow resolution;
- post-processing;
- volumetrics;
- foliage density;
- texture LOD bias;
- particle budget;
- audio voice budget;
- worker budget

azaltılır.

Hysteresis ve dwell time, hızlı 3↔4 salınımını engeller.

## Determinism

Core code'da gameplay sonucu üretirken `Math.random()` kullanılmaz.

Rastgelelik gerekiyorsa seeded `MulberryRandom` kullanılır.

Zaman bağımlı simulation için fixed-step clock kullanılır.

Snapshot karşılaştırmalarında structural deterministic digest kullanılır.

Bu yaklaşım:

- replay;
- bug reproduction;
- multiplayer validation;
- regression tests;
- save/load consistency

için temel oluşturur.

## Hata yönetimi

Bir presentation subsystem hatası bütün oyun frame'ini öldürmemelidir.

Bu nedenle kernel ve orchestrator seviyesinde subsystem isolation vardır.

Ancak simulation truth hataları sessizce yutulmamalıdır. Üretim sistemi error telemetry üretmeli ve gerekli olduğunda fail-safe state'e geçmelidir.

## PWA ve offline yaklaşımı

PWA modu artık yalnızca CSS/görsel özellik değildir.

Lifecycle katmanı:

- hidden;
- background;
- focus;
- online/offline;
- suspended;
- disposed

durumlarını yönetir.

Offline komutlar queue ile saklanabilir ve ağ geri geldiğinde deterministic retry ile gönderilebilir.

## Browser capability negotiation

Yeni runtime her cihazı WebGPU kabul etmez.

Capability discovery şu alanlarda karar verir:

- WebGPU;
- WebGL2;
- OffscreenCanvas;
- SharedArrayBuffer;
- WebAudio;
- Gamepad;
- Touch;
- Service Worker;
- IndexedDB;
- BroadcastChannel;
- View Transitions;
- Scheduler API;
- observers.

Renderer seçimi capability-first olur.

## Güvenli modernizasyon kuralları

### Yasaklar

- ikinci bir ActorRegistry;
- ikinci bir combat state owner;
- ikinci bir material placement authority;
- yeni global mutable singletonlar;
- modern core'a dynamic `eval`/`Function`;
- unbounded queues;
- unbounded event listeners;
- rastgele gameplay state;
- uncontrolled recursive dispatch.

### İzin verilenler

- pure policy modules;
- adapters;
- immutable snapshots;
- typed contracts;
- bounded caches;
- deterministic replay;
- explicit ownership transfer.

## CI release gate

`modern-typescript-platform.yml` şu katmanları doğrular:

1. exact checkout;
2. Node 24 LTS;
3. migration policy;
4. strict TypeScript check;
5. Vitest contract suite;
6. production Vite build;
7. build artifact smoke;
8. legacy JavaScript syntax check.

CI sonucunda PASS görülmeden release veya merge sonucu başarı olarak raporlanmamalıdır.

## Rollback

Modern runtime `modern.html` üzerinden ayrı girişe sahip olduğu için ilk aşamada legacy uygulama geri dönüş noktası olarak tutulabilir.

Rollback sırası:

1. modern entry'yi erişimden kaldır;
2. legacy index/game3d girişlerini koru;
3. persistence schema uyumluluğunu doğrula;
4. yeni world snapshot formatını eski consumer'a yazma;
5. migration PR'sini revert et.

## Sonraki teknik hedefler

- gerçek WebGPU render command bridge;
- OffscreenCanvas worker renderer;
- GPU timing queries;
- texture residency manager;
- virtualized asset manifests;
- IndexedDB persistent snapshot store;
- service-worker cache versioning;
- multi-tab BroadcastChannel state arbitration;
- server authoritative multiplayer protocol adapter;
- ECS component archetype storage;
- player/combat authority migration;
- typed audio integration;
- browser-level Playwright smoke suite.

## Kabul kriteri

Modernizasyon “TypeScript dosyaları eklendi” seviyesinde başarılı sayılmaz.

Kabul için hedef:

- legacy behavior korunmuş;
- new core compile-safe;
- deterministic contract suite geçiyor;
- production build çıkıyor;
- modern entry gerçekten yükleniyor;
- device fallback çalışıyor;
- offline davranışı fail-safe;
- memory/resource budget bounded;
- ownership sınırları korunuyor;
- migration adımları geri alınabilir.
