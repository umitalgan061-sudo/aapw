# Living World Stimulus Production Playbook

## 1. Composition root

Stimulus orchestration yalnızca simulation composition root'ta oluşturulmalıdır. Actor controller,
perception, faction veya fauna modüllerinin kendi içinde ayrı orchestrator instance'ları üretmekten
kaçınılır; aksi halde aynı event seti farklı memory ve cooldown state'lerinde değerlendirilir.

Önerilen yer:

```text
application
 └─ simulation root
     ├─ perception producers
     ├─ world-event producers
     ├─ combat/faction/fauna producers
     └─ living-world stimulus orchestrator
          └─ semantic consumers
```

## 2. Tick contract

Her simulation tick için tek canonical time value kullanılmalıdır:

```js
const frame = stimulusRuntime.tickOnce({
  deltaSeconds: simulation.deltaSeconds,
  nowSeconds: simulation.seconds,
  actors: simulation.reactiveActors,
  signals: simulation.stimulusSignals,
});
```

`performance.now()`, `Date.now()` veya render clock başka bir domain olarak geçirilmemelidir.

## 3. Producer onboarding

Yeni bir producer eklenirken önce signal schema'sı belirlenir. Minimum alanlar:

```js
{
  id,
  kind,
  channel,
  actorId,
  targetId,
  position,
  confidence,
  intensity,
  timestampMs,
  sequence,
}
```

Producer mümkün olduğunca semantic fact sağlamalıdır. Örneğin `player-is-angry=true` yerine `alarm`
veya `threat` gibi downstream tarafından anlaşılabilir bounded kind tercih edilir.

## 4. Perception onboarding

Perception sonucu zaten LOS, hearing, visibility ve stealth gibi domain checks içeriyorsa bunlar
normalizer'a taşınmamalıdır. Normalizer yalnızca shape/range güvenliği sağlar.

Bu ayrım şu davranışı korur:

```text
perception truth
    ↓
canonical stimulus
    ↓
common salience
```

Böylece aynı “threat” signal'ı farklı source'lar için ortak score alırken perception'ın gerçek LOS
kararı kaybolmaz.

## 5. Combat onboarding

Combat producer, damage/hit/parry/death gibi sonuçları signal olarak yayınlayabilir. Ancak stimulus
pipeline içinde:

- damage uygulanmaz;
- health değiştirilmez;
- hitbox çalıştırılmaz;
- attack timer değiştirilmez;
- stamina mutate edilmez.

Combat owner güncel state'i authoritative olarak tutar.

## 6. Faction onboarding

Faction eventleri `alarm`, `territory`, `social`, `threat` gibi semantic signal'lara çevrilebilir.
Relation matrix veya law state orchestrator'a taşınmamalıdır.

Örnek:

```js
{
  kind: 'territory',
  source: 'faction',
  factionId: 'north-watch',
  actorId: 'guard-17',
  targetId: 'intruder-9',
  confidence: 0.96,
  intensity: 0.7,
}
```

Intent arbiter bunu `defend`, `alert` veya `pursue` için utility signal'ına çevirebilir; faction
truth değişmez.

## 7. Fauna onboarding

Fauna ecology already habitat suitability ve threat memory sağlayabilir. Orchestrator bunları yeniden
hesaplamaz. Ecology director'dan gelen high-level threat/activity result semantic stimulus olarak
kullanılabilir.

Canonical actor capabilities fauna role ile uyumlu tutulmalıdır. Predator için `canPursue`, prey için
`canPursue=false` gibi capability gates açıkça taşınır.

## 8. Role data lifecycle

Role değişebilen actor'larda role snapshot tick başlangıcında canonical hale getirilmelidir. Tick
ortasında role mutate edilirse aynı frame'in kararları farklı branch'lerde farklılaşabilir.

Öneri:

```text
actor registry snapshot
        ↓
stimulus tick input
        ↓
role policy
        ↓
intent receipt
```

Role policy cache'lenebilir fakat cache invalidation actor owner tarafından yapılmalıdır.

## 9. Work budget rollout

İlk production rollout sırasında work budget conservative değerlerle başlatılmalıdır. Ana risk actor
update sayısını azaltırken acil reaction latency'sinin artmasıdır.

Ölçülecek sinyaller:

- selected actors per tick;
- urgent selected;
- starvation max;
- mean age of unselected actors;
- decision latency;
- plan rejection.

Starvation count düzenli olarak yükseliyorsa bucket count veya max-per-tick yeniden ayarlanmalıdır.

## 10. Recovery rollout

Recovery mode yalnızca bir recommendation'dır. Application runtime şu map'i kullanabilir:

```text
normal  -> full semantic workload
reduced -> non-urgent refresh x0.5
severe  -> non-urgent refresh x0.25 + duplicate suppression
safe    -> observe/recover only
```

Buradaki “x0.5” veya “x0.25” hard gameplay rule değildir; deployment policy ile ayarlanabilir.

## 11. Consumer ordering

Multiple consumer callback'leri semantik olarak bağımsız olmalıdır. Callback A'nın callback B'nin
input'unu mutate etmesi deterministic contract'ı bozar.

Adapter frame'i immutable olduğu için normal durumda bu kolayca engellenir. Consumer'ların kendi
mutable state'leri dışında shared frame mutate etmeye çalışmaması beklenir.

## 12. Stale plan handling

Plan short-lived olduğu için consumer şu kontrolleri yapmalıdır:

1. actor hâlâ mevcut mu?
2. actor defeated mı?
3. current simulation tick plan tick'inden çok uzak mı?
4. target hâlâ mevcut mu?
5. combat/navigation owner planı kabul ediyor mu?

Herhangi biri false ise plan discard edilebilir. Orchestrator bunun sonucu authoritative state'e
uygulamaz.

## 13. Replay capture

Production bug investigation gerektiğinde tüm world'ü dump etmek yerine semantic snapshot almak daha
ucuzdur:

```js
const snapshot = createLivingWorldStimulusSnapshot({
  tick,
  nowSeconds,
  actors,
  signals,
  plans: frame.decisions,
  metadata: { source: 'bug-report', session: runId },
});
```

Snapshot serializable olduğundan artifact olarak saklanabilir. Digest aynı olduğunda decision pipeline
aynı semantic input'tan aynı output'u üretmiş demektir.

## 14. Regression triage

Bir replay digest değişirse şu sırayla incele:

```text
main SHA
  ↓
policy id changes
  ↓
producer signal diff
  ↓
role/capability diff
  ↓
clock/tick diff
  ↓
normalizer diff
  ↓
salience diff
  ↓
intent score diff
  ↓
plan diff
```

Bu sırayı izlemek “NPC neden farklı davrandı?” sorusunu domain owner'a geri map etmeyi kolaylaştırır.

## 15. Performance acceptance

Benchmark absolute FPS hedefi değildir. Öncelik worst-case bound'dur:

- signal ingress bounded;
- actor scan bounded;
- target list bounded;
- memory bounded;
- telemetry bounded;
- history bounded;
- callback count bounded.

Frame time yükseliyorsa önce cap'ler ve work budget gözden geçirilmelidir. Sonra salience/plan
complexity optimize edilir.

## 16. Mobile/PWA

Mobile için reduced-motion preference behavior planını değiştirmek zorunda değildir; yalnızca optional
presentation consumer katmanlarını etkileyebilir.

Save-data aktifse signal ingestion frequency veya non-urgent workload azaltılabilir. Network condition
semantic world truth olarak kullanılmamalıdır.

PWA offline state'de local stimulus producer'lar çalışabilir; remote producer unavailable ise missing
signal “false” kabul edilmemelidir. Bunun yerine stimulus absence/information confidence ayrımı korunur.

## 17. Security boundary

Remote stimulus gelecekte desteklenirse untrusted network data olarak ele alınmalıdır. Normalizer tek
başına anti-cheat değildir; ancak excessive payload, invalid numeric values, oversized strings ve
unknown kinds için ilk bounded boundary'dir.

Authoritative remote actions server/gameplay owner tarafından ayrıca doğrulanmalıdır.

## 18. Observability dashboard

Production dashboard minimum:

```text
accepted / rejected per tick
memory utilization
work budget utilization
starvation p95
plan generation count
plan rejection count
intent distribution
confidence p50 / p95
consumer error count
audit failure count
```

Intent distribution environment değişimleriyle doğal olarak değişebileceği için tek başına quality
metric sayılmamalıdır. Daha çok regression detection için kullanılır.

## 19. Alert rules

Öneri:

```text
consumer.errors > 3      -> reduced/severe
 audit.failures > 2      -> reduced
memory > 90%             -> reduced
work budget = 100%       -> severe
starvation > threshold   -> workload rebalance
```

Threshold'lar deployment-specific olabilir. Önemli olan mode transition'ın deterministic olmasıdır.

## 20. Cleanup

Route unload veya simulation teardown sırasında:

```js
adapter.dispose();
```

çalıştırılmalıdır. Producer listener cleanup farklı owner'lardadır. Stimulus layer yalnızca kendi
Maps/history/telemetry collections'ını temizler.

## 21. Upgrade procedure

Policy breaking change gerekiyorsa:

1. yeni policy id;
2. dual-run replay comparison;
3. digest difference artifact;
4. targeted migration note;
5. consumer compatibility verification;
6. CI exact-head check.

Sessiz semantic drift kabul edilmemelidir.

## 22. Definition of Done

Production'a alınan bir stimulus feature için:

- semantic owner tanımlı;
- normalizer contract testli;
- memory/work bounds ölçülmüş;
- deterministic replay testli;
- malformed data testli;
- consumer error isolation testli;
- snapshot/digest testli;
- browser/Node syntax testli;
- CI workflow'unda scope guard bulunmalı;
- mevcut ActorRegistry/navigation/combat/faction/fauna owner'ları untouched veya açıkça gerekçeli olmalı.

## 23. What this layer is not

Bu sistem:

- yeni bir ActorRegistry değildir;
- yeni bir navigation system değildir;
- yeni bir combat engine değildir;
- personality engine değildir;
- faction law engine değildir;
- physics solver değildir;
- renderer değildir;
- network authority değildir;
- LLM agent değildir.

Bunun görevi bu sistemler arasında ortak, bounded ve deterministic semantic coordination sağlamaktır.

## 24. Long-term extension points

Doğal extension alanları:

- social memory score;
- persistent rumor propagation;
- event clustering;
- multi-target threat ranking;
- settlement-level aggregate stimulus;
- encounter seed recording;
- world-event consequence sampling;
- offline replay bundles.

Bunlar eklenecekse aynı ownership, determinism ve bounded-work kuralları uygulanmalıdır.
