# Living World Stimulus — Operations and Integration Guide

## Neden ayrı bir orchestration katmanı?

AAPW'de yaşayan dünya davranışları zaman içinde perception, reaction, faction, fauna, settlement,
combat ve world-event katmanlarında uzmanlaşmıştır. Bu uzmanlaşma korunmalıdır; problem, farklı
authoritative producer'ların ürettiği sinyallerin aynı güvenlik, determinism ve budget politikasından
geçmemesidir.

Bu katman üç operasyonel problemi çözer:

1. güvenilmeyen sinyallerin normalize edilmesi;
2. yüksek sayıda actor ve stimulus altında bounded work;
3. semantic kararın domain execution'dan kesin biçimde ayrılması.

## Veri akışı

Her update için önerilen akış:

```text
producers
  -> batch coordinator
  -> normalizer
  -> memory
  -> salience
  -> role tuning
  -> intent arbitration
  -> plan generation
  -> consumer adapter
  -> existing owner
```

Producer örnekleri:

- `livingWorldPerceptionPolicy` görsel/auditory gözlem;
- combat outcome signal'ları;
- faction alarm veya territory event'leri;
- fauna threat/event sinyalleri;
- weather/environment activity signal'ları;
- quest/world-event bridge çıktıları.

Bu producer'ların hiçbirinin burada yeniden yazılması gerekmez.

## Batch coordinator kullanımı

Kaynaklar farklı sıklıklarda event üretebilir. Batch coordinator onları tek bir deterministic micro-batch'e
çevirir.

```js
const batches = createLivingWorldStimulusBatchCoordinator();

perceptionProducer.onSignal((signals) => {
  batches.push('perception', signals, simulationSeconds);
});

combatProducer.onSignal((signals) => {
  batches.push('combat', signals, simulationSeconds);
});

const sealed = batches.seal(simulationSeconds);
runtime.tickOnce({
  deltaSeconds,
  nowSeconds: simulationSeconds,
  actors,
  signals: sealed.signals,
});
```

Frame age cap, infinite producer burst'lerinin bir sonraki frame'e kontrolsüz taşınmasını engeller.
Persistent signal'lar explicit metadata ile bu cap'in dışına taşınabilir.

## Stimulus kimliği

`id` alanı producer tarafından mümkün olduğunca stabil tutulmalıdır. Aynı actor/source olayı tekrar
üretiyorsa yeni semantic event için yeni id verilmelidir; aynı id'nin tekrar kabul edilmesi memory
revision'ını yeniler.

Stable id şu faydaları sağlar:

- deterministic tie-break;
- duplicate detection için predictable input;
- replay digest okunabilirliği;
- telemetry correlation.

## Confidence ve intensity

`confidence` bilgiye ne kadar güvenildiğini, `intensity` bilginin ne kadar güçlü olduğunu ifade eder.
Bu iki kavram birbirine eşit kabul edilmemelidir.

Örnek:

```js
{
  kind: 'noise',
  confidence: 0.65,
  intensity: 0.95,
}
```

Bu değer “güçlü bir ses var gibi ama kaynağın kesinliği orta” anlamına gelebilir.

## Distance semantics

Salience observer'a uzaklığa göre düşürülür. Observer position güvenilir değilse distance hesabı
üzerinden sahte kesinlik üretilmemelidir. Producer world-space coordinate sağlıyorsa position alanı
kullanılabilir.

Yüksek uzaklıkta score'un sıfıra yaklaşması beklenir; bu bir hard visibility rule değildir. Gerçek
LOS/visibility yine authoritative perception owner'da kalır.

## Memory TTL

Memory yalnızca bir perception cache değildir. Aynı stimulusun kısa süreli persistence'ını sağlayan
semantic temporal layer'dır.

Standart TTL'ler:

- combat/damage/death: orta uzunluk;
- alarm/threat: daha uzun;
- weather/environment: uzun;
- generic noise/sighting: kısa.

TTL kararları policy'den ayarlanabilir. Replay kullanılıyorsa `nowSeconds` simulation time olmalıdır.

## Role tuning operasyonu

Actor input'una role koymak önerilir:

```js
{ id: 'guard-17', role: 'guard', ... }
```

Role bilinmiyorsa `unknown` profile fail-safe olarak kullanılır. Unknown profile aggressive behavior
üretmek yerine observe/alert ağırlığı verir.

Yeni bir role eklenirken:

1. role string bounded olmalı;
2. en az bir fallback weight bulunmalı;
3. confidenceBias küçük tutulmalı;
4. domain ownership eklenmemeli;
5. deterministic tests profile'ı kapsamalı.

Role profile faction truth değildir. Bir `guard` actor'ının hangi faction'da olduğu başka authoritative
sistemin işidir.

## Intent seçiminde güvenlik

Intent yalnızca execution plan üretmek için semantic receipt'tir.

Örnek güvenlik kuralları:

- defeated actor -> observe/recover dışı intent'ler bastırılabilir;
- canAttack false -> attack candidate reddedilir;
- low health -> pursue/attack utility azaltılır;
- low stamina -> patrol/pursue/attack utility azaltılır;
- protected actor -> flee utility azaltılabilir.

Bunlar hard gameplay truth değil, orchestration hints'tir. Authoritative owner son sözü söyler.

## Plan tüketimi

Consumer plan'ı kabul etmeyebilir. Bunun normal olduğu varsayılır.

```js
for (const entry of frame.decisions) {
  const receipt = existingNpcOwner.consumeStimulusPlan(entry);
  // existing owner may reject because state changed after orchestration.
}
```

Bu yarış durumunu ortadan kaldırmak için plan timestamp/tick taşımalıdır. Consumer stale plan'ı
yürütmemelidir.

## Work budget

Büyük dünyada actor sayısı runtime limitini geçebilir. Work budget actor'ı silmez; yalnızca bu frame'de
hangi actor'ların tekrar değerlendirileceğini seçer.

Önerilen yaklaşım:

```js
const budget = createLivingWorldStimulusWorkBudget({
  bucketCount: 8,
});

const selected = budget.select(actorMetadata, 32, { urgency: 0.2 });
```

Bucket stable hash ile atanır. Aynı actor aynı bucket'a gider. Bu nedenle sıralama tesadüfi değildir.
Starvation debt uzun süre değerlendirilmeyen actor'ı ilerleyen frame'lerde yukarı taşır.

Urgent cap önemlidir. Yüzlerce aynı anda “urgent” signal geldiğinde bile bütün actor'ların immediate
re-evaluation yapması engellenir.

## Recovery modes

Recovery helper şu dört semantic mode'u kullanabilir:

- `normal`: tam workload;
- `reduced`: non-urgent actor refresh seyreltilir;
- `severe`: workload yarıya indirilebilir;
- `safe`: observation-only fallback tercih edilir.

Recovery mode renderer veya physics'e doğrudan dokunmaz. Uygulama bunu mevcut quality/perf orchestration
sistemine map edebilir.

## Telemetry alanları

Minimum önerilen dashboard:

```text
stimulus.accepted
stimulus.rejected
stimulus.remembered
plans.generated
plans.rejected
intent.<name>
intentConfidence p50/p90/p99
work.selected
work.starvation
consumer.errors
audit.failures
```

Telemetry sample bounded olmalıdır. Network transport bu modülün içinde olmamalıdır.

## Deterministic replay

Replay kaydı aşağıdakileri içermelidir:

- simulation tick;
- simulation seconds;
- canonical actors;
- canonical stimuli;
- role/capability snapshot;
- generated plan digest.

Aynı data tekrar işlendiğinde digest eşit değilse ilk olarak aşağıdakiler kontrol edilir:

1. producer ordering;
2. floating point normalization;
3. timestamps;
4. role profile changes;
5. consumer side mutation leaking back into input.

Pipeline kendi içinde random source kullanmaz. Bu, replay determinism için bilinçli bir tasarımdır.

## Browser lifecycle

Runtime `pagehide`, visibility ve suspend durumlarında caller tarafından durdurulabilir. Stimulus
orchestrator içinde `requestAnimationFrame` veya DOM listener kullanılmamalıdır. Böylece worker/headless
test altında aynı semantic policy çalışabilir.

## Network geleceği

Network replication eklenirse remote stimulus packet'ları normalizer'dan geçmelidir.

```text
network packet
   -> trust boundary
   -> normalizer
   -> sequence validation
   -> memory
   -> salience
```

Remote packet doğrudan actor state mutate etmemelidir.
Sequence/age checks replication layer'ında yapılmalı; orchestration layer yine malformed data için
fail-closed kalmalıdır.

## Multiplayer geleceği

Bu pipeline tek başına authoritative multiplayer çözümü değildir. Server reconciliation, ownership,
lag compensation ve anti-cheat ayrı sistemlerdir.

Ancak semantic plan üretiminin deterministic olması client prediction/replay diagnostics için kullanışlı
bir temel oluşturabilir.

## PWA/mobile operasyonu

Mobile cihazlarda şu sinyaller runtime quality ile beraber değerlendirilebilir:

- reduced motion;
- device memory;
- hardware concurrency;
- save-data;
- effective network type.

Stimulus orchestration için bunların doğrudan CSS/renderer değişikliğine dönüşmesi gerekmez. Bunun yerine
work budget küçültülür ve non-urgent refresh aralığı artırılır.

## Browser smoke testleri

Gerçek browser regression minimum şu durumları gözlemlemelidir:

- valid signal ingress;
- malformed signal no-crash;
- hidden/visible lifecycle'da stable state;
- no console errors;
- no runaway event count;
- bounded memory statistics;
- PWA/service worker graph bozulmadan runtime module yüklenmesi.

Runtime tree'ye yeni JS eklenirse service-worker/cache policy ayrıca kontrol edilmelidir.

## Anti-patternler

### İkinci actor state machine
Stimulus pipeline içinde actor FSM kurmak sahiplik çakışması yaratır. Bunun yerine semantic intent +
plan receipt üretilmelidir.

### Direct movement
`planGenerator` içinden navigation çağırmak yasaktır.

### Direct combat
Damage/hit detection burada yapılamaz.

### Hidden random
Role veya salience içinde `Math.random()` kullanmak replay deterministic contract'ını bozar.

### Wall clock
`Date.now()` karar logic'inde kullanılmamalıdır. Caller `nowSeconds` sağlar.

### Unbounded collections
Signals, memory, history ve telemetry bounded olmalıdır.

### Silent input rewriting
Malformed producer verisini sessizce authoritative gameplay truth'e çevirmek yerine normalize edip
uncertainty'yi korumak daha güvenlidir.

## Release checklist

Release branch'e dahil edilmeden önce:

- all `livingWorldStimulus*.js` syntax check;
- core contract;
- extended contract;
- fuzz/determinism;
- integration matrix;
- batch coordinator contract;
- benchmark smoke;
- ownership scan;
- git diff check;
- >4,000 meaningful-addition turn gate;
- exact current main comparison;
- CI completion state check.

CI status `queued` veya `in_progress` ise release note'a “pending” yazılmalıdır. Completed success
olmadan PASS ifadesi kullanılmamalıdır.

## Versioning

Policy id'leri date+version formatı taşır. Breaking semantic change yeni policy id ile yayınlanmalıdır.
Mevcut consumer'ların davranışı farkında olmadan değişmesin diye backward compatibility gerekiyorsa
iki policy aynı anda çalıştırılabilir ve digest karşılaştırılabilir.

## Ölçüm hedefleri

Bu katmanda teknik hedef “daha akıllı görünmek” değil:

- daha az jitter;
- daha düşük worst-case work;
- deterministic replay;
- malformed input dayanıklılığı;
- predictable memory;
- transparent consumer boundaries.

Visual drama, combat difficulty, faction law ve NPC personality için doğru katman hâlâ ilgili
specialist domain'dir.
