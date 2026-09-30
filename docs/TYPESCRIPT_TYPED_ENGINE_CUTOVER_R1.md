# TypeScript Typed Engine Cutover R1

## Durum

AAPW'nin modern runtime çekirdeği artık TypeScript-first bir sınır üzerinden ilerliyor. Bu belge bu turda
kullanılan yeni domain sözleşmelerini, legacy uyumluluk katmanını ve doğrulama kapılarını tek yerde tanımlar.

## Teknoloji sınırı

`src/engine-ts/` saf domain ve orchestration kodunun ana hedefidir. Browser API'leri renderer, worker, storage ve
input adapter'ları üzerinden sisteme girer. Three.js sınıfları domain veri sözleşmelerine sokulmaz.

`src/3d/config.ts`, `src/3d/eventBus.ts` ve `src/3d/state.ts` legacy 3D çekirdeğinin tipli karşılıklarıdır.
Eski `.js` dosyaları halen runtime geriye dönük uyumluluk için korunur; yeni modern servisler doğrudan bu JavaScript
katmanına yeni iş mantığı eklemez.

## Domain model

`coreTypes.ts` branded primitive tipleri kullanır. `EntityId`, `ComponentType`, `SystemId` ve `Tick` aynı temel
primitive'in yanlış sözleşmede kullanılmasını azaltır. `Result<T, E>` beklenen runtime hatalarını açık veri olarak
sistemler arasında taşır.

`runtimeContracts.ts` typed event bus, deterministic fixed-step clock, frame scheduler ve bounded metrics sağlar.
Scheduler sıralaması phase, priority ve stable id ile belirlenir.

`ecsRuntime.ts` component schema, query, snapshot ve restore sözleşmelerini uygular. Component validation merkezi
olduğu için state mutation'larının veri şekli runtime'da da korunur.

`world.ts` zaman, hava durumu ve deterministic fauna planlamasını tek domain yüzeyinde toplar. Fauna üretimi seed,
habitat, gün fazı ve hava durumundan türetilir; çağrı sırasına göre değişmemelidir.

## Rendering

`renderBridge.ts` WebGPU ve WebGL2 backend seçimini ayrı bir policy üzerinden yapar. WebGPU bulunamadığında renderer
katmanı WebGL2'ye düşebilir. Quality tier; görünür obje, gölge, animasyon, texture byte bütçesi ve effect setiyle birlikte
üretilir.

Dynamic resolution kontrolcüsü hysteresis kullanır. Frame süresi hedefin üstünde kaldığında çözünürlük kontrollü biçimde
azalır; yeterli headroom uzun süre korunmadan yükselmez. Böylece tek frame spike'larında kalite salınımı engellenir.

`BudgetAwarePresenter`, gerçek renderer nesnesiyle domain policy arasındaki lifecycle sınırıdır.

## Asset yaşam döngüsü

`assets.ts` descriptor, loader, dependency, cancellation, residency ve integrity kavramlarını tek modelde birleştirir.
Yükleme graph'ında dependency cycle reddedilir. Resident kaynaklar byte ve asset sayısı bütçelerine göre izlenir.
Streaming director priority, distance, importance ve deadline ile deterministic karar üretir.

Asset integrity doğrulaması bozuk içerikleri runtime'da sessizce kabul etmek yerine açık sonuç döndürür.

## Persistence

`persistence.ts` save envelope'ları format ve schema sürümü taşır. Canonical payload checksum'ı JSON key sırasından
oluşan sahte farkları azaltır. Primary save bozulduğunda backup envelope kullanılabilir.

Storage adapterı domain kodundan ayrıdır; bu nedenle LocalStorage ile başlayan akış daha sonra IndexedDB, worker veya
başka durable storage implementasyonuna geçirilebilir.

Gameplay snapshot sınırı player, world, quest, inventory ve settings veri şekillerini validation ile kontrol eder.

## Input

`input.ts` tüm cihazları action seviyesinde normalize eder. Keyboard, pointer, touch, gamepad ve XR kaynakları aynı
input action modelinde birleşir. Digital transitions (`justPressed`, `justReleased`) frame içinde deterministically
izlenir.

Gesture çözümü örnek dizisinden dominant direction ve velocity üretir. Rumble router destekleyen gamepad'lere bounded
haptic komut gönderir. Input recorder replay ve regresyon testinin tabanını sağlar.

## Worker altyapısı

`worker.ts` browser worker'ı domain modeline sert biçimde bağlamaz. TypedWorkerPool concurrency, queue ve timeout sınırı
uygular. İşler priority ve deadline ile seçilir. Cancel edilen veya timeout alan işlerin sonucu açıkça hata olarak döner.

`WorkerRequestRouter` request/response id ile transport tarafını normalize eder. Terrain generation, pathfinding,
navmesh preparation ve asset parsing gibi ağır işlerin Dedicated Worker tarafına taşınması bu kontrata bağlanabilir.

## Network ve replay temeli

`network.ts` deterministic snapshot ve delta paketleri üretir. Entity sırası canonical biçimde tutulur; packet checksum'ı
frame/state regression testlerinde kullanılabilir.

SnapshotBuffer out-of-order arrival kabul eder ve ara tick için interpolated entity state üretir. ReliableSequenceChannel
acknowledgement ve retry sınırı uygular. ClientPredictionBuffer input command'larını tick sırasına göre tutar ve server
acknowledgement sonrasında eski komutları düşürür.

NetworkHealthMonitor RTT, jitter ve loss sinyallerini bounded health seviyesine dönüştürür. Bu seviye telemetry için
kullanılır; oyun sonucunu deterministically değiştiren gizli bir karar mekanizması değildir.

## Legacy uyumluluk

`legacyAdapters.ts` eski state/config/event/input yüzeylerini modern typed sözleşmelerle yan yana tutar. Bu katman
özellikle üç görevi üstlenir:

1. Legacy consumer'ın aniden kırılmasını engellemek.
2. Yeni sistemlerin yalnızca typed API üzerinden konuşmasını sağlamak.
3. Modül modül cut-over yapılırken contract testleri için sabit referans oluşturmak.

`src/engine-ts/index.ts` hem mevcut modern engine exportlarını hem yeni typed servisleri tek barrel üzerinden dışarı açar
ve `createModernEngineFacade()` içine typed engine instance'ını ekler.

## CI kapıları

`verify:typed` repository içindeki typed source tree'yi tarar ve zorunlu modern modülleri kontrol eder. Typed module'ların
legacy `.js` bağımlılıklarını ve deterministic yüzeylerdeki ambient random/wall-clock erişimini yakalar.

`test:typed` Node'un native TypeScript strip desteği ile domain acceptance suite'ini çalıştırır. Suite; ECS, persistence,
asset graph, input transitions, deterministic fauna, WebGPU/WebGL policy, worker pool, network delta/interpolation ve
render adaptation dahil kritik davranışları kapsar.

Modern Typescript workflow bu kapıları `typecheck`, repository testleri ve production build'in önüne koyar. Push/pull request
path filtresi artık `src/engine-ts/**` ile typed 3D adapters'larını da kapsar.

## Cut-over ilkeleri

Legacy JS dosyalarını tek seferde silmek yerine önce typed equivalent, sonra adapter, sonra parity test, en sonunda
consumer cut-over sırası uygulanır. Böylece büyük bir migration tek commit içinde bilinmeyen davranış farklarına dönüşmez.

Yeni iş mantığı için JS eklenmesi migration boundary ihlalidir. Vendor kodu ayrı tutulur. Browser veya Three.js API'si
domain contractına doğrudan bağımlı yapılmaz.

Deterministic simulation modülleri explicit tick/time/random inputs kullanır. `Math.random()` ve ambient `Date.now()`
çekirdek deterministik domain hesabının parçası olamaz.

Her bounded runtime servisi queue, resident bytes, task count, event listener veya history capacity gibi açık bir üst
sınır taşır.

## Bu turun hedefi

Bu cut-over R1'in amacı bütün legacy dosyaları hemen silmek değil; oyunun kritik runtime altyapısının yeni nesil TypeScript
çekirdeğine taşınabileceğini kanıtlamak ve sonraki renderer/asset/world migration'larına gerçek contract yüzeyi bırakmaktır.
