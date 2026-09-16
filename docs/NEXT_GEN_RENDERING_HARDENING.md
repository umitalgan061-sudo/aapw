# Next-Generation Rendering Hardening

## Genel amaç

AAPW'nin `WebGL2 -> WebGPU/TSL` geçişini yalnızca yeni renderer import etmekten çıkarıp, production runtime boyunca
ölçülebilir bir render contract'a dönüştürmek için bu katman eklenmiştir. Three.js resmi belgelerinde
`WebGPURenderer` yeni nesil renderer olarak tanımlanıyor; WebGL2 fallback destekleniyor, TSL/node-material ve yeni
RenderPipeline/MRT yaklaşımı öne çıkıyor. Bu nedenle AAPW tarafında backend, quality, memory ve recovery kararları
renderer oluşturma kodundan ayrılmıştır. citeturn254605search0turn254605search1

## WebGPU stratejisi

Güncel Three.js kılavuzuna göre `WebGPURenderer` asenkron initialize edilir ve modern post-processing `RenderPipeline`
üzerinden çalışır. WebGL2 fallback halen desteklenmektedir. Bu projede de WebGPU “varsa körlemesine kullan” yaklaşımıyla
değil; capability + initialization + runtime failure sınırlarıyla ele alınır. citeturn254605search0

`nextGenRendererAdapter.js` fiziksel renderer instance'ını üretir. Yeni hardening katmanları bu instance'a sahip olmaz.

## 1. Feature negotiation

`renderFeatureNegotiator.js` şu kararı verir:

```text
requested features
        ↓
backend capability
        ↓
tier / hardware / thermal / accessibility
        ↓
enabled + rejected
```

Aynı requested set WebGPU ve WebGL2'de farklı feature contract'lara dönüşebilir. Örneğin SSGI ve DoF yalnızca WebGPU
profilinde yeterli tier/hardware koşullarında açılabilir. WebGL2 fallback durumunda özellik sessizce “varmış gibi”
raporlanmaz.

Bu özellikle önemlidir çünkü Three.js'in güncel WebGPURenderer migration rehberi, `ShaderMaterial`,
`RawShaderMaterial` ve `onBeforeCompile()` tabanlı yolların yeni renderer tarafında aynı şekilde desteklenmediğini ve
node material/TSL yönüne geçiş gerektiğini açıkça belirtiyor. citeturn254605search0

## 2. Dynamic resolution

`dynamicResolutionGovernor.js` frame time, thermal pressure, save-data ve accessibility signal'larından target
render scale üretir.

Temel kurallar:

- min/max scale bounded;
- smoothing;
- hysteresis;
- minimum dwell frame;
- forced scale override;
- recovery sonrası yeniden stabilizasyon.

Böylece GPU yükü sınırın etrafında dolaşırken her frame çözünürlük değiştirilmez.

Absolute FPS garantisi verilmez. Governor'ın amacı worst-case degrade davranışını öngörülebilir hale getirmektir.

## 3. Render pressure

`gpuPressureModel.js` GPU, CPU, frame, memory ve thermal pressure sinyallerini tek bounded score'a getirir.

```text
overall
 ├─ GPU time
 ├─ CPU time
 ├─ frame time
 ├─ memory utilization
 └─ thermal pressure
```

Pressure state:

- `nominal`
- `warning`
- `critical`

Recommendation layer gerçek mutation yapmaz; renderer composition root'u ilgili planı uygular.

## 4. Frame graph resource planning

`frameGraphResourcePlanner.js` GPU resource allocation yapmaz. Bunun yerine logical resources'ın lifetime'larını ve
uyumlu transient resource aliasing fırsatlarını hesaplar.

Bu yaklaşımın faydası:

```text
pass A -> color
pass B -> color
pass C -> history
```

gibi akışlarda aynı fiziksel transient memory'nin güvenli aliasing adayı olup olmadığını render backend'e daha erken
bildirebilmektir.

Planner:

- pass order;
- read/write dependency;
- first/last use;
- format;
- dimensions;
- sample count;
- transient flag
alanlarını canonical hale getirir.

Fiziksel texture/resource creation renderer-owned kalır.

## 5. Visibility + LOD

`renderVisibilityScheduler.js` büyük scene'lerde draw candidate sayısını bounded hale getirir.

Score bileşenleri:

- projected area;
- distance;
- motion;
- temporal importance;
- item importance;
- starvation age.

LOD sınıfları:

```text
hidden -> far -> mid -> near -> hero
```

Temporal hysteresis ile kamera küçük oynadığında candidate LOD sürekli ileri/geri zıplamaz.

Gerçek frustum culling veya GPU occlusion query yine renderer/scene owner'dadır.

## 6. Temporal occlusion hints

`occlusionHintPlanner.js` GPU query çalıştırmaz. Caller'ın verdiği görünürlük gözlemlerini confidence şeklinde tutar.

Uzun süre update almayan hint stale sayılır. Böylece stale “hidden” sonucu kalıcı bir bug'a dönüşmez.

Bu yaklaşım, GPU occlusion'ın gelecekte eklenebilmesi için backend-neutral bir seam oluşturur.

## 7. GPU instancing

`gpuInstanceBatchPlanner.js` repeated geometry/material çiftlerini deterministic batch'lere ayırır.

Özellikler:

- stable `geometryKey|materialKey|lod` grouping;
- tier-specific instance caps;
- thermal pressure adjustment;
- score-based selection;
- deferred list;
- input order invariance.

Actual `InstancedMesh` creation yapılmaz. Asset/scene owner batch descriptor'ını tüketir.

Bu foliage, rock, debris, crowd ve repeated props gibi yüksek tekrar oranlı content için kullanılabilir.

## 8. Texture residency

`textureResidencyPlanner.js` texture'ları screen coverage, distance, importance, tier ve compression bilgilerine göre
resident/deferred planına ayırır.

Planlama seviyesinde tahmini byte hesabı yapılır. Gerçek GPU allocation farklı olabileceği için bu sayı telemetry ve
budgeting içindir; authoritative GPU memory ölçümü loader/renderer katmanında kalır.

Resident texture bilgisi:

```text
id
mip
bytes
score
importance
coverage
distance
compressed
persistent
```

Budget dolduğunda düşük skorlu texture'lar deferred olur. Persistent texture'lar ayrı davranır.

## 9. Shader variant registry

`shaderVariantRegistry.js` WebGPU migration sırasında oluşan materyal varyantlarının combinatorial explosion'ını
kontrol etmek için vardır.

Canonical key:

```text
backend|quality|materialFamily|feature1,feature2,...
```

Feature sırası değişse bile key değişmez.

Registry:

- max variant;
- max request;
- bounded compile estimate;
- hit count;
- last requested frame
saklar.

Fiziksel shader compilation renderer/loader'a bırakılmıştır.

## 10. Material migration registry

`renderMaterialMigrationRegistry.js` mevcut material stack'in WebGPU hazır olup olmadığını takip eder.

Status değerleri:

- `native-node`
- `tsl-ready`
- `legacy-webgl`
- `blocked`
- `unknown`

`RawShaderMaterial` veya `onBeforeCompile()` gibi migration gerektiren yollar `blocked` seviyesine taşınabilir.

Bu bir compiler değildir. Görevi migration riskini görünür hale getirmek ve queue üretmektir.

## 11. Render pass budget

`renderPassBudgetPlanner.js` post-process veya custom pass'leri estimated GPU cost ve priority ile kabul/reject eder.

Hard rules:

- optional olmayan pass budget nedeniyle reddedilemez;
- optional pass'ler priority/cost sırasına göre değerlendirilir;
- total budget bounded;
- emergency mode daha düşük budget kullanabilir.

Bu mekanizma runtime quality controller ile birleştiğinde pahalı effect'ler frame pressure yükseldiğinde önce kapanabilir.

## 12. RenderPipeline composer

Three.js'in modern post-processing sistemi `RenderPipeline` üzerinden kurulabilir ve MRT + effect combination gibi
özellikler sağlanır. Bu composer sadece hangi effect'lerin kullanılabileceğini hesaplar; gerçek TSL node composition
renderer owner tarafından oluşturulur. citeturn254605search2turn254605search4

WebGPU path için örnek semantic descriptor:

```text
render-pipeline-tsl
  ├─ scene pass
  ├─ temporal history
  ├─ bloom
  ├─ ssao
  ├─ ssgi / dof (hardware/tier koşullu)
  └─ output transform
```

WebGL2 path daha konservatif tutulur.

## 13. Temporal history

`renderTemporalHistoryPolicy.js` history valid/invalid state'ini explicit yapar.

History reset sebepleri:

- bootstrap;
- resize;
- camera cut;
- backend recovery;
- render-scale jump;
- visibility gap;
- scene reset;
- quality change;
- manual.

Temporal history'nin geçersiz olduğu durumda renderer eski frame'i kullanmak yerine warm-up yoluna dönebilir.

Bu, özellikle dynamic resolution ve WebGPU recovery sonrası ghosting/ringing riskinin azaltılması için önemlidir.

## 14. Device loss recovery

WebGPU cihazı initialization sonrasında da kaybedilebilir. MDN, `GPUDevice.lost` Promise'inin cihaz kaybını bildirdiğini
ve resources'ın yeni device üzerinde yeniden yaratılması gerektiğini belirtiyor. citeturn254605search7

`renderDeviceRecovery.js`:

```text
healthy
  ↓
suspected-loss
  ↓
rebuilding
  ├─ success -> degraded -> healthy
  └─ repeated fail -> fallback -> exhausted
```

Recovery coordinator fiziksel texture/buffer recreate etmez. Bunun yerine renderer factory'ye `rebuild` ve `fallback`
callback'leri verir.

## 15. Frame packet

`renderFramePacket.js` render update'ını immutable bir packet'e çevirir. Packet:

- backend;
- tier;
- render scale;
- visibility;
- instance batches;
- texture residency;
- post-process effects;
- temporal history;
- recovery
alanlarını taşır.

GPU handles özellikle packet'e dahil edilmez. Böylece packet replay/debug artifact'i olabilir.

## 16. Unified orchestrator

`nextGenRenderOrchestrator.js` bütün policy katmanlarını tek bir `renderFrame(input)` çağrısında birleştirir.

Akış:

```text
input timings/capabilities
        ↓
pressure
        ↓
dynamic resolution
        ↓
pipeline policy
        ↓
feature negotiation
        ↓
visibility + instancing + texture residency
        ↓
shader registry
        ↓
frame graph
        ↓
temporal history/recovery
        ↓
metrics
        ↓
immutable frame packet
```

Bu orchestrator renderer oluşturmaz. Existing `nextGenRendererAdapter` ile birlikte composition root'ta kullanılmalıdır.

## 17. Browser capability assumptions

WebGPU `navigator.gpu` üzerinden adapter request eder ve secure context gerektirir. Adapter yoksa WebGL2 fallback seçilebilir.
MDN ayrıca `requestAdapter()`'ın worker ortamlarında da erişilebilir olabileceğini belirtiyor. citeturn254605search3

Canvas formatı gibi detaylar runtime tarafında preferred format ile belirlenebilir; hard-coded format varsayımları
platformdan platforma taşınmamalıdır. citeturn254605search6

## 18. PWA/mobile

Mobile/limited cihazlar için:

- dynamic resolution;
- lower texture budget;
- smaller instance cap;
- fewer optional passes;
- reduced shader compile queue;
- longer non-urgent refresh intervals
birlikte uygulanabilir.

Bu katman service worker, cache ve application lifecycle'ın sahibi değildir. Bunlar existing runtime layer'da kalır.

## 19. Acceptance invariants

Her production değişikliğinde:

```text
same input -> same policy digest
reverse input -> same semantic selection
malformed number -> no crash
budget exceeded -> bounded defer/reject
device loss -> bounded recovery
history reset -> explicit reason
WebGL2 -> no WebGPU-only effect leak
```

## 20. What is still intentionally outside

Bu round fiziksel GPU shader compilation, gerçek occlusion query, actual WebGPU bind-group creation,
TSL node authoring, asset decoding ve scene graph mutation'ını implementation katmanına bırakır.
Bunların policy contract'larını hazırlamak, henüz desteklenmeyen renderer API'lerini sahte olarak uygulamaktan daha güvenlidir.

## 21. Release process

1. Syntax checks
2. Core render contract
3. Adversarial capacity checks
4. Backend/tier matrix
5. Repeat determinism
6. Device-loss recovery test
7. Temporal-history invalidation test
8. Material migration test
9. `git diff --check`
10. >4,000 meaningful addition gate
11. PR mergeability and exact-head check
12. CI completion state verification

CI `queued/in_progress` ise PASS sayılmaz; release raporu bunu açıkça göstermelidir.
