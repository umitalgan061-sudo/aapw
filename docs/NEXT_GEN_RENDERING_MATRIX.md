# Next-Generation Rendering Acceptance Matrix

Bu matris rendering hardening katmanını backend, kalite, cihaz baskısı ve accessibility değişimleri altında kontrol
eder. Amaç herhangi bir tek cihazı “garantilemek” değil, policy'nin tüm kombinasyonlarda geçerli ve bounded kalmasını
sağlamaktır.

## Backend matrisi

| Backend | WebGPU available | Beklenen davranış |
| --- | --- | --- |
| webgpu | true | WebGPURenderer path kullanılabilir |
| webgpu | false | WebGL2 fallback |
| webgl2 | true | WebGL2 zorlanır |
| webgl2 | false | renderer adapter caller'a failure döndürür |

WebGPURenderer resmi kılavuzu WebGPU backend'i ve WebGL2 fallback'i desteklediğini belirtiyor. Bu proje ayrıca
initialization failure'ı da fallback kararının parçası kabul eder.

## Quality matrisi

```text
minimal
balanced
high
ultra
```

Her tier şu alanlarda kontrol edilir:

- effect availability;
- render scale;
- MSAA sample policy;
- output buffer type;
- temporal history;
- MRT;
- instance cap;
- texture budget;
- post-process budget.

## Thermal matrisi

```text
0.0  nominal
0.5  warning boundary
0.8  elevated
0.9  critical
1.0  emergency
```

Thermal pressure yükseldiğinde policy'nin aşağıdakileri azaltması beklenir:

```text
expensive effects
render scale
instance work
texture residency
background refresh
```

Thermal pressure simulation state değildir.

## Accessibility matrisi

### Reduced motion false

Temporal history ve visual effects normal policy ile değerlendirilebilir.

### Reduced motion true

Policy visual motion intensity'yi azaltabilir ve temporal history/animated presentation gibi feature'ların
kullanımını sınırlar. Render stack'i doğrudan input veya gameplay state'ine dokunmaz.

## Memory matrisi

Texture planner aşağıdaki budget örneklerinde çalışmalıdır:

```text
64 MB
128 MB
192 MB
256 MB
512 MB
768 MB
```

Her durumda resident/deferred list bounded olmalıdır. Persistent texture'lar budget politikasına explicit exception
olarak işaretlenir.

## Instance matrisi

```text
256 / tier-minimal
768 / balanced
1536 / high
2048 / ultra
```

Input 8K veya daha fazla olsa bile batch sayısı ve instance count bounded kalmalıdır.

## Render pass matrisi

Pass planner şu davranışları kontrol etmelidir:

- mandatory pass budget dışında da korunur;
- optional pass cost/priority sırasıyla değerlendirilir;
- backend unsupported pass'ler düşürülür;
- emergency budget normal budget'tan daha sıkıdır;
- aynı input sırası değişse de selected digest aynı kalır.

## Temporal history matrisi

History reset tetikleyicileri:

```text
bootstrap
resize
camera-cut
backend-recovery
render-scale-jump
visibility-gap
scene-reset
quality-change
manual
```

Özellikle dynamic resolution testlerinde iki snapshot arasındaki scale farkı threshold'u geçince history invalid
olmalıdır.

## Device loss matrisi

### Attempt 0

Healthy state.

### Attempt 1

Rebuilding.

### Attempt 2

Still rebuilding veya degraded.

### Threshold sonrası

Fallback backend önerisi.

### Budget sonrası

Exhausted.

Recovery object renderer resource ownership taşımaz. Yeni device oluşturma ve eski GPU resources'ın disposal'ı
renderer owner'ın işidir.

## Shader variant matrisi

Variant key şu değişkenleri normalize etmelidir:

```text
backend
quality
materialFamily
feature set
```

Feature input sırasının değişmesi aynı canonical key'i üretmelidir.

Variant registry overflow olduğunda yeni variant reject edilmelidir; sınırsız map büyümesine izin verilmez.

## Material migration matrisi

```text
node-material / TSL -> ready
ShaderMaterial       -> legacy-webgl
RawShaderMaterial    -> blocked
onBeforeCompile      -> blocked
unknown              -> unknown
```

Migration registry implementation'ı değiştirmez; risk görünürlüğü sağlar.

## Visibility matrisi

Candidate input 4,096 ile sınırlandırılır. Output 2,048 ile sınırlandırılır. Her LOD için ayrıca quota vardır.

Temporal hysteresis küçük score değişikliklerinde LOD thrashing'i önlemelidir.

Occlusion hint cache stale olursa stale hint'in kalıcı hide kararı vermesine izin verilmez.

## Determinism matrisi

Aşağıdaki iki input aynı digest'i üretmelidir:

```text
input A
  actors: [a,b,c]
  renderables: [1,2,3]

input B
  actors: [c,a,b]
  renderables: [3,1,2]
```

Aynı simulation tick, backend, policy ve numeric input varsayıldığında semantic selection eşit olmalıdır.

Bu testler render backend'i gerçekten çizdirmeden headless Node environment içinde çalışır.

## Adversarial matrisi

Kontrol edilmesi gereken bozuk girişler:

```text
null
undefined
NaN
Infinity
-Infinity
negative width/height
zero budget
negative budget
10000 renderables
10000 textures
10000 shader requests
missing ids
empty material keys
unknown backend
unknown tier
unknown effect
```

Beklenen sonuç crash değil, clamp/reject/defer/fallback davranışıdır.

## PWA/mobile matrisi

Runtime layer üzerinden şu sinyaller uygulanabilir:

```text
save-data
reduced-motion
low memory
low CPU core count
high DPR
hidden visibility
```

Bunlar render policy'yi etkileyebilir ancak world simulation truth'i değiştirmemelidir.

## CI acceptance

Bir render hardening PR'ı için minimum acceptance:

1. all new source syntax;
2. comprehensive contract;
3. adversarial capacity;
4. backend-tier matrix;
5. repeat deterministic output;
6. frame-packet validation;
7. device recovery;
8. material migration;
9. texture/instance budget;
10. `git diff --check`;
11. ownership scan;
12. >4,000 meaningful addition gate.

Workflow `queued` veya `in_progress` durumunda ise tamamlanmış PASS sonucu verilmemelidir.

## Browser migration note

Three.js WebGPURenderer'in modern post-processing sistemi RenderPipeline ve TSL ile çalışır; EffectComposer tabanlı
legacy yaklaşım aynı semantics'e sahip değildir. Bu nedenle policy module yalnızca descriptor üretir ve backend-specific
TSL node composition ayrı tutulur.

MRT ile çoklu attachment kullanıldığında her attachment'ın precision/type maliyeti ayrı değerlendirilmelidir.
Gereksiz RGBA16 çıktılar texture/bandwidth maliyetini yükseltebilir.

## Release interpretation

Matrix PASS, her gerçek cihazda performans garantisi anlamına gelmez. PASS şu anlama gelir:

- policy geçerli;
- output bounded;
- backend capability doğru;
- determinism korunuyor;
- recovery state bounded;
- memory/instance/pass work bounded;
- migration state görünür.

Gerçek browser GPU validation ayrıca yapılmalıdır.
