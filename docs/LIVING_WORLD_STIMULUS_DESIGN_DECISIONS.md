# Living World Stimulus Design Decisions

## D1 — Semantic signal yerine doğrudan behavior
Pipeline yalnızca semantic intent ve kısa plan üretir. Bunun nedeni hareket, combat, dialogue, faction
ve fauna sahiplerinin aynı actor üzerinde aynı anda gerçek state mutation yapabilmesidir. Merkezi bir
behavior executor kurmak kısa vadede kolay görünse de mevcut ownership sınırlarını bozar.

Karar: orchestration output immutable receipt olacak, execution mevcut owner'da kalacak.

## D2 — Wall clock kullanılmaması
Browser `Date.now()` veya frame timestamp'i replay semantiği için güvenilir değildir. Background tab,
mobile throttling ve farklı refresh rate'ler farklı çıktı üretebilir.

Karar: tüm temporal hesaplar caller-owned `nowSeconds`, `deltaSeconds`, `tick` üzerinden yapılır.

## D3 — Random olmaması
Stimulus salience ve arbitration içinde random tercih edilebilir görünse de aynı input'un farklı run'da
farklı davranması diagnostics'i ve replay'i zorlaştırır.

Karar: bu katmanda random dependency yoktur. Çeşitlilik gerekiyorsa producer canonical seed ile
signal çeşitliliğini sağlar ve orchestrator bunu deterministic olarak işler.

## D4 — Unknown input'un crash yerine unknown'a düşmesi
Living-world producer'lar uzun ömürlüdür ve bazıları migration sırasında yeni `kind` üretebilir.
Bir unknown stimulus yüzünden bütün runtime tick'ini düşürmek çok yüksek blast-radius taşır.

Karar: bilinmeyen kind `unknown` olarak normalize edilir. Geçersiz numeric input safe range'e çekilir.

## D5 — Explicit source priority
Aynı olay perception ve combat tarafından raporlanabilir. İkisini eşit ağırlıkta tutmak duplicate
noise üretir; birini tamamen atmak ise bağımsız bağlam kaybına yol açar.

Karar: source priority yalnızca orchestration duplicate suppression için kullanılır. Authoritative
truth yerine geçmez.

## D6 — Memory bounded olmalı
Bir dünya simülasyonu event cache'i sınırsız büyürse PWA/mobile memory pressure artar ve GC jitter
oluşur.

Karar: toplam record, kind ve actor caps ayrı ayrı uygulanır. Expiry caller time ile değerlendirilir.

## D7 — Work budget starvation'ı explicit izlemeli
Sadece `top N` actor seçmek düşük salience actor'ların sonsuza kadar atlanmasına neden olabilir.

Karar: stable buckets + starvation debt kullanılır. Urgent actor hard cap ile öne alınır fakat bütün
budget'i monopolize etmesine izin verilmez.

## D8 — Role tuning semantic olmalı
Civilian, guard, predator gibi rolleri doğrudan behavior code'a bağlamak yeni FSM'ler yaratır.

Karar: role yalnızca intent utility tuning yapar. Faction, personality ve behavior state başka
sistemlerde kalır.

## D9 — Plan kısa ömürlü olmalı
Uzun süreli behavior plan'ı actor state değiştikten sonra stale hale gelir.

Karar: plan TTL kısa tutulur ve consumer execution öncesinde kendi current truth'unu yeniden doğrular.

## D10 — Consumer error isolate edilmeli
Bir NPC consumer'ı exception fırlattığında diğer NPC'lerin decisions'ını kaybetmek gereksizdir.

Karar: adapter consumer callback'lerini isolate eder, hata telemetry'ye yazılır ve diğer consumer'lar
çalışmaya devam eder.

## D11 — Snapshot canonical olmalı
Debug artifact'leri callback veya Map gibi runtime implementation details içerirse diff/replay için
kararsız hale gelir.

Karar: snapshot sadece bounded semantic data içerir; arrays stable sort ile canonical hale getirilir.

## D12 — Recovery semantic öneri üretmeli
Memory pressure veya consumer error arttığında orchestrator'ın renderer/physics'ı kendisinin kapatması
ownership ihlali olur.

Karar: recovery yalnızca `normal/reduced/severe/safe` önerir. Application/runtime root gerçek degradation'ı
uygular.

## D13 — Browser compatibility
Bu katman headless Node testinde de çalışmalıdır. PWA service worker veya DOM listener dependency'si
runtime testini gereksiz yere pahalı hale getirir.

Karar: domain modules pure ESM ve browser/Node ortak subset kullanır. Lifecycle integration üst seviyeye
bırakılır.

## D14 — Reorder invariance
Asenkron producer'lar sinyalleri farklı sırada verebilir. Semantic sonucu array arrival order'a bağlamak
nondeterminism üretir.

Karar: normalization timestamp/sequence/id stable order, ranking score + id tie-break kullanır.

## D15 — Capacity gates semantic contract'tır
Caps sadece performans için değil, correctness için de gereklidir. Unlimited input küçük bir testte sorun
çıkarmazken gerçek world event storm sırasında bütün frame budget'ini tüketebilir.

Karar: input, memory, plan, actor, target, history ve telemetry ayrı bounded collections olarak tasarlanır.

## D16 — Existing AI hardening ile birlikte çalışmalı
AAPW'deki existing perception hardening malformed position, LOS ve hearing gibi domain-specific checks
sağlar. Yeni layer bunları bypass etmemelidir.

Karar: stimulus normalizer yalnızca orchestration trust boundary'dir; authoritative perception result'in
üzerine yeni LOS veya hit semantics yazılmaz.

## D17 — Multiplayer-ready, multiplayer-authoritative değil
Deterministic semantic decisions client/server debugging için yararlı olabilir ancak orchestration
katmanı anti-cheat veya reconciliation sistemi değildir.

Karar: network integration ileride ayrı trust boundary ile yapılır.

## D18 — Telemetry transport-neutral
Analytics SDK veya `fetch()` doğrudan gameplay loop'a bağlanırsa offline PWA ve privacy/latency concerns
artabilir.

Karar: telemetry memory-only bounded projection'dır. Export composition root'un sorumluluğudur.

## D19 — Recovery after disposal fail-closed
SPA route changes veya PWA worker lifecycle sırasında stale references kalabilir.

Karar: disposed runtime hiçbir yeni mutation veya callback delivery başlatmaz.

## D20 — Test layers
Tek bir büyük end-to-end test suite yerine contract, extended, fuzz, replay, integration matrix ve
benchmark smoke ayrı tutulur. Bu ayrım hangi invarianta zarar geldiğini hızla göstermeyi sağlar.

## D21 — Benchmark result'in anlamı
Benchmark absolute FPS garantisi vermez. Node runtime'daki orchestration cost'unun trendini gösterir.
Browser render, GPU, network ve actual world size ayrı profillerdir.

## D22 — Version policy
Semantic breaking changes yeni policy id ile yayınlanmalıdır. Existing consumer'ların sessizce
farklı plan alması yerine compatibility path açıkça yönetilmelidir.

## D23 — No second ActorRegistry
Actor listesi input'tur; orchestrator actor lifecycle sahibi değildir. Böylece existing registry,
spatial partitioning ve replication sistemleri aynı authoritative entity setini kullanmaya devam eder.

## D24 — No hidden renderer ownership
Stimulus events bazen animation/VFX çağrısına ihtiyaç duyabilir. Bu çağrı burada yapılmaz; plan sadece
consumer-facing semantic intent döndürür.

## D25 — Data-first integration
Producer'lar ileride event bus veya network adapter üzerinden gelse bile canonical stimulus formatı
aynı kalır. Bu, integration complexity'yi producer sayısıyla birlikte katlanarak büyütmek yerine tek
trust boundary'de toplar.
