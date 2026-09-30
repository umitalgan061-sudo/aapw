# R23 Strict Live Core

## 1. Amaç

R23, mevcut Three.js uygulamasını tek seferde yeniden yazmak yerine oyun çalışma zamanının kritik kararlarını framework bağımsız ve strict TypeScript altında sahiplenen bir çekirdek sunar.

Bu katmanın amacı renderer üretmek değildir. Amaç; input, hareket, çarpışma, kamera, asset yaşam döngüsü, dünya sorguları, streaming, entity bütçesi, render policy, recovery, replay, command journal, persistence ve yaşam döngüsü kararlarını açık sözleşmelere bağlamaktır.

## 2. Tasarım ilkeleri

Her fiziksel veya oyun zamanı sonucu açık bir delta, tick veya frame girdisine dayanır.

Kritik state mümkün olduğunca immutable değerlerle taşınır.

Kimlikler string veya number olarak kullanılmaya devam eder ancak domain içinde branded type ile yanlış tür karışımı engellenir.

Hata sonuçları exception yerine Result modeliyle güvenli biçimde taşınır.

Sınırlandırılmamış queue, history, cache veya telemetry koleksiyonu bulunmaz.

Strict core içinde browser DOM, Three.js, vendor addon, server-side IO veya wall-clock bağımlılığı bulunmaz.

## 3. Dosya sahipliği

liveCoreTypes.ts temel domain sözlüğüdür.

cameraRuntime.ts kamera davranışını, orbit durumunu ve collision-safe kamera mesafesini sahiplenir.

physicsRuntime.ts ground sampling, circle/AABB collision, depenetration, swept movement ve jump state davranışını sahiplenir.

inputRuntime.ts keyboard, touch, gamepad ve synthetic input kaynaklarının normalize edilmiş semantik aksiyonlarını üretir.

assetRuntime.ts resident byte bütçesi, inflight limit, admission, retry, stale ve eviction kararlarını sahiplenir.

assetManifestRuntime.ts asset kimliği, URL güvenliği, checksum metadatası, bağımlılık grafiği ve deterministic load ordering sağlar.

renderBackendRuntime.ts WebGPU, WebGL2 ve headless fallback kararlarını ve otomatik quality tier seçimini yönetir.

renderFramePlanner.ts frame için görünür adayları ve render pass sırasını bütçeler.

entityBudgetRuntime.ts entity residency ve LOD seçimlerini CPU, memory ve kalite bütçesine göre sınırlar.

worldQueryRuntime.ts analitik world collider sorgularını deterministic sonuç sırasıyla verir.

streamingRuntime.ts oyuncu ve hareket vektörü merkezli predictive region planı oluşturur.

runtimeTelemetry.ts bounded counters, gauges, histograms, traces ve budget alarms üretir.

recoveryRuntime.ts renderer kaybı, memory pressure, asset failure ve network timeout gibi durumlar için kontrollü recovery planı üretir.

replayRuntime.ts input command journal, checkpoint ve branch timeline bilgisini checksum ile doğrular.

commandRuntime.ts monoton sequence, per-tick rate limit ve payload bound uygulayan runtime command journal'dır.

saveRuntime.ts versioned ve checksummed save envelope üretir ve migration zincirini uygular.

sceneRuntime.ts runtime phase state machine, viewport, visibility ve bounded frame history yönetir.

liveCoreRuntime.ts bütün strict modülleri deterministic orchestration sırasına bağlar.

liveCoreBridge.ts mevcut JavaScript/Three.js dünyasından strict domain değerlerine sınır dönüşümü sağlar.

strictLiveCorePolicy.ts frame, memory, network, input ve safety bütçelerinin merkezi politikasını tanımlar.

## 4. Runtime sırası

Bir frame başladığında önce input sınırı normalize edilir.

Input intent mevcut simulation state'e uygulanmak üzere sabit-step physics'e aktarılır.

Physics hareket, jump, ground contact, swept collision ve depenetration sonucunu üretir.

Kamera, oyuncu veya hedef transformundan bağımsız bir şekilde collision-aware bir target position üretir.

Asset runtime mevcut tick ile stale ve retry durumlarını günceller.

Render backend runtime mevcut capability ve pressure bilgisine göre aktif policy üretir.

Frame planner renderable adayları triangle, draw-call, distance ve importance değerlerine göre sınırlar.

Telemetry frame bütçelerini ve gözlem metriklerini kaydeder.

Snapshot checkpoint sistemi için stable digest üretilebilir.

## 5. Renderer geçiş stratejisi

WebGPU tercih edilen backend olabilir ancak yalnızca secure context ve adapter capability mevcutsa seçilir.

WebGL2 uyumluluk backend'i olarak tutulur.

Device-loss olayı strict renderer runtime üzerinde yeni bir generation oluşturur ve WebGL2 fallback seçimine izin verir.

Mevcut Three.js renderer yaşam döngüsü strict core'un içine taşınmaz.

Bu ayrım sayesinde renderer migration başarısız olduğunda gameplay state modeli geri alınmak zorunda kalmaz.

## 6. Asset güvenliği

Asset URL normalizasyonundan geçmeden admission yapılmaz.

HTTPS ve uygulama içi relative asset yolları kabul edilir.

Checksum bilgisi verilmişse SHA-256 biçimi doğrulanır.

Resident memory byte bütçesi aşılmadan önce düşük öncelikli resident assetler eviction adayı haline gelir.

Inflight request sayısı ve byte miktarı üst sınırlarla korunur.

Transient failure tekrarları exponential backoff ile sınırlandırılır.

Uzun süre kullanılmayan resident assetler stale state'e alınır.

## 7. Streaming stratejisi

Streaming bölgesi critical, near, mid ve far zone olarak ayrılır.

Planlama yalnızca oyuncu konumuna değil, kısa ileri hareket tahminine de bakar.

En yüksek priority critical region'lardan başlar.

Concurrent load sayısı bounded tutulur.

Resident memory bütçesi doluysa yeni düşük öncelikli bölge kabul edilmez.

Unload kararı hysteresis ile verilerek sınır bölgesinde sürekli load/unload thrash engellenir.

## 8. Replay ve determinism

Replay command'lerinin sequence değeri monoton artar.

Her command kendi payload ve kimliği üzerinden stable digest taşır.

Checkpoint, ilgili state digest'iyle birlikte journal digest saklar.

Branch timeline, orijinal komutların güvenli kopyasını kullanır.

Strict core içinde Math.random veya Date.now kullanılmaması guard tarafından zorlanır.

Deterministik davranış için zamanı parametre olarak taşıyan API tercih edilir.

## 9. Persistence

Save envelope schema, version, build ve tick bilgisini taşır.

Payload checksum envelope header ve payload üzerinden tekrar hesaplanabilir.

Load işlemi future version verisini doğrudan kabul etmez.

Version farkı varsa yalnızca ardışık migration adımları çalıştırılır.

Migration bulunamazsa sessiz veri bozulması yerine açık hata sonucu üretilir.

Save size bütçesi JSON kodlamasından sonra tekrar kontrol edilir.

## 10. Recovery

Recovery runtime aynı hata için sonsuz retry yapmaz.

Cooldown penceresi recovery storm oluşmasını engeller.

Renderer kaybı fallback renderer'a geçebilir.

Memory pressure cache flush ve quality reduction aksiyonlarını tetikleyebilir.

Aşırı tekrar sonrası subsystem restart veya fail-closed seçilebilir.

Stable tick süresi boyunca başarı görülürse degraded state healthy seviyesine dönebilir.

## 11. Legacy bridge kuralları

Bridge yalnızca dönüşüm yapar.

Bridge scene graph yönetmez.

Bridge renderer oluşturmaz.

Bridge storage yazmaz.

Bridge legacy object'in sahipliğini devralmaz.

Legacy input API'deki forward, strafe, running, guarding, jump ve lock-on bilgileri strict semantic actions'a çevrilir.

Gamepad axis ve button verileri deadzone ve action edge normalizasyonundan geçirilir.

Legacy vector benzeri değerler strict Vec3 değerlerine çevrilir.

## 12. Test stratejisi

liveCoreTypes testleri stable hash, immutability ve numeric normalization davranışlarını korur.

cameraRuntime testleri obstruction, lock-on, smoothing ve invalid lifecycle durumlarını korur.

physicsRuntime testleri jump arc, ground contact, collision ordering ve duplicate collider güvenliğini korur.

inputRuntime testleri keyboard, touch, gamepad, edge detection ve timestamp ordering davranışlarını korur.

assetRuntime testleri admission, inflight budget, eviction, retry ve stale transitions davranışlarını korur.

manifestRuntime testleri URL, checksum, dependency ordering ve family grouping davranışlarını korur.

renderPlanning testleri deduplication, importance sorting ve triangle budget davranışlarını korur.

worldRuntime testleri streaming concurrency, world query ve entity budget sınırlarını korur.

observability testleri bounded telemetry ve recovery cooldown davranışlarını korur.

replayCommandSave testleri command checksum, replay branch ve checksummed persistence davranışlarını korur.

liveCoreRuntime testleri lifecycle, fixed-step simulation, snapshot restore, device loss ve legacy bridge davranışlarını birlikte sınar.

policyAndScene testleri merkezi safety policy ve visibility/lifecycle sözleşmesini doğrular.

## 13. CI kapısı

R23 strict CI önce architecture guard çalıştırır.

Ardından yalnızca strict boundary için TypeScript compilation yapılır.

Sonra strict regression suite çalışır.

Bundan sonra repository genel typecheck, test ve production build çalıştırılır.

Ayrı determinism job'ı ambient nondeterministic primitive ve TypeScript escape hatch kullanımını arar.

Bu sıralama hata çıktısını mümkün olduğunca erken ve doğrudan verir.

## 14. Kademeli migration

İlk aşamada legacy runtime korunur.

İkinci aşamada bir gameplay path strict bridge üzerinden geçirilir.

Üçüncü aşamada gerçek Three.js scene owner strict state çıktısını tüketmeye başlar.

Dördüncü aşamada duplicate gameplay logic azaltılır.

Beşinci aşamada eşdeğer regression coverage sağlandıktan sonra compatibility implementation kaldırılabilir.

Strict core, compatibility implementation'ın önüne geçirilmemelidir; önce davranış eşdeğerliği kanıtlanmalıdır.

## 15. Performance sınırları

Fixed-step physics frame time dalgalanmalarını simulation sonuçlarından ayırır.

Asset runtime bounded admission ile memory spike riskini azaltır.

Entity budget uzak entity güncelleme maliyetini LOD seviyesine göre azaltır.

Render planner görünür candidate sayısını ve triangle budget'ini explicit olarak sınırlar.

Telemetry ring buffer yaklaşımı sınırsız log büyümesini önler.

Snapshot history bounded tutulur.

Command journal bounded history kullanır.

Recovery history bounded tutulur.

Streaming concurrent load sayısını sınırlayarak startup ve traversal dönemlerinde IO baskısını azaltır.

## 16. Güvenlik sınırları

NaN ve Infinity gameplay state içinde doğrulanır.

Command payload anahtarları ve string değerleri sınırlandırılır.

Asset URL protokolü doğrulanır.

Asset integrity metadata biçimi doğrulanır.

Save envelope checksum doğrulaması olmadan kabul edilmez.

Renderer backend seçimi capability sonucuna bağlıdır.

Strict source tree içinde TypeScript escape hatch kullanımına izin verilmez.

## 17. Gelecek adımlar

Mevcut src/3d/camera.ts, input.ts, physics.ts ve assetLoader.ts dosyaları strict owner'a kademeli olarak adapter üzerinden bağlanabilir.

Sonraki migration adımı sceneManager ve game3d tick loop'undan strict live core çıktılarını beslemektir.

Daha sonraki aşamada mevcut rendering/nextGen stack, strict RenderPolicy ve RenderFramePlan çıktılarıyla beslenecek şekilde daraltılabilir.

R23 bu geçiş için foundation görevi görür; renderer veya asset implementation'ı zorla değiştirmek yerine açık sözleşmeler üzerinden sahiplik transferini güvenli hale getirir.