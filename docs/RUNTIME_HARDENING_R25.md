# Runtime Hardening R25

R25, canlı modern runtime'ın health/pressure ölçümlerini tek bir typed supervisor altında toplar.

## Yetkinlikler

- Bounded frame-health budget: frame, CPU, GPU, draw-call, triangle, memory, entity, asset backlog ve network jitter sinyallerini değerlendirir.
- Failure-window circuit breaker: belirli süre içinde tekrarlanan runtime hatalarını sayar ve kritik durumda yeni operasyonların başlatılmasını durdurur.
- Abortable operation timeout: async operasyonlara AbortSignal verilir; süre aşımı gerçekten promise'i TimeoutError ile sonlandırır.
- Hysteretic recovery: tek iyi frame ile kalite sıçraması yerine ardışık sağlıklı örneklerle kontrollü recovery yapılır.
- Immutable diagnostics: snapshot ve history kopyaları dışarıya mutable referans vermez.
- Deterministic testing: clock dependency injection ile zaman penceresi testlerde deterministik tutulur.

## Entegrasyon

ModernRuntimeFacade her frame sonrası RuntimeHardeningSupervisorV25.observeFrame() çağırır. Son karar facade snapshot ve diagnostics verisine yazılır. Renderer initialization ayrıca guardAsync() ile korunur ve facade initialize/frame hataları failure window'a kaydedilir.

## Mimari

Supervisor, Three.js bağımlılığı taşımaz. Bu nedenle headless testte çalışabilir ve gelecekte worker/runtime ayrımına taşınabilir.

## Operasyon

- npm run verify:runtime-hardening-r25
- npm run typecheck:runtime-hardening-r25
- npm run test:runtime-hardening-r25
- npm run check:runtime-hardening-r25

Bu dört kontrol aynı change-set için birlikte geçtiğinde V25 hardening katmanı release'e hazır kabul edilir.
