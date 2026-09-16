# Living World Stimulus Orchestration

## Amaç

AAPW'nin yaşayan dünya katmanında perception, reaction, faction ve fauna sistemlerinden gelen farklı
uyaranları ortak bir deterministik semantic pipeline'a taşımak için eklenen composition katmanıdır.
Bu katman davranışı yürütmez. Yalnızca mevcut sahiplerin tüketebileceği güvenli bir karar/plan zarfı
üretir.

## Mimari sınır

```text
existing perception / reaction / faction / fauna
                 │
                 ▼
      stimulus normalizer
                 │
                 ▼
         temporal memory
                 │
                 ▼
          salience scoring
                 │
                 ▼
          intent arbiter
                 │
                 ▼
         plan generator
                 │
                 ▼
        consumer adapter
                 │
        ┌────────┼──────────┐
        ▼        ▼          ▼
   navigation   combat   social/ecology
```

Aşağıdaki sahiplikler değiştirilmez:

- ActorRegistry actor lifecycle'ın sahibidir.
- navigation gerçek rota/steering üretiminin sahibidir.
- combat damage, health, hit detection ve timing'in sahibidir.
- faction sistemi ilişki/kanun/itibar gerçeklerinin sahibidir.
- fauna ecology habitat, threat-memory ve popülasyon gerçeklerinin sahibidir.
- WorldEvent dünya çapı olayların authoritative sahibidir.
- renderer, audio, AnimationMixer ve scene graph bu katmanda oluşturulmaz.

## Stimulus normalizer

`livingWorldStimulusNormalizer.js` güvenilmeyen girdileri tek bir forma indirger. Numeric değerler
finite/clamp üzerinden sınırlandırılır. Kimlik, tag ve metadata alanları boyutlandırılır. Bilinmeyen
kind değerleri hata fırlatmak yerine `unknown` olarak normalize edilir. Bu, browser event, world event,
NPC perception ve scripted encounter kaynaklarının aynı tüketim sözleşmesine bağlanmasını sağlar.

Bir stimulus şu kavramları taşıyabilir:

- `kind`: combat, damage, death, alarm, noise, fire, weather, resource, threat, sighting, territory,
  social, quest, environment veya unknown;
- `channel`: visual, auditory, tactical, social, environmental veya system;
- actor/target/faction kimlikleri;
- world-space position;
- confidence, intensity, radius;
- timestamp ve sequence;
- persistent/urgent/synthetic metadata.

## Temporal memory

`livingWorldStimulusMemory.js` caller-owned zaman ile yaşlandırma yapar. Wall-clock kullanmaz.
Her stimulus için bounded TTL uygulanır; combat/death gibi olaylar daha uzun tutulur, weather/environment
uzun ömürlü olabilir. Toplam record sayısı, kind başına sayısı ve actor başına sayısı ayrı ayrı sınırlıdır.

Bu yapı replay için önemlidir: aynı stimulus dizisi ve aynı caller clock aynı memory projection'ını üretir.
Memory yalnızca read-only projection sağlar; actor state'i değiştirmez.

## Salience

`livingWorldStimulusSalience.js` ham sinyalleri urgency benzeri [0,1] aralığında karşılaştırılabilir
skorlara dönüştürür.

Temel bileşenler:

```text
salience ≈ kindWeight × channelWeight × confidence × intensity
         × distanceFalloff × ageDecay × radiusFactor
         + persistent/urgent boost
```

Distance, observer position mevcutsa uygulanır. Observer position yoksa sistem safe/default davranışa
döner; bilinmeyen konum üzerinden agresif tahmin yapılmaz.

## Intent arbitration

`livingWorldIntentArbiter.js` mevcut stimulus setinden semantic intent seçer. Intent örnekleri:
`idle`, `investigate`, `alert`, `regroup`, `flee`, `pursue`, `defend`, `attack`, `assist`, `search`,
`retreat`, `seek-shelter`, `socialize`, `gather`, `patrol`, `recover`, `observe`.

Arbiter üç ana sinyali birleştirir:

1. stimulus ile intent arasındaki semantik uygunluk;
2. actor state ve resource güvenliği;
3. capability gate.

Örneğin defeated bir actor için saldırı niyeti cezalandırılır; `canAttack=false` olan actor için
attack kapısı fail-closed olur. Bu karar hâlâ davranışı yürütmez.

## Role tuning

`livingWorldStimulusRolePolicy.js`, civilian, guard, hunter, predator, prey, merchant, traveler,
healer ve beast gibi profile'lar üzerinden semantic intent ağırlıkları uygular. Bu, aynı perception
set'inin farklı actor archetype'larında farklı önceliklere dönüşmesine izin verir.

Role policy yalnızca utility tuning yapar. Faction relation, personality persistence, dialogue state
ve combat truth başka sistemlerde kalır.

## Plan generator

`livingWorldPlanGenerator.js` intent'i kısa bir action plan'a çevirir:

```text
attack      -> orient -> approach -> engage
flee        -> orient -> retreat -> retreat
investigate -> orient -> approach -> observe
assist      -> orient -> approach -> assist
seek-shelter-> orient -> approach -> shelter -> hold
```

Adımlar kısa ömürlüdür, bounded duration taşır ve interruptibility semantic olarak belirtilir.
Gerçek movement veya combat çağrısı yapılmaz. Consumer, elindeki authoritative systems ile plan adımını
uygular veya reddeder.

## Work budget

`livingWorldStimulusWorkBudget.js`, büyük actor popülasyonlarında bütün actor'ların her tick'te yeniden
hesaplanmasını engelleyen deterministic bucket modelidir.

Actor id stabil hash ile bucket'a atanır. Seçim priority, urgency ve starvation age ile sıralanır.
Urgent actor'lar için ayrıca hard cap bulunur. Böylece yoğun encounter anlarında iş bütçesi burst yapmaz.

Bu sistem LOD değildir; simülasyon ownership'ini değiştirmeden orchestration maliyetini sınırlar.

## Runtime

`livingWorldStimulusOrchestrator.js` şu lifecycle'ı sağlar:

```js
runtime.tickOnce({
  deltaSeconds,
  nowSeconds,
  actors,
  signals,
});
```

Output immutable bir frame'dir. Frame aşağıdakileri içerir:

- tick, nowSeconds, deltaSeconds;
- generated semantic decisions;
- actor bazında intent receipt;
- plan ve target;
- aggregate salience;
- bounded memory statistics;
- acceptance/rejection/work counters.

Aynı input, aynı actor state ve aynı clock ile tekrarlandığında digest eşitliği beklenir.

## Adapter

`livingWorldStimulusAdapter.js` runtime ile mevcut owners arasında transport-neutral bir seam sağlar.
Consumer subscribe edebilir ancak adapter şu işlemleri yapmaz:

- player/NPC position mutate etmek;
- navigation path açmak;
- damage vermek;
- health/stamina değiştirmek;
- AnimationMixer action çalıştırmak;
- scene object yaratmak;
- network isteği başlatmak;
- world persistence yazmak.

Bu ayrım, AAPW'deki çok sayıdaki domain-specific director'ın birbirini tekrar eden framework'lere
dönüşmesini engeller.

## Telemetry

`livingWorldStimulusTelemetry.js` transport-neutral bounded telemetry sağlar:

- ticks;
- decisions;
- accepted/rejected signals;
- intent counters;
- confidence histogramları;
- decisions-per-tick;
- audit failures;
- consumer errors.

Telemetry network sender değildir. Export kararını composition root verir.

## Determinism ve audit

`livingWorldStimulusAudit.js` frame digest üretir. Digest actor id'lerini stabil sırada işleyerek
input actor array sırasına bağımlılığı kaldırır. Audit, plan count, confidence range, step duration,
duplicate actor ve tick geçerliliğini kontrol eder.

İki koşul özellikle korunur:

1. malformed numeric input crash üretmemelidir;
2. actor/signal sırası değiştiğinde semantic sonuç değişmemelidir.

## Fail-safe davranış

Beklenmeyen veri geldiğinde pipeline:

- normalize eder;
- cap uygular;
- geçersiz stimulusları reddeder;
- belirsiz intent'i observe/idle'a düşürür;
- plan üretilemezse `null` veya önceki bounded planı korur;
- disposed runtime'da mutation yapmaz.

Bu davranış browser/PWA runtime'ında tek bir malformed world event yüzünden tüm uygulamanın düşmesini
engellemek için tasarlanmıştır.

## Test matrix

### Functional

- tüm stimulus kind/channel kombinasyonları;
- confidence/intensity/radius clamp;
- memory TTL;
- kind/actor memory caps;
- salience distance/age decay;
- intent capability gates;
- role tuning;
- plan target selection;
- work budget bucket stability;
- consumer subscription lifecycle.

### Adversarial

- NaN/Infinity;
- null/primitive input;
- 10x capacity input;
- duplicate identities;
- reversed arrays;
- stale timestamps;
- defeated actors;
- unavailable capabilities;
- disposal sırasında tick/ingest;
- over-budget plan generation.

### Determinism

Aynı seed gerekmese bile bu layer random kullanmaz. Aynı canonical actor/stimulus snapshot ve aynı
caller time-line iki çalıştırmada aynı digest'i üretmelidir. Bu nedenle replay harness'e bağlanması
kolaydır.

## Production integration pattern

```js
const runtime = createLivingWorldStimulusOrchestrator({
  policy: { maxActorsPerTick: 64 },
});

function updateWorld(frame) {
  const result = runtime.tickOnce({
    deltaSeconds: frame.deltaSeconds,
    nowSeconds: frame.simulationSeconds,
    actors: frame.reactiveActors,
    signals: frame.perceptionSignals,
  });

  for (const decision of result.decisions) {
    existingActorOwner.consumeStimulusPlan(decision);
  }
}
```

Mevcut actor owner planı consume eder; planın gerçek hareket/combat sonucu o owner'da kalır.

## Gelecek entegrasyonlar

Bu layer'ın doğal sonraki kullanıcıları:

- faction response runtime;
- fauna ecology director;
- settlement activity director;
- combat alert/engagement consumer;
- weather activity scheduler;
- quest/world-event bridge.

Bu sistemlerin hiçbiri burada yeniden implemente edilmez.

## Operasyonel kabul

Merge edilmeden önce aşağıdaki kanıtlar aranmalıdır:

- core executable test PASS;
- extended/adversarial test PASS;
- repeated digest equality;
- malformed input coverage;
- bounded memory/work budget evidence;
- exact-head repository checks;
- PWA/cache regression;
- browser smoke/console regression;
- final main/head freshness check.

CI tamamlanmadıysa başarı varsayılmaz. Bir workflow queued/in_progress ise durum buna göre raporlanır.
