# Creature locomotion state synthesis

## Amaç

`creatureBrain.js` davranış ve hareket kararlarını üretir; `creatureGait.js` mevcut rig kemiklerini deforme eder. Bu katman ikisinin arasındaki sunum sözleşmesini tek bir, renderer-agnostik snapshot içinde toplar.

Temel çıktı `synthesizeCreatureLocomotionState()` tarafından üretilir. Çıktı immutable bir nesnedir ve hareket ettirmez. Böylece animasyon, ses, VFX, replay ve debug tüketicileri aynı semantik kaynağı okuyabilir.

## Durum önceliği

Öncelik sırası gerçek dünya çarpışma/uyaran koşullarını kaybetmemek için açık tutulur:

1. Uçuş durumu (`takeoff`, `flight-*`)
2. İniş ve zemini yeniden edinme
3. Temas sorunları (`blocked`, `contact-unstable`, `slip-recover`)
4. Sosyal tepki (`herd-flee`, `flock-flee`)
5. Doğrudan reaktif davranış (`flee`, `approach`)
6. Yön değişimi
7. Normal davranış (`wander`, `idle`)

Bu öncelikler hareket kodunun yerini almaz. Sadece aynı frame içinde hangi görsel sunum durumunun daha açıklayıcı olduğunu belirler.

## Uçuş

Kuş profilleri `flightEnabled` ve `flightPhase` alanlarını sağlar. `takeoff`, `flight-climb`, `flight-cruise` ve `flight-descend` durumlarının tamamı `flap` gaitine bağlanır. Zemin sensörleri uçuş sırasında state seçimini ezmez; kuşun duvar veya çatı üzerinden geçmesi böylece mümkündür.

`reacquire-ground` iniş tamamlandığında geçiş olayını açıkça işaretler. Yumuşak ve sert inişler impact ve airborne süresinden türetilir.

## Gait

Gait sözlüğü mevcut `creatureGait.js` sözlüğüyle sınırlıdır: `walk`, `trot`, `pace`, `prowl`, `stride`, `hop`, `gallop`, `bound`, `sprint`, `flap`. Yeni bir fizik hareket modeli eklenmez.

State ile gait arasında güvenli varsayımlar vardır:

- sakin dolaşma → `walk`
- yaklaşma → `trot`
- kaçış/kaçışta sürü → `gallop`
- uçuş → `flap`
- iniş/toparlanma → `walk`

Çağıran taraf `requestedGait` ile açık bir seçim yapabilir. Bilinmeyen isimler `walk` seviyesine düşer.

## Contact policy

`creatureLocomotionContactPolicy.js` fizik sorgusu yapmaz. Dışarıdan sağlanan probe değerlerini sınırlar ve şu alanlara dönüştürür:

- zemin durumu
- normal ve yüzey güveni
- kayganlık
- eğim
- ön engel mesafesi/yüksekliği
- iniş etkisi
- traversal işareti

Bu adapter'ın görevi veri normalizasyonudur. Raycast, collision query veya navigation sahibi değildir.

## Runtime facade

`creatureLocomotionStateRuntime.js` creature başına timeline ve son state'i tutar. Pause, resume, reset ve serialization sağlar. Runtime hiçbir zaman `creatureBrain` hareket integrasyonunu veya `creatureGait` bone mutasyonunu çağırmaz; yalnızca bunların tüketebileceği state/intent üretir.

## Presentation bridge

`creatureLocomotionPresentationBridge.js` state snapshot'ını generic kanallara dağıtır:

- locomotion
- alert
- airborne
- contact
- impact
- slip
- turn
- social

Ayrıca ses ve VFX cue isimlerini üretir. Bunlar gerçek ses dosyası veya VFX instantiate etmez; tüketiciye semantik bir kimlik verir.

## Timeline ve replay

Timeline state değişimlerini örnekler, transition window hesaplar, state dwell sürelerini izler ve thrash tespiti sağlar. Replay katmanı aynı input dizisini tekrar synthesise ederek deterministikliğin fingerprint ile doğrulanmasını mümkün kılar.

Aynı input + aynı previous state → aynı state JSON çıktısıdır. Zaman kaynağı veya RNG kullanılmaz.

## Telemetry ve kalite

Telemetry şu metrikleri toplar:

- ortalama confidence
- transition rate
- airborne/reactive oranları
- sert/yumuşak iniş sayıları
- blocked sayısı
- invalid sample sayısı
- state/gait/event/source dağılımları

Quality katmanı vocabulary, confidence, gait blend, presentation bounds, airborne gait, movement ownership ve determinism invariant'larını kontrol eder.

## Ownership sınırı

Bu turdaki katmanlar şu şeylere sahip değildir:

- fizik simülasyonu
- navigasyon
- dünya transformu
- combat hasarı
- kamera
- mesh/asset yükleme
- Three.js renderer/mixer
- kalıcı kayıt

Özellikle `rootMotion.movementOwnedElsewhere` alanı, animation consumer'ın state synthesis'i gerçek dünya hareketinin sahibi sanmasını engelleyen açık bir sözleşmedir.

## Fixture yaklaşımı

Fixture corpus nominal, sosyal, uçuş, iniş, kayma, traversal, yön değişimi, açık gait seçimi ve malformed numeric input durumlarını kapsar. Edge fixture'lar `NaN`, `Infinity`, string numeric değerler, null ve aşırı değerlerle canlı frame içinde throw edilmemesini kontrol eder.

## Gelecek entegrasyon

Bu sözleşmenin doğal tüketicisi `creatureGait.js` için küçük bir adapter olacaktır: gait request içindeki clock/cycle bilgisi, state event'i ve blend map doğrudan mevcut bone driver'a geçirilebilir. Bu geçiş yapılırken hareket sahipliği yine `creatureBrain` tarafında kalmalıdır.
