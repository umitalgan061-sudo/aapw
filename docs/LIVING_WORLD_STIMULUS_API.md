# Living World Stimulus API Reference

## Public modules

### `livingWorldStimulusNormalizer.js`

`normalizeLivingWorldStimulus(input, index)`

Tek bir producer kaydını canonical signal'a çevirir.

Güvenlik özellikleri:

- primitive/null input kabul edilir;
- numeric değerler finite + clamp edilir;
- position eksikse null kalır;
- kind unknown ise `unknown` kullanılır;
- tag ve id uzunlukları sınırlandırılır;
- output frozen'dır.

`normalizeLivingWorldStimulusBatch(inputs)`

Batch'i capacity ile sınırlar ve stable order'a getirir.

`validateNormalizedStimulus(stimulus)`

Consumer'a geçmeden önce canonical shape kontrolü yapar.

`compareStimulusStableOrder(a, b)`

Timestamp → sequence → id sırasını verir.

## `livingWorldStimulusMemory.js`

`createLivingWorldStimulusMemory(options)`

Bounded temporal memory oluşturur.

Ana metotlar:

```js
accept(stimulus, nowSeconds)
prune(nowSeconds)
query(filter, nowSeconds)
latestForActor(actorId, nowSeconds)
strongest(filter, nowSeconds)
summarize(nowSeconds)
snapshot(nowSeconds)
clear()
dispose()
```

Memory revision yalnızca kabul/clear/dispose gibi mutation noktalarında artar. Snapshot semantic olarak
read-only'dir.

### Filter alanları

- `kind`
- `actorId`
- `targetId`
- `channel`
- `minConfidence`
- `maxAgeSeconds`

## `livingWorldStimulusSalience.js`

`scoreLivingWorldStimulus(stimulus, context, options)`

[0,1] aralığında bounded urgency score üretir.

`rankLivingWorldStimuli(stimuli, context, options)`

Score ve stable tie-break ile sıralar.

`summarizeSalience(ranked)`

count/max/mean/p50/p90 summary verir.

`salienceDigest(ranked)`

Debug/replay amacıyla stable textual digest verir.

## `livingWorldIntentArbiter.js`

`enumerateIntentCandidates(stimuli, options)`

Stimulus kind'larından olası intent'leri çıkarır.

`scoreLivingWorldIntent(intent, stimuli, state, capabilities, options)`

Base utility, state penalty, capability gate, stimulus relation ve stickiness'i birleştirir.

`arbitrateLivingWorldIntent({...})`

En yüksek intent'i immutable decision receipt olarak döndürür.

`validateIntentDecision(decision)`

Confidence range ve semantic intent geçerliliğini kontrol eder.

## Intent taxonomy

- idle
- investigate
- alert
- regroup
- flee
- pursue
- defend
- attack
- assist
- search
- retreat
- seek-shelter
- socialize
- gather
- patrol
- recover
- observe

Yeni intent eklenecekse `LIVING_WORLD_INTENTS`, kind mapping ve plan mapping birlikte güncellenmelidir.

## `livingWorldPlanGenerator.js`

`generateLivingWorldPlan({...})`

Semantic intent'i kısa plan receipt'ine dönüştürür.

Plan fields:

```js
{
  planId,
  intent,
  confidence,
  target,
  targets,
  steps,
  ttlSeconds,
  generatedAtTick,
  reasonCodes,
}
```

Step fields:

```js
{
  index,
  name,
  durationSeconds,
  interruptible,
  priority,
}
```

`planDigest(plan)` deterministic summary üretir.

`validateLivingWorldPlan(plan)` shape/range kontrolü yapar.

## `livingWorldStimulusOrchestrator.js`

`createLivingWorldStimulusOrchestrator(options)`

Pipeline'ın ana composition root'udur.

### `tickOnce`

```js
runtime.tickOnce({
  deltaSeconds,
  nowSeconds,
  actors,
  signals,
});
```

Return frame:

```js
{
  tick,
  nowSeconds,
  deltaSeconds,
  decisions,
  stats,
  memory,
}
```

Hard caps:

- signals per tick;
- plans per tick;
- actors per tick;
- memory records;
- history size.

### `decideActor`

Tek actor için current memory projection üzerinden karar/plan üretir.

### `ingest`

Producer signals kabul eder, normalize eder ve memory'ye işler.

### `snapshot`

Bounded runtime diagnostics verir.

### `reset` / `dispose`

State lifecycle'ını temiz biçimde kapatır.

## `livingWorldStimulusAdapter.js`

`createLivingWorldStimulusAdapter(options)`

Consumer subscription seam sağlar.

`subscribe(name, callback)` unsubscribe closure döndürür.

`tick(input)`:

1. signal ingress cap uygular;
2. orchestrator tick'i çalıştırır;
3. telemetry record eder;
4. audit gerçekleştirir;
5. digest ekler;
6. consumer'lara immutable frame dağıtır.

Consumer exception'ları pipeline'ı düşürmez; telemetry'ye yazılır.

## `livingWorldStimulusTelemetry.js`

Methods:

```js
count(name, delta)
gauge(name, value)
observe(name, value)
event(name, fields, timestampSeconds)
recordTick(frame)
snapshot()
reset()
dispose()
```

Telemetry transport içermez.

## `livingWorldStimulusAudit.js`

`livingWorldStimulusDigest(frame)`

Replay eşleşmesi için stable digest üretir.

`auditLivingWorldStimulusFrame(frame, options)`

Şunları kontrol eder:

- valid tick;
- plan budget;
- unique actor ids;
- intent existence;
- confidence bounds;
- plan step count;
- step duration.

`compareStimulusFrames(a, b)`

İki frame'in semantic digest'ini karşılaştırır.

`reorderInvariantStimuliDigest(factory, inputs)`

Actor ve signal arrays ters çevrilse bile aynı sonucu bekler.

## `livingWorldStimulusRolePolicy.js`

Built-in roles:

```text
civilian guard hunter predator prey
merchant traveler healer beast unknown
```

`getLivingWorldRoleProfile(role)` profile döndürür.

`applyRoleTuningToIntentScores(scored, role)` role utility uygular.

`roleCaution(role)` caution ratio verir.

## `livingWorldStimulusWorkBudget.js`

`createLivingWorldStimulusWorkBudget(options)`

`plan(actors, context)` actor'ları deterministic bucket'lara ayırır.

`select(actors, budget, context)` current frame budget'ına sığan actor setini seçer.

`starvationSnapshot()` uzun süredir seçilmeyen actor'ları raporlar.

## `livingWorldStimulusStarvationScheduler.js`

Alternatif starvation-aware selection katmanıdır.

Actor score:

```text
urgency × urgencyWeight
+ starvation × starvationWeight
+ freshness × freshnessWeight
```

Bu katman work budget ile beraber kullanılabilir; ikisi birbiriyle çelişen ownership taşımaz.

## `livingWorldStimulusPriorityPolicy.js`

Producer source conflict resolution sağlar.

Priority örneği:

```text
combat    1.00
player    0.95
faction   0.90
perception0.80
fauna     0.76
weather   0.65
quest     0.60
scripted  0.55
unknown   0.35
```

Yakın zaman + yakın spatial position + aynı kind/target olduğunda daha düşük öncelikli duplicate
suppression yapılabilir.

Bu suppression authoritative world truth değildir; yalnızca orchestration noise reduction'dır.

## `livingWorldStimulusBatchCoordinator.js`

`push(source, signals, receivedAtSeconds)` farklı producer streams'lerini toplar.

`seal(nowSeconds)` deterministic micro-batch döndürür.

`inspect()` pending load verir.

`reset()` / `dispose()` lifecycle'ı temizler.

## `livingWorldStimulusRecovery.js`

`assessLivingWorldStimulusHealth({ frame, telemetry, policy })`

Health mode:

- normal
- reduced
- severe
- safe

`recoveryRecommendations(health)` execution katmanına uygulanabilecek semantic öneriler verir.

Bu module renderer veya physics mutation yapmaz.

## `livingWorldStimulusSnapshot.js`

`createLivingWorldStimulusSnapshot({...})` bounded canonical snapshot üretir.

`serializeLivingWorldStimulusSnapshot(snapshot)` JSON serialization yapar.

`parseLivingWorldStimulusSnapshot(serialized)` schema kontrolü ile parse eder.

`snapshotDigest(snapshot)` basit deterministic digest üretir.

## Integration contract

Önerilen production composition:

```js
const batch = createLivingWorldStimulusBatchCoordinator();
const runtime = createLivingWorldStimulusOrchestrator();
const adapter = createLivingWorldStimulusAdapter({ orchestrator: runtime });

adapter.subscribe('npc', (frame) => npcOwner.consumeStimulusFrame(frame));
adapter.subscribe('fauna', (frame) => faunaOwner.consumeStimulusFrame(frame));

function simulationTick(context) {
  const sealed = batch.seal(context.simulationSeconds);
  return adapter.tick({
    deltaSeconds: context.deltaSeconds,
    nowSeconds: context.simulationSeconds,
    actors: context.reactiveActors,
    signals: sealed.signals,
  });
}
```

NPC/fauna owner planı aldıktan sonra kendi authoritative checks'ini tekrar etmelidir.

## Compatibility

Module'ler ECMAScript module syntax kullanır ve DOM/Three.js bağımlılığı taşımaz. Node headless regression
altında çalışabilmeleri intentional bir contract'tır. Browser integration yalnızca composition root'ta
başlatılmalıdır.

## Error contract

Malformed producer input runtime exception'a dönüşmemelidir. Public methods fail-closed davranış gösterir:

- invalid signal -> reject;
- invalid actor -> skip;
- invalid plan -> no plan;
- disposed runtime -> immutable disposed response;
- consumer error -> telemetry + continue.

Bu sözleşme, bütün consumer'ların exception-safe olduğu varsayımını ortadan kaldırır.
