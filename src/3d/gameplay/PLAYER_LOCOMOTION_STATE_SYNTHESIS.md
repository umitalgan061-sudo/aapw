# Player Locomotion State Synthesis

## Amaç

Bu katman, mevcut yönlü locomotion ve anticipation sözleşmelerini tek bir renderer-agnostic sunum niyetinde birleştirir. Amaç, farklı hareket bağlamlarında animasyon tüketicisinin doğrudan kullanabileceği kararlı bir state, direction, blend, transition, event, contact, landing ve traversal read model üretmektir.

## Sahiplik sınırı

Sentez katmanı hareket komutu üretmez. Physics body, controller velocity, collision resolution, navigation, combat state machine, camera, save-game, world event veya animation asset sahipliği yapmaz. Girdi olarak verilen gameplay gerçekleri caller tarafından sağlanır; çıktı yalnızca presentation intent'tir.

## State kaynakları

State seçimi override, semantic, landing, airborne, traversal, surface ve anticipation kaynaklarını öncelik sırasına göre değerlendirir. Override en yüksek önceliğe sahiptir. Hit-stagger ve dodge gibi mevcut semantic durumlar sıradan locomotion hareketinden önce korunur. Landing ve airborne durumları yalnızca caller'ın grounded, air-time ve impact sinyallerinden türetilir.

## Direction ve blend

Mevcut directional contract değişmeden kullanılır. Present direction, anticipated direction ve seçilmiş direction ayrı tutulur. Anticipation kuvveti look-ahead süresinden türetilir. Sekiz yönlü blend çıktısı normalize edilir ve toplamı bir olacak şekilde tüketiciye sunulur.

## Contact ve surface

Surface confidence ve surface slip değerleri contact quality'yi etkiler. Slip yükseldiğinde `slippery-step`, confidence düştüğünde `contact-recover` üretilebilir. Bu durumlar physics düzeltmesi yapmaz; yalnızca ayak temasının ve presentation ağırlıklarının değişmesi için sinyal üretir.

## Traversal

Traversal tamamen caller-owned bir sinyal kümesidir. `traversalWeight`, ileri mesafe, yükseklik ve blocked göstergeleri traversal sunum durumunun seçimini etkiler. `traversal-prepare`, `traversal-clear` ve `traversal-blocked` yalnızca presentation state'tir; engeli aşmak için hareket uygulamaz.

## Timeline

Timeline katmanı state duration, easing, overlap ve cue üretir. Easing sabit ve deterministiktir. Timeline kendi başına wall-clock okumaz; caller'ın delta time'ını kullanır. State değiştiğinde yeni pencere sıfırdan başlar ve mevcut state'in transition edge'i ayrı korunur.

## Telemetry

Telemetry snapshot'ları immutable'dır. State, event, direction, confidence, speed, ground risk, surface confidence, slip, anticipation/contact/landing/traversal ağırlıkları ve timeline ilerlemesi kaydedilir. Telemetry gameplay state'ini değiştirmez.

## Quality

Quality raporu state validity, transition coherence, direction continuity, contact, surface, timeline, semantic priority ve determinism eksenlerini ayrı ayrı puanlar. Nihai puan bütün eksenlerin ağırlıklı toplamıdır. Quality raporu tanısaldır ve davranış sahipliği taşımaz.

## Determinizm

Aynı giriş dizisi aynı state, event, direction, timeline ve confidence sonuçlarını üretmelidir. Replay ve regression scriptleri bu özelliği aynı veri kümesini iki kez çalıştırarak sınar. Rastgelelik kullanılmaz.

## Malformed input

NaN, Infinity, negatif hız, aşırı eğim, aşırı dönüş, bozuk surface/traversal alanları normalize edilir. Çıkıştaki numeric alanların finite olması sözleşmenin parçasıdır. Hostile testleri bu normalizasyonu yoğun kombinasyonlarla sınar.

## Root motion

`rootMotionAllowed` yalnızca caller'ın mevcut sunum tercihini taşır. Sentez katmanı root motion üretmez, değiştirmez veya fiziksel mesafe uygulamaz.

## Test yüzeyleri

`checkPlayerLocomotionStateSynthesisAcceptance.mjs` temel kabul akışlarını, `checkPlayerLocomotionStateSynthesisAdversarial.mjs` malformed ve hostile girdileri, `checkPlayerLocomotionStateSynthesisScenarioMatrix.mjs` bilinen state senaryolarını, `checkPlayerLocomotionStateRuntime.mjs` runtime coordinator'ı, `checkPlayerLocomotionStateFixtures.mjs` fixture corpuslarını ve `checkPlayerLocomotionStateQuality.mjs` kalite/determinizm özelliklerini doğrular.

## Değişiklik politikası

Yeni state eklemek mevcut directional veya anticipation sözleşmesini kırmamalıdır. Yeni event eklenirse validator, timeline easing/cue eşleşmesi, telemetry ve regression kapsamı aynı turda güncellenmelidir. Presentation katmanına gameplay authority sızdırılmamalıdır.
