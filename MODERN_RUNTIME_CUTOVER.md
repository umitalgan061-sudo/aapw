# Modern Runtime Cutover Guide

## Amaç

AAPW artık iki katmanı bilinçli biçimde taşıyabilir: mevcut tarayıcı oyununun JavaScript yüzeyi ve TypeScript-first modern platform çekirdeği. Bu belge ikinci katmanın nasıl güvenli biçimde gerçek runtime'a alınacağını tanımlar.

## Güncel mimari

`src/3d/modern` içindeki platform katmanı veri sözleşmelerini, deterministik zamanı, input normalizasyonunu, kaynak yaşam döngüsünü, render packet üretimini, frame graph planlamasını, worker işlerini, ağ snapshot/delta işlemlerini, kalite yönetimini ve operasyonel teşhisi kapsar.

`RuntimeKernel` orkestrasyon köküdür. `RuntimeLifecycle` görünürlük ve yaşam döngüsü geçişlerini yönetir. `ModernRuntimeFacade` mevcut `GameState` ve renderer yüzeyine dar bir uyumluluk sınırı sunar. Böylece `game3d.js` doğrudan yüzlerce yeni nesneye bağlanmak zorunda kalmaz.

## Migration ilkeleri

1. Yeni çekirdek önce veri ve karar üretir; Three.js nesnelerini sahiplenmez.
2. Bir legacy modül için cut-over ancak parity testleri, determinism testi ve failure-path testi bulunduğunda yapılır.
3. Render backend seçimi capability-driven olur. WebGPU başarısızsa WebGL2/canvas2D/headless zincirine geçiş kontrollüdür.
4. Asset erişimi manifest ve origin politikasıyla doğrulanmadan loader'a bırakılmaz.
5. Uzun süreli iş CPU frame bütçesini aşamaz; worker veya bounded scheduler kullanılmalıdır.
6. Runtime state sadece JSON-uyumlu, serileştirilebilir ve versiyonlanabilir sözleşmeler üzerinden sınırlar.
7. Replay sistemine DOM olayı değil semantic action yazılır. Böylece aynı senaryo farklı cihaz düzenlerinde yeniden üretilebilir.
8. Ağ sınırı snapshot/delta ve checksum ile deterministik hale getirilir; transport ayrı bir adapter olarak tutulur.

## Fazlar

### Faz A — Foundation

Typed contracts, deterministic primitives, state store, resource registry, streaming planner, quality controller ve render packet sistemi temel platformdur.

### Faz B — Orchestration

`RuntimeKernel` bütün temel servisleri tek bir çerçevede birleştirir. Uygulama kodu yalnızca kernel'in public surface'iyle haberleşir.

### Faz C — Browser lifecycle

`RuntimeLifecycle` ile tab görünürlüğü, pagehide/pageshow, suspension ve restart davranışları standartlaşır. Uzun frame gap'ler frame budget'i bozmayacak şekilde sınırlandırılır.

### Faz D — Rendering adapter

`RenderBridge`, gerçek Three.js/WebGPU/WebGL renderer'ının sahibi değildir. Uygulama renderer'ı packet'ı tüketir; bridge yalnızca backend, kalite, recovery ve ölçüm durumunu koordine eder.

### Faz E — Gameplay cut-over

Input -> command -> simulation -> snapshot zinciri önce düşük riskli bağımsız sistemlerde kullanılmalıdır. Oyuncu hareketi ve world streaming parity korunduktan sonra scene bootstrap'ına geçirilir.

### Faz F — Legacy shrink

Bir sistem modern kernel tarafından aynı davranışı verdiği kanıtlanınca legacy adapter daraltılır. Silme işlemi en son yapılır; önce çağrı yüzeyi minimize edilir.

## Performans bütçeleri

Desktop profili 60 FPS hedefinde yaklaşık 16.67 ms toplam frame bütçesi kullanır. Bunun içinde simülasyon, streaming, animation ve render için ayrı alt bütçeler bulunur. Mobile ve low-end profilleri entity, draw, memory ve streaming sınırlarını daha agresif azaltır.

Kalite sistemi tek frame dalgalanmasında sürekli kalite değiştirmez. Pressure smoothing, aşağı/yukarı eşikleri ve dwell süresi birlikte kullanılır. Bu, özellikle thermal throttling veya ağır texture yüklerinde görüntü kalitesinin titreşmesini azaltır.

## Recovery

GPU device-loss veya WebGL context reset sonrası renderer doğrudan sınırsız yeniden başlatılmaz. Retry sayısı, exponential backoff, jitter ve failure window uygulanır. Tekrarlayan kayıplarda düşük riskli backend önerisi oluşturulur.

## Asset güvenliği

Manifest girişleri benzersiz ID, URL protocol, same-origin ve byte budget açısından doğrulanır. Asset fetch katmanı ayrıca response status, expected byte count ve toplam asset bütçesini denetler.

## Ağ / multiplayer hazırlığı

`NetworkReplicationController` henüz transport sağlamaz. Bunun yerine:

- deterministik entity sıralaması,
- quantized pozisyon/hız,
- bounded snapshot boyutu,
- baseline tabanlı delta,
- checksum doğrulaması

gibi protokol seviyesinde kurallar sunar.

Transport tarafı ileride WebSocket, WebTransport veya worker bridge ile değiştirilebilir.

## Gözlemlenebilirlik

`RuntimeProfiler` phase mark'larını ve bütçe ihlallerini, `PlatformHealthMonitor` ise frame/memory/thermal/worker pressure durumlarını aynı raporlama modelinde tutar. Diagnostic ring-buffer sınırsız log büyümesini önler.

## CI sözleşmesi

Modern CI, önce manifest guard çalıştırır; sonra TypeScript typecheck, test, build ve determinism guard adımlarına geçer. Typecheck kırmızıysa aşağıdaki test/build adımları bilerek çalıştırılmaz. Bu durumda merge sonrası “CI geçti” iddiası yapılmamalıdır.

## Geliştirici komutları

```bash
npm run verify:modern
npm run typecheck
npm test -- --passWithNoTests
npm run build:modern
```

Tam doğrulama:

```bash
npm run check
```

## Cut-over acceptance criteria

Bir legacy modülün modern katmana taşınmış sayılması için:

- public davranış parity testi,
- deterministik replay veya checksum testi,
- failure/recovery testi,
- memory ve queue sınırı testi,
- migration dokümantasyonu,
- rollback yolu

aynı PR içinde bulunmalıdır.

## Rollback

Yeni kernel davranışı sorun çıkarırsa facade feature flag ile devre dışı bırakılmalı ve legacy sink aynı primitive değerleri üretmeye devam etmelidir. Büyük runtime refactor'larında geri dönüş mekanizması kodun kendisi kadar önemlidir.

## Not

“Son teknoloji” tek bir kütüphane sürümünden ibaret değildir. Bu mimarinin hedefi; tip güvenliği, deterministic simulation, bounded work, backend capability detection, explicit resource ownership, test edilebilirlik ve kontrollü migration'ı birlikte sağlamaktır.
