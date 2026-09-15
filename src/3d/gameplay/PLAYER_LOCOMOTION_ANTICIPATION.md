# Player Locomotion Anticipation

## Amaç

Bu tur, mevcut 8-yönlü directional locomotion sunum katmanının üzerine kısa zaman ufuklu bir anticipation katmanı ekler. Amaç oyuncunun hareketindeki değişimi animasyon tüketicisinin bir frame geç algılamasını önlemektir. Katman; hareket, hızlanma, yavaşlama, durma, yön kırma, pivot, yüzey riski ve savaş baskısını tek bir immutable sunum profiline dönüştürür.

Katman hareket fiziğinin sahibi değildir. Oyuncunun dünya konumu, collision çözümü, hasar sonucu, saldırı penceresi, input sistemi ve animation asset yükleme davranışı bu modülün kapsamı dışındadır.

## Veri akışı

`player.js` veya başka bir caller kendi gözlemini üretir. `normalizePlayerDirectionalInput()` bu gözlemi finite ve bounded değerlerle normalize eder. Directional politika mevcut semantic ve yön bilgisini üretir. Anticipation politika önceki snapshot ile karşılaştırma yaparak hız farkını, ivmeyi ve yön sapmasını hesaplar. Ardından animation consumer bridge tarafından kullanılabilecek kanallar oluşturulur.

Önerilen akış:

`movement observation -> directional presentation -> temporal anticipation -> transition window -> animation consumer`

Bu akışta her adım read-only veri üretir.

## Modlar

Ana modlar `idle`, `start`, `accelerate`, `cruise`, `brake`, `stop`, `strafe`, `reverse`, `pivot`, `recover` ve `turn-in-place` ailesidir. Combat bağlamında `combat-advance`, `combat-retreat`, `guard-walk`, `dodge-recover` ve `stagger-recover` kullanılır.

Mod seçimi gameplay sonucu değildir. Örneğin `stagger-recover` yalnızca mevcut stagger sinyalinin animasyon sunumunda recovery ihtiyacını temsil eder.

## Start anticipation

İlk hareket frame'lerinde yalnızca mevcut hız değil hızlanma eğilimi de dikkate alınır. Hız düşük ve ivme yükseliyorsa `startWeight` artar. Böylece idle -> locomotion geçişi, doğrudan uzun bir cruise blend'i yerine kontrollü başlangıç kanalına geçebilir.

## Brake ve stop

Negatif hız değişimi brake ağırlığını yükseltir. Yüzey kayganlığı ve yüksek dönüş oranı brake yanıtını artırabilir. `stopDistanceMeters` gerçek fiziksel durdurma komutu değildir; animasyonun duruş yaklaşımını seçebilmesi için sunum tahminidir.

## Pivot

Mevcut yön ile yeni yön arasındaki büyük açısal fark pivot riskini yükseltir. 125 derece civarı yön sapması pivot adayını, 165 derece üzeri sapma ise güçlü pivot adayını temsil eder. Turn rate ve mevcut hız pivot ağırlığını destekler.

## Look-ahead

Look-ahead süresi 0.05–0.35 saniye aralığında tutulur. Turn rate ve ivme arttıkça küçük miktarda genişler. Bu gelecek için kesin bir tahmin değildir; yalnızca yakın yön kanalının erken desteklenmesi için kullanılır.

## Anticipated blend

Mevcut directional blend, look-ahead oranına göre gelecekteki baskın yöne doğru kaydırılır. Ağırlıklar normalize edilir. Bu sayede animation tüketicisi tek bir channel seçmek zorunda kalmadan mevcut + yaklaşan yönü birlikte değerlendirebilir.

## Yüzey etkisi

`surfaceConfidence`, `surfaceSlip`, `slopeDegrees` ve `groundRisk` temas kalitesini etkiler. Düşük güven, foot plant damping'i üretir. Slip, toe/heel release zamanlamasını ve brake davranışını güçlendirir. Eğim, cadence bias ve transition window üzerinde sınırlı bir etki oluşturur.

## Combat etkisi

Directional locomotion katmanı combat state machine'i değiştirmez. `hit-stagger`, `dodge`, saldırı ve guard bilgisi daha yüksek sunum önceliği olarak anticipation profiline aktarılır. Animation bridge bunları ayrı kanallarla tüketebilir.

## Transition windows

`playerLocomotionTransitionWindows.js` her mod değişimi için bounded süre ve easing seçer. Pivot ve stop daha yüksek lock/priority değeri taşır. Recovery geçişleri terrain riskine göre daha kontrollü tutulur.

Transition window gameplay inputunu kilitlemez. `interruptible` alanı yalnızca tüketiciye önerilen sunum davranışıdır.

## Temporal tuning

`playerLocomotionTemporalTuning.js` data-first timing matrix içerir. Her mod için enter, exit, smoothing, inertia ve overshoot parametreleri tanımlıdır. Çevre modifier'ları `clear`, `soft`, `slippery`, `steep` ve `unstable` olarak modellenir.

Tuning tablolarının amacı merkezi eşiklerin kod içine dağılmasını önlemektir. Değer değişiklikleri version değişikliği ile birlikte acceptance beklentilerini güncellemelidir.

## Animation bridge

Bridge, directional ağırlıkları sekiz yön channel'ına ve start/accelerate/cruise/brake/stop/strafe/pivot/recover kanallarına map eder. `envelope` alanı confidence, ground risk, contact ve anticipation damping değerlerini taşır.

Bridge renderer veya Three.js import etmez. Animation asset catalog, mixer ve clip lifecycle hâlâ tüketici tarafının sorumluluğundadır.

## Telemetry

Anticipation telemetry bounded counter, mode histogram, direction histogram, recent events, warnings ve quality score üretir. Event türleri mode change, direction change, pivot, start, brake, stop, confidence-drop ve slip-rise gibi gözlemlerdir.

Maximum sample, event ve history sınırları acceptance testlerinde doğrulanır. Telemetry DOM veya EventBus bağımlılığı taşımaz.

## Replay

Replay tape kaynak sample'larını kopyalar ve en fazla 600 frame tutar. Aynı sample dizisi aynı profile frame'leri, telemetry read model'leri ve fingerprint'i üretmelidir. Replay diff, ilk ayrışan frame indeksini ve önemli alanları görünür kılar.

Replay bozuk versiyon veya yanlış sampleCount taşıyorsa validation false döner. Ama normal presentation resolution malformed numeric girişleri güvenli finite değerlere çevirir.

## Determinism

Politikalar Date, random, DOM veya mutable global state kullanmaz. Fingerprint girdileri JSON-stable çıktıdan oluşturulur. Aynı girişin iki çalıştırması arasında fark olmamalıdır.

## Sınırlar

Speed 12 m/s, slope 55 derece ve turn rate 540 derece/s sınırında tutulur. Anticipation history 24, telemetry history 48, telemetry events 96 ve replay 600 frame ile bounded durumdadır.

## Entegrasyon notları

Gerçek player caller şu minimum veriyi sağlamalıdır: planar velocity, facing, planar speed, delta seconds, turn rate ve gerekiyorsa surface confidence/slip/slope. Önceki profile ait snapshot da korunmalıdır.

Controller sınıfları yalnızca bounded sunum state'i saklar. Player controller'a yazmaz. UI veya debug overlay kendi read model'ini isterse telemetry controller kullanılmalıdır.

## Test yaklaşımı

Acceptance matrix; hız sınırları, yön örneklemesi, start/stop, combat önceliği, yüzey riskleri ve bridge channel şekillerini tarar. Adversarial suite NaN, Infinity, negatif süre, aşırı hız, aşırı dönüş, düşük confidence ve yüksek slip gibi girdileri test eder.

Invariant suite immutable çıktı, finite numerikler, normalized blend toplamı ve deterministic tekrarları test eder. Temporal tuning suite transition sürelerini, easing ve layer stack davranışını tarar.

## Non-goals

Bu tur ikinci bir movement controller, fizik sistemi, navigation sistemi, camera controller, animation loader, procedural mesh sistemi veya gameplay state machine getirmez.
