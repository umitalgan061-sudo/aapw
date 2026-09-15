# Creature locomotion presentation bridge

Bu belge `creatureLocomotionPresentationBridge.js` katmanının tüketici sözleşmesini tanımlar.

## Tüketici modeli

Bridge, sentez edilmiş state'i doğrudan renderer nesnelerine çevirmiyor. Bunun yerine generic bir payload üretiyor. Animasyon tarafı gait request'i, ses tarafı audio cue'yu ve VFX tarafı VFX cue'yu kendi sahiplik sınırlarında tüketiyor.

Bu ayrım özellikle procedural rig ile gerçek render pipeline'ı arasında test edilebilirlik sağlar. Browser dışında replay ve unit test çalıştırılabilir.

## Kanallar

`locomotion` temel hareket yoğunluğunu; `alert` tepkiselliği; `airborne` uçuşu; `contact` zemin güvenini; `impact` iniş kuvvetini; `slip` kayma seviyesini; `turn` dönüş yoğunluğunu; `social` sürü/filo uyarısını taşır. Tüm kanallar 0..1 ile sınırlıdır.

## Event emission

Her event'in açık bir önceliği vardır. `landing-hard` ve `takeoff-enter` yüksek öncelikli ve tekrar tetiklenebilir; normal `gait-change` tekrarları dar bir zaman penceresinde bastırılır. Bridge event history'si sınırlıdır; sonsuz büyüme yoktur.

## Gait adapter

Animation payload şu değerleri içerir:

- state
- gait
- gait blend
- cycle frequency
- speed scale
- gait clock
- event
- confidence

Bu payload `creatureGait.js`'in mevcut kemiğe dokunan işini değiştirmez. Bridge hiçbir `Bone.rotation` erişimi yapmaz.

## Audio/VFX

Cue isimleri asset id değildir. Örneğin `creature-landing-hard` veya `hard-landing-dust` yalnızca semantik tanımlayıcıdır. Gerçek dosya veya efekt seçimi caller/asset katmanındadır.

## Persistence

Bridge serialize edilebilir. Restore edilen bridge aynı `eventSequence` ve event history ile devam eder. Bu, offline replay sırasında event sıralamasının korunmasını sağlar.

## Kanal seçimi

Caller isterse belirli kanalları kapatabilir. Bu kullanım özellikle headless test, düşük maliyetli NPC pass veya debug view için uygundur. Kapalı kanal state synthesis'i etkilemez; yalnızca consumer payload'ında dışarı alınmaz.

## Hata toleransı

Bilinmeyen state/gait bridge'i çökertmemelidir. Synthesis katmanının fallback değerleri payload validation ile sınanır. `validateCreaturePresentationPayload()` çağrısı CI içinde bağımsız bir contract testi olarak kullanılabilir.
