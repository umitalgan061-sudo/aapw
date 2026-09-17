# AAPW R2 Render Runtime

## Amaç

R2, mevcut Three.js dünya renderer'ını değiştirmeden modern TypeScript runtime'ın kararlarını gerçek presentation katmanına bağlar.

## Backend doğruluğu

Tarayıcının `navigator.gpu` API'sini sunması tek başına WebGPU backend seçilmiş olduğu anlamına gelmez. `negotiateRenderCapabilities()` artık concrete renderer factory tarafından verilen backend hint'ini kabul eder.

Mevcut `game3d.html` sahnesi Three.js WebGL renderer kullandığı için modern runtime `webgl2` backend olarak raporlanır. Gelecekte gerçek `WebGPURenderer` devreye alındığında aynı capability katmanı WebGPU seçimine açılabilir.

## Gerçek render telemetry

Three.js `renderer.info.render.calls` ve `renderer.info.render.triangles` doğrudan telemetry'ye aktarılır. Aggregate texture-byte metriği Three.js tarafından portable biçimde verilmediği için sahte byte tahmini yapılmaz.

WebGL2 `EXT_disjoint_timer_query_webgl2` destekleniyorsa gerçek render çağrısı non-blocking GPU timer ile örneklenir. Query hazır değilse frame bekletilmez; disjoint sonucu kayda alınmaz. Adaptive quality bir önceki hazır GPU örneğini kullanabilir.

## Adaptive presentation

`RendererPresentationBridge` kalite katmanını gerçek renderer pixel ratio'suna çevirir. Baskı yükseldiğinde render scale kademeli düşer; düşük baskıda geri toparlanır. Shadow policy de aynı bütçe kararına bağlıdır.

Renderer'ın boot sırasındaki pixel ratio ve shadow baseline değerleri saklanır. Bridge dispose edildiğinde başlangıç presentation politikası geri yüklenir.

## Deterministik frame ilerlemesi

Modern entry loop frame delta'yı `FixedStepClock.advance()` üzerinden simülasyon saatine taşır. Böylece render callback sayısı ile simulation tick sayısı birbirinden ayrılır ve yoğun frame düşüşlerinde fixed-step spiral korunur.

## Test sözleşmesi

R2 testleri şu davranışları doğrular:

- gerçek renderer call/triangle telemetry
- WebGL2 backend hint ile WebGPU yanlış-pozitiflerinin engellenmesi
- adaptive pixel ratio ve shadow budget
- baseline presentation restoration
- GPU timer query availability/disjoint handling
- renderer render-method instrumentation lifecycle

## Otoriteler

R2 terrain geography, `map.png`, hydrology, collider veya world-generation authority'lerini değiştirmez. Değişiklikler render/presentation ve runtime orchestration sınırında tutulur.
