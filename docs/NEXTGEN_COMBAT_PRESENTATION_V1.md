# Kızıl Ufuk — Next-gen Combat Presentation V1

## Amaç

Bu katman mevcut `CombatSimulation` combat state machine'ini değiştirmez ve ikinci bir combat framework kurmaz. Mevcut simulation'ın deterministik `CombatEvent` çıktısını; VFX, SFX, hitstop, kamera, haptic, accessibility, replay, telemetry ve browser transport tüketicilerinin ortak bir veri sözleşmesine dönüştürür.

Ana zincir:

`CombatSimulation.step()`
→ `CombatPresentationDirector`
→ `CombatPresentationQueue`
→ `CombatPresentationQuality`
→ `CombatPresentationBus`
→ VFX / SFX / Haptic / Camera / Accessibility consumers.

## Event semantiği

Authoritative event tipleri:

| Combat event | Presentation semantic | Tipik his |
|---|---|---|
| attack-start | attack-start | kısa anticipation / swing |
| hit | impact | temas + küçük hitstop |
| blocked | blocked-impact | guard spark + düşük recoil |
| critical | critical-impact | güçlü hitstop + kamera + haptic |
| stagger | stagger | poise break + attack cancel |
| death | death | terminal camera pulse |
| dodge | dodge | kısa dodge trail |

Event sıralaması tick içinde priority → source id → target id → event adı ile deterministiktir. Aynı event fingerprint ile tekrar geldiğinde duplicate presentation üretilmez.

## Damage-type sunumu

Simulation artık event içinde mevcut authoritative damage type'ını taşır:

- slash
- pierce
- blunt
- fire
- frost
- arcane

Presentation profili damage type'a göre VFX intensity, material response, audio pitch/gain, haptic frequency/gain, recoil ve UI semantic label üretir. Bu profil yalnız sunum davranışını belirler; gerçek damage calculation yine simulation'dadır.

## Hitstop ve mikro zaman çizelgesi

Impact sunumu beş aşamalı bir mikro timeline kullanır:

1. `hitstop`
2. `impact-flash`
3. `recoil`
4. `camera-settle`
5. `clear`

Timeline fixed-step tick ile uyumludur, wall-clock gameplay state üretmez ve replay sırasında tekrar hesaplanabilir.

## Equipment / material yüzeyi

Yeni combat presentation kodu `MaterialAssignmentCore` veya `WorldAssetPlacementPipeline` kopyalamaz.

Damage type profilindeki `materialResponse` yalnız consumer'a önerilen fiziksel tepkiyi bildirir:

- metallic-spark
- cloth-rip
- leather-hit
- stone-thud
- frost-shard
- arcane-pulse

Gerçek model/material asset'i geldiğinde mevcut shared material authority kullanılmalıdır.

## Asset-first gerçeği

Repository asset scan sonucunda combat-specific particle/VFX ailesi bulunmadığı ve `assets/audio/` altında yalnızca mevcut CC0 UI click asset'i bulunduğu için kod bunu açıkça `pending` / `fallback` olarak raporlar.

Kod hiçbir combat sesini "shipped" gibi göstermemektedir.

Yeni gerçek combat asset'i geldiğinde:

1. LFS hydrate doğrulanır.
2. Mesh/material surface analizi yapılır.
3. Shared material recipe yalnız kaliteyi artırıyorsa uygulanır.
4. Shared validation çalıştırılır.
5. Manifest'e kaydedilir.
6. Live scene consumer'ına bağlanır.

## Spatial audio

`combatPresentationSpatialAudioV1.ts` renderer bağımsız spatial intent üretir:

- mesafe attenuation
- stereo pan
- occlusion factor
- effective volume multiplier

Listener için gerçek Player state kullanılabilir veya özel listener pose verilebilir.

## Cross-device haptic

`combatPresentationHapticsV1.ts` iki gerçek browser transport yolunu destekler:

- Touch: `navigator.vibrate`
- Gamepad: `dual-rumble`

Keyboard/mouse için haptic gönderilmez. Transport inject edilebilir olduğu için Node testleri DOM bağımlılığı olmadan çalışabilir.

## Input latency parity

`combatPresentationInputLatencyV1.ts` mevcut input authority'sini değiştirmez. Yalnızca combat-critical input için presentation tarafında:

- action age
- expected device latency
- compensation ticks
- prewarm
- late input
- priority

hesaplar.

Desteklenen cihaz bağlamları:

`keyboard`, `mouse`, `gamepad`, `touch`, `virtual`, `replay`.

## Accessibility

`combatPresentationAccessibilityV1.ts` aynı combat semantic'ini farklı cihaz ve erişilebilirlik profillerine yansıtır:

- standard
- reduced-motion
- high-contrast
- silent
- haptics-only

Reduced-motion yalnız hareket/camera ölçeğini düşürür; combat semantic state'i değiştirmez.

Critical ve death cue'ları uygun olduğunda `aria-live=assertive`, guard/stagger cue'ları `polite` olarak işaretlenebilir.

## Quality shedding

Presentation workload gameplay simulation'a rakip olmamalıdır.

`CombatPresentationQuality`:

- frame P95
- presentation queue pressure
- dropped cue count
- device
- reduced-motion

sinyallerinden cinematic / balanced / reduced kararı üretir.

Öncelik sırası:

1. simulation correctness
2. critical combat feedback
3. player control haptics
4. camera/recoil
5. optional VFX density

Kritik cue'lar yüksek pressure altında da korunur; düşük öncelikli görsel yük azaltılır.

## Fault isolation

`CombatPresentationBus` consumer'ları priority sırasıyla çağırır. Bir consumer exception verdiğinde diğer consumer'lar çalışmaya devam eder ve hata bounded bir failure log'da tutulur.

Böylece tek bir VFX veya telemetry consumer'ı gameplay presentation zincirini kırmaz.

## Replay / determinism

`CombatPresentationReplayV1` tick bazlı presentation recording üretir.

Recording:

- tick
- cue ids
- digest
- hitstop
- camera shake
- dropped cue

alanlarını içerir.

Aynı event + state stream tekrar işlendiğinde digest karşılaştırılabilir. Divergence ilk mismatch tick'i ile görünür.

## Acceptance contract

`CombatPresentationContractV1` tek raporda şu alanları toplar:

- frame bounds
- cue bounds
- dispatch bounds
- accessibility bounds
- asset readiness
- quality state
- telemetry health
- timeline samples
- lock-on camera focus

Contract yalnız PASS/FAIL üretmez; eksik gerçek asset'leri warning olarak açıkça raporlar.

## Shipped scene entegrasyonu

Next-gen runtime frame sonucu artık:

- `presentationFrame`
- `presentationDispatches`
- `presentationAccessibility`
- `presentationQuality`
- `presentationTelemetry`
- `presentationBus`
- `presentationContract`

alanlarını taşır.

Bu veri UI, renderer, VFX, audio, haptic ve browser adapter'larının aynı frame semantiğini paylaşmasını sağlar.

## Test matrisi

Odaklı testler şunları kapsar:

- yedi combat event ailesi
- altı damage type
- altı input device
- altı material/surface family
- reduced-motion ve accessibility
- queue burst / budget
- replay determinism
- browser envelope
- gamepad/touch haptic
- spatial audio attenuation/pan/occlusion
- animation reaction / poise
- hitstop timeline
- lock-on camera focus
- fault-isolated consumer bus
- adaptive quality shedding
- unified acceptance contract
- real next-gen runtime frame integration

## Merge gate

Bu feature branch'i aşağıdaki kanıtlar gerçek exact head üzerinde yeşil olmadan merge edilmemelidir:

- focused TypeScript check
- focused Vitest regression
- current next-gen regression
- Shared Material/Placement contract
- Run283 final head governance
- freshness
- determinism
- browser/PWA
- performance

LFS budget exhausted durumunda asset hydration isteyen gate'ler PASS sayılmaz. Eksik combat asset'leri fallback olarak disclosure ile raporlanır.

## Dosya özeti

Core presentation:

- `combatPresentationV1.ts`
- `combatPresentationQueueV1.ts`
- `combatPresentationReplayV1.ts`
- `combatPresentationTimelineV1.ts`
- `combatPresentationScenarioV1.ts`
- `combatPresentationContractV1.ts`

Quality / parity:

- `combatPresentationDamageTypeV1.ts`
- `combatPresentationQualityV1.ts`
- `combatPresentationTelemetryV1.ts`
- `combatPresentationAccessibilityV1.ts`
- `combatPresentationInputLatencyV1.ts`

Device / browser:

- `combatPresentationSpatialAudioV1.ts`
- `combatPresentationHapticsV1.ts`
- `combatPresentationBrowserBridgeV1.ts`
- `combatPresentationBusV1.ts`

Camera / animation:

- `combatPresentationCameraFocusV1.ts`
- `combatPresentationReactionV1.ts`

Bu ayrım consumer katmanlarının simulation authority'sine erişmeden gelişmesine izin verir.
