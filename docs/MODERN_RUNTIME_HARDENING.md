# Modern Runtime Hardening

## Amaç

Bu katman AAPW'nin mevcut 3D gameplay mimarisinin üzerine çalışan, tarayıcı gerçeklerine uyumlu ve üretim odaklı bir runtime omurgasıdır. Temel hedef yalnızca daha fazla özellik eklemek değil; düşük FPS, yüksek cihaz çeşitliliği, sekme gizlenmesi, input sıralaması, save bozulması, asset belleği, kalite dalgalanması ve hata görünürlüğü gibi gerçek kullanım koşullarında davranışı öngörülebilir hale getirmektir.

## Tasarım ilkeleri

1. **Ownership preservation**: Renderer, physics, player, combat, world, navigation ve persistence payload'larının gerçek sahibi mevcut gameplay katmanlarıdır. Runtime yeni bir owner değildir.
2. **Determinism first**: Simulation değişken browser frame süresine doğrudan bağlanmaz. Fixed-step scheduler ile tick sınırı korunur.
3. **Fail-soft presentation**: Platform kabiliyeti düşükse sistem daha düşük kaliteye iner; olmayan API'yi varsaymaz.
4. **Bounded memory**: Telemetry ve asset residency sınırsız büyümez. Ring-buffer ve capacity sınırları kullanılır.
5. **Explicit degradation**: Performans baskısı kalite controller tarafından sinyal olarak raporlanır; renderer değişikliği composition layer'a aittir.
6. **Versioned persistence**: Save formatı revision, schemaVersion ve checksum ile doğrulanır; migrasyon eksikse sessiz veri kaybı yapılmaz.
7. **Semantic input**: Cihazlar doğrudan player'a yazmaz. Keyboard, pointer, touch ve gamepad adapter'ları semantic command üretir.
8. **Accessibility by default**: `prefers-reduced-motion` ve `saveData` gibi browser sinyalleri kalite/presentation kararlarının girdisidir.
9. **Observable runtime**: Frame time, CPU/GPU örnekleri, kalite değişimleri, scheduler guard ve persistence olayları structured telemetry olarak tutulabilir.
10. **Testability**: Browser globals yerine inject edilebilir adapter'lar sayesinde aynı runtime deterministik test senaryolarında çalışabilir.

## Bileşenler

### `modernRuntimeContract.js`

Ortak primitive'leri tutar.

- Schema ve protocol kimliği
- Enum normalizasyonu
- Number/boolean güvenli dönüşümler
- Immutable snapshot üretimi
- Stable stringify
- Ring buffer
- Derin freeze
- Disposer

Bu dosya uygulama davranışına sahip değildir; diğer modüller için contract seviyesidir.

### `deterministicRuntimeScheduler.js`

Tarayıcıdan gelen değişken `deltaMs` değerini fixed-step simulation'a dönüştürür.

Model:

```text
browser frame
   |
   v
bounded delta
   |
   v
accumulator ----> fixed simulation ticks
   |
   +--------------> interpolation alpha
```

Scheduler iki kritik korumaya sahiptir:

- Catch-up sınırı: uzun tab dönüşlerinde devasa birikim çalıştırılmaz.
- Spiral guard: bir browser frame'i izin verilen maksimum tick sayısından fazlasını gerektiriyorsa kalan yük sıkıştırılır ve telemetri olayı üretilir.

Bu yaklaşım physics veya gameplay state'i yönetmez. `simulate(context)` caller hook'u aracılığıyla mevcut sahiplik katmanına çağrı yapılır.

### `adaptiveQualityController.js`

Beş kalite tier'ı kullanır:

`minimal -> low -> medium -> high -> ultra`

Controller frame, CPU ve isteğe bağlı GPU örneklerini birleştirerek pressure üretir. Pressure tek bir anda kalite değiştirerek titreşim oluşturmaz; warm-up, dwell ve hysteresis ile stabilize edilir.

Çıktıdaki kalite planı şunları kapsar:

- pixel ratio
- shadows
- effects
- foliage
- animation rate
- active zone sınırı
- target FPS

Renderer veya world sistemi bu çıktıyı uygulayabilir. Controller'ın Three.js veya scene graph bağımlılığı yoktur.

### `platformCapabilityProbe.js`

Tarayıcı kabiliyetlerini konservatif biçimde raporlar.

- WebGPU
- WebGL/WebGL2
- OffscreenCanvas
- SharedArrayBuffer
- IndexedDB
- Service Worker
- BroadcastChannel
- Gamepad
- Pointer Lock
- Touch
- Reduced motion
- Data saver
- Hardware concurrency
- Device memory
- DPR

WebGPU yokluğu hata değildir. WebGL varsa compatibility fallback mümkündür. İki API de yoksa `compatibility` platform profili üretilir.

### `inputCommandBuffer.js`

Input'u semantic hale getirir.

Örneğin:

```text
Keyboard W      -> move(vector=(0,1))
Mouse delta     -> look(vector=(dx,dy))
Space down      -> dodge(pressed)
Gamepad X       -> primary(pressed)
Touch joystick  -> move(held)
```

Command alanları:

- `sequence`
- `tick`
- `timestampMs`
- `action`
- `phase`
- `value`
- `vector`
- `device`
- `source`

Bu sayede input replay, deterministic test ve input remapping için ayrı bir seam oluşur.

### `versionedPersistenceLedger.js`

Save işlemleri iki-slot yaklaşımını kullanır.

```text
slot A (rev 10)     slot B (rev 11)
       \               /
        \             /
         newest valid
```

Her envelope aşağıdaki alanları taşır:

- ledgerVersion
- schemaVersion
- revision
- tick
- timestampMs
- checksum
- payload

Yeni save önce pasif slota yazılır. Ardından aynı slot tekrar parse edilir. Doğrulama başarısızsa aktif save slotu değiştirilmez.

Schema yükseltmeleri açık migration fonksiyonları üzerinden ilerler. Migration eksikliği sessizce yok sayılmaz.

### `runtimeTelemetryHub.js`

Structured telemetry katmanı sınırsız log üretme yerine bounded history kullanır.

Metric tipleri:

- counter
- gauge
- histogram

Histogram için p50/p90/p95/p99 özetleri tutulur. Event payload'ları recursive sanitization ve byte budget ile sınırlandırılır.

Örnek event:

```json
{
  "type": "runtime.quality",
  "sessionId": "session-123",
  "sequence": 47,
  "timestampMs": 2184,
  "payload": {
    "action": "decrease",
    "tier": "medium"
  }
}
```

### `runtimeHealthMonitor.js`

Health sinyallerini tek seviyede özetler:

`healthy`, `watch`, `degraded`, `critical`

Frame, simulation ve presentation budget'larını ayrı izler. Recommendation API şu aksiyonları üretebilir:

- `hold`
- `shed-effects`
- `reduce-quality`
- `consider-recovery`
- `pause-or-throttle`

Health monitor kaliteyi doğrudan değiştirmez; sadece kanıt üretir.

### `assetResidencyCache.js`

Asset değerini doğrudan disposable olarak kabul etmez. Önce metadata ve yaklaşık weight takip edilir.

- weighted entries
- pinning
- LRU benzeri recency sıralaması
- item limit
- memory limit
- deterministic eviction plan
- per-type accounting
- hit/miss oranı

Three.js `dispose()` çağrısını bu modül yapmaz. Böylece asset lifecycle'ın gerçek owner'ı olan loader/scene manager'ın sınırı korunur.

### `runtimeFeatureFlagRegistry.js`

Feature flag'ler typed ve doğrulanmış bir registry üzerinden yönetilir.

Desteklenen tipler:

- boolean
- number
- string
- enum

Default'lar snapshot'a dahildir. Override kaynağı metadata olarak tutulur. Audience predicate hata verirse flag fail-closed davranır.

## Composition facade

`modernRuntimeFacade.js` yukarıdaki parçaları tek lifecycle API'sinde birleştirir.

```text
                         +----------------------+
                         | Existing game owners |
                         +----------+-----------+
                                    |
               hooks: simulate/present/save/load
                                    |
+----------------+        +---------v----------+        +----------------+
| Platform Probe |------->| Modern Runtime     |<-------| Feature Flags  |
+----------------+        | Facade             |        +----------------+
                          +--+--+--+--+--+-----+
                             |  |  |  |  |
                             |  |  |  |  +-- persistence
                             |  |  |  +----- telemetry
                             |  |  +-------- health
                             |  +----------- quality
                             +-------------- scheduler/input
```

Facade aşağıdaki lifecycle olaylarını standartlaştırır:

- start
- stop
- pause
- resume
- visibility change
- save
- load
- shutdown

## Visibility ve browser lifecycle

Tarayıcı sekmesi gizlendiğinde runtime görünür haldeki aynı frame hızını sürdürmemelidir. Facade `visibilitychange`, `pagehide` ve `pageshow` olaylarını tek bir seam'de normalize eder.

Beklenen politika:

```text
visible        -> normal scheduler
hidden        -> pause/throttle
prerender      -> pause/throttle
pageshow       -> resume + fresh frame baseline
```

Resume sırasında browser'ın askıya alınmış olduğu gerçek süre simulation'a otomatik olarak eklenmez. Bu, tab dönüşünde binlerce tick çalıştırma riskini önler.

## Error boundary ilkesi

Runtime telemetry error payload'ında yalnızca kontrollü metadata bulunmalıdır. Büyük object graph'lar, DOM node'ları, renderer instance'ları veya kullanıcı verisi doğrudan event payload'ına yazılmamalıdır.

Üst katmanlar gerçek hatayı kendi error boundary'lerinde ele alır. Runtime yalnızca gözlemlenebilirlik seam'i sağlar.

## Performans politikası

Öncelik sırası:

1. Simulation bütçesini koru.
2. Input sırasını koru.
3. Player/combat davranışını koru.
4. Kritik dünya state'ini koru.
5. Dekoratif effects azalt.
6. Pixel ratio düşür.
7. Uzak asset/zone yoğunluğunu azalt.
8. En son görsel kaliteyi minimuma çek.

Bu sıralama kaliteyi oyuncunun temel kontrol hissini bozacak şekilde agresif düşürmekten kaçınır.

## Reduced motion

`prefers-reduced-motion: reduce` aktif olduğunda presentation owner:

- camera shake miktarını azaltabilir,
- hızlı post-process geçişlerini sınırlayabilir,
- ani animation-rate artışlarını bastırabilir,
- gereksiz particle spawn yoğunluğunu düşürebilir.

Runtime bu kararları doğrudan uygulamaz; accessibility sinyalini composition katmanına aktarır.

## Data saver

Network connection `saveData` sinyali aktifse:

- yüksek çözünürlüklü remote asset indirme ertelenebilir,
- uzak bölge streaming agresifliği düşürülebilir,
- telemetry upload varsa batch boyutu küçültülebilir.

Bu modül network request gerçekleştirmez ve kullanıcı seçimini override etmez.

## Deterministic test modeli

Aynı input dizisi, aynı tick süreleri ve aynı başlangıç state'i verildiğinde scheduler ve semantic input katmanı aynı command sırasını üretmelidir.

Determinism testinde browser wall-clock kullanılmaz:

```text
seeded fixtures
      |
      v
fixed step
      |
      v
semantic commands
      |
      v
snapshot
```

`checkModernRuntimeHardening.mjs` bu sözleşmenin kritik yollarını Node ortamında doğrular.

## Test matrisi

### Contract

- snapshot normalization
- stable serialization
- semantic enum validation
- deep-freeze davranışı

### Scheduler

- fixed-step accumulation
- catch-up limit
- spiral guard
- forward seek
- snapshot validation
- repeated-run determinism

### Input

- deadzone
- scalar normalization
- press/held/release
- release-all
- remap
- tick drain
- validation

### Persistence

- first save
- round trip
- checksum verification
- corrupt slot recovery
- migration
- throttled write

### Telemetry

- counters
- gauges
- histograms
- percentile summary
- event history bound
- payload sanitization

### Quality/health

- pressure decrease
- recovery increase
- lock behavior
- sustained degradation recommendation
- visibility pause recommendation

### Residency

- capacity plan
- pinning
- hit/miss accounting
- quality budgets
- pressure classification

### Flags/platform

- typed defaults
- enum validation
- override source
- audience fail-closed
- capability classification
- capability warnings

## Üretim entegrasyon modeli

Önerilen bootstrap:

```js
const runtime = await createModernRuntime({
  saveSchemaVersion: 3,
  scheduler: { fixedStepMs: 1000 / 60 },
  quality: { minimumDwellMs: 4000 },
  input: { deadzone: 0.12 },
});

runtime.attachHooks({
  simulate(context, commands) {
    // Existing physics/gameplay owner.
  },
  present(context, snapshot, qualityPlan) {
    // Existing renderer/presentation owner.
  },
  entityCount() {
    return world.entities.length;
  },
});

runtime.exposeLifecycleEvents(document);
await runtime.start();
```

## Renderer geçiş yolu

WebGPU flag'i bilinçli olarak varsayılan `false` bırakılmıştır. Geçiş stratejisi:

1. Platform probe WebGPU desteğini raporlar.
2. Feature flag deneysel renderer yolunu açabilir.
3. Composition root WebGPU renderer adapter'ını seçebilir.
4. Başlatma başarısız olursa WebGL2/WebGL fallback çalıştırılır.
5. Runtime'ın geri kalan sözleşmeleri renderer'dan bağımsız kalır.

Bu sayede renderer seçimi ile gameplay determinism birbirine bağlanmaz.

## Bellek bütçesi

Örnek kalite bazlı asset residency hedefleri:

| Tier | Hedef |
|---|---:|
| minimal | 96 MB |
| low | 160 MB |
| medium | 320 MB |
| high | 512 MB |
| ultra | 768 MB |

Bunlar hard browser limitleri değildir. Asset loader gerçek footprint bilgisini biliyorsa daha doğru ağırlık geçirebilir.

## Save güvenliği

Save envelope checksum'ı kriptografik güvenlik amacı taşımaz; bozulma tespiti içindir. Yetkilendirme veya server-side integrity kontrolü yerine kullanılmamalıdır.

Server-backed progression için ayrıca:

- user/session authorization
- server authoritative state
- replay protection
- revision conflict resolution

gereklidir.

## Güvenli sonraki entegrasyon adımları

1. Mevcut `player.js` ve dünya bootstrap'ında runtime facade hook'larını bağlamak.
2. Renderer adapter'ına `qualityPlan` uygulamak.
3. Existing save formatını ledger migration ile sarmalamak.
4. Input adapter'larını semantic command producer olarak değiştirmek.
5. CI'da acceptance script'ini her ilgili PR'da çalıştırmak.
6. Production analytics varsa telemetry hub export'una explicit privacy filter koymak.

## Sonuç

Bu katman AAPW'nin mevcut sistemlerini silmeden veya yeniden sahiplenmeden modern browser runtime beklentilerini tek bir sözleşmede toplar. Amaç “tek sihirli sistem” değil; browser, renderer, gameplay ve persistence arasındaki hata yüzeyini küçük, ölçülebilir ve test edilebilir seam'lere ayırmaktır.
