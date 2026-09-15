# Creature locomotion state regression matrix

Bu matrix, creature locomotion sunum zincirindeki sınır durumlarının hangi katman tarafından sahiplenildiğini açıklar. Amaç test sayısını artırmak değil; aynı semantiğin farklı tüketiciler tarafından tekrar yorumlanmasını engellemek ve her kritik geçişi görünür kılmaktır.

## Normal dünya durumları

| Senaryo | Beklenen state | Beklenen gait | Ana sahip |
| --- | --- | --- | --- |
| Durgun yaratık | `idle` | `walk` | behaviour |
| Sakin dolaşma | `wander` | `walk` | behaviour |
| Dostça yaklaşma | `approach` | `trot` | reactive |
| Oyuncudan kaçış | `flee` | `gallop` | reactive |
| Sürü alarma geçti | `herd-flee` | `gallop` | social |
| Yön değiştirirken hareket | `turn` | `walk` | behaviour/contact |
| Engel önünde durma | `blocked` | `walk` | contact |
| Kaygan yüzey | `slip-recover` | `walk` | contact |
| Güvensiz zemin | `contact-unstable` | `walk` | contact |

## Uçuş durumları

| Senaryo | Beklenen state | Beklenen gait | Not |
| --- | --- | --- | --- |
| Kalkış başlangıcı | `takeoff` | `flap` | En yüksek locomotion priority |
| Yükselme | `flight-climb` | `flap` | Ground contact state tarafından ezilmez |
| Seyir | `flight-cruise` | `flap` | Ground effects bastırılabilir |
| Alçalma | `flight-descend` | `flap` | Hâlâ airborne |
| Yumuşak temas | `landing-soft` | `walk` | Impact event'i açık |
| Sert temas | `landing-hard` | `walk` | Crossfade kısa ve impact odaklı |
| Zemin yeniden edinimi | `reacquire-ground` | `walk` | Flight ailesinden çıkışı açıklar |

## Öncelik testleri

Aynı frame'de birden fazla sinyal bulunabilir. Priority contract şu çatışmaları kapsar:

`flight > landing > contact > social > reactive > turn > behaviour`.

Örneğin uçan bir kuzgunun yüzey kayması 1.0 olsa bile state `flight-cruise` kalır; yüzey sensörü havada anlamlı bir kara temasını temsil etmez. Benzer biçimde sert iniş alan bir hayvan aynı anda `flee-on-approach` davranışına sahip olsa da `landing-hard` sunum semantiği kaybedilmez.

## Gait seçimi

Mevcut gait sözlüğü dışında isim kabul edilmez. Bilinmeyen değerler `walk`'a düşer. Takma adlar:

- `calm` → `walk`
- `run` → `gallop`
- `fast` → `sprint`
- `escape` → `gallop`
- `flight` → `flap`

Açık `requestedGait`, state için güvenli olduğu sürece tercih edilir. Uçuş ve iniş gibi yüksek öncelikli semantic state'ler gerekli gait'i kendileri seçer.

## Malformed input matrisi

Sentez katmanı canlı frame'de throw etmemelidir. Bu nedenle şu değerler clamp/fallback ile ele alınır:

`NaN`, `Infinity`, negatif hız, negatif altitude, string numeric alanlar, null confidence, aşırı delta time, bilinmeyen behaviour, bilinmeyen gait.

Boolean alanlarda string `'false'` gerçek boolean false olarak yorumlanmaz; tip korunur ve default uygulanır. Bu ayrım özellikle browser payload'larının sessizce yanlış semantiğe dönüşmesini önler.

## Contact matrix

Contact adapter raycast çalıştırmaz. Dışarıdan gelen probe verisini semantic input'a dönüştürür:

- normal confidence
- surface confidence
- slip
- slope
- forward obstacle distance
- forward obstacle height
- impact speed
- airborne time

`forwardBlocked` açıkça true ise traversal `blocked` olur. Mesafe çok kısa olduğunda da aynı sonuç üretilir. Pozitif makul yükseklik ve kısa mesafe `climbable`, negatif büyük yükseklik `drop` cue'su üretir.

## Sosyal matrix

Sosyal alarm yalnızca aynı tür kimliği doğrulanmışsa locomotion state'i etkiler. Aynı alarm başka türden gelen bir source'a dönüştürülmez. Kuşlar için sosyal state, flight priority tarafından gölgelenebilir; bu durumda semantik state `flight-*` olarak kalırken social presentation channel 1 olabilir.

Bu yaklaşım `creatureBrain.js` içindeki same-species-only alert sözleşmesinin presentation katmanında da korunmasını sağlar.

## Pause/resume matrix

Pause sırasında runtime:

- frame sayısını artırabilir;
- zaman snapshot'ını korur;
- hareket speed'ini sıfır presentation girdisine indirir;
- state'i `idle`'a çeker;
- geçmiş timeline'ı silmez.

Resume sonrasında caller tarafından sağlanan gerçek hareket girdisi yeniden sentezlenir. Runtime hareket entegrasyonunu kendisi yapmaz.

## Replay matrix

Deterministik replay için aynı input dizisi iki kez işlendiğinde:

1. state dizisi eşit olmalı;
2. gait dizisi eşit olmalı;
3. event dizisi eşit olmalı;
4. timestamp dizisi eşit olmalı;
5. fingerprint eşit olmalı.

Replay dosyası gerçek mesh veya Three.js nesnesi taşımaz. Bu, headless CI ortamında state regression yapılabilmesini sağlar.

## Telemetry matrix

Her sample için state, gait, event ve source sayaçları artırılır. Ek metrikler:

- average confidence
- average speed
- transitions per second
- airborne ratio
- reactive ratio
- social ratio
- hard/soft landing count
- blocked count
- invalid sample count

Kalite skoru confidence, stability, validity ve contact davranışını birleştirir. Eşikler telemetry consumer'ı tarafından değiştirilebilir.

## Consumer matrix

Animation consumer yalnızca gait request ve blend map'i okuyup mevcut `creatureGait.js` sürücüsüne yönlendirmelidir. Audio consumer cue adını gerçek asset'e çözer. VFX consumer semantik efekt adını gerçek instantiate adımına çözer.

Hiçbir consumer locomotion state'ten world position/velocity türetmemeli veya physics ownership üstlenmemelidir.

## Regression sahipliği

Bu matrix'in test karşılığı:

- synthesis checks → state/gait contract
- timeline checks → transition/dwell contract
- runtime checks → lifecycle contract
- replay checks → deterministic contract
- quality checks → invariant contract
- adversarial checks → malformed/priority contract
- presentation bridge checks → consumer contract
- contact checks → probe normalization contract
- telemetry checks → aggregation contract
- integration/E2E → zincirin birlikte çalışması
- ownership checks → katman sınırları
- schema checks → serialization contract
- transition policy checks → crossfade contract

Bu ayrım her yeni bug'ın doğru kata eklenmesini kolaylaştırır. Aynı davranışı üç farklı testte tekrar üretmek yerine, her test dosyası kendi semantic sınırını doğrular.
