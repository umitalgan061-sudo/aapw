# AAPW Modern Runtime v4

## Amaç

v4 katmanı, mevcut TypeScript runtime v3 yüzeyinin üzerine deterministik ve renderer-agnostic bir uygulama platformu ekler. Yeni katman Three.js nesnelerini doğrudan yönetmez; bunun yerine komut, simülasyon, ağ, varlık, girdi ve render paketlerini tip güvenli sözleşmeler üzerinden taşır.

## Mimari

`runtimeContractsV4.ts` sistemler arası ortak veri modelidir. Branded kimlikler, tick/trace kavramları, render paketleri, network zarfları, snapshot sözleşmeleri ve bütçe tipleri tek bir sözlükte tutulur.

`commandBusV4.ts` komutları TTL, öncelik, bounded queue ve middleware ile işler. Üst öncelikli kritik komutlar düşük öncelikli işleri kuyruktan çıkarabilir. Handler hataları kontrollü `RuntimeErrorV4` sonuçlarına dönüştürülür.

`schedulerV4.ts` sabit adımlı simülasyonu input, simulation, world, network, assets, audio, render ve telemetry lane'lerine böler. Her lane bağımsız süre bütçesine sahiptir. Catch-up adımları sınırlıdır ve büyük delta değerleri tarayıcıyı kilitlemez.

`ecsSystemsV4.ts` hareket, stamina, sağlık ve kamera davranışlarını Three.js'ten ayırır. Entity state düz veri olarak tutulur; aynı sistemler headless testlerde veya gerçek sahnede kullanılabilir.

`spatialIndexV4.ts` dünya sorgularını hücre bazında sınırlar. Radius, nearest ve bounds sorguları belirli bir candidate alanına bağlıdır ve sonuçlar entity id ile deterministik sıralanabilir.

`networkReplicationV4.ts` transform quantization, revision kontrolü, checksum doğrulaması ve peer bazlı bounded backpressure sunar. Ağ protokolü websocket/webtransport/worker bridge gibi farklı taşıyıcılara bırakılmıştır.

`assetStreamingV4.ts` önceliklendirilmiş asset kuyruğu, concurrency sınırı, cache, lease ve abort yönetimi sağlar. Optional asset'ler kritik varlıkları bloke etmeden arka planda yüklenebilir.

`inputCommandV4.ts` keyboard, mouse, pointer, touch, gamepad, XR ve virtual input kaynaklarını ortak command modeline çevirir. Mode gating ile menu/debug/gameplay ayrımı yapılır.

`renderPipelineV4.ts` render kaynaklarını packet haline getirir ve kalite seviyesini frame/cpu/gpu/draw/triangle pressure üzerinden ayarlar. Hysteresis sayesinde tek karelik spike'lar sürekli kalite salınımı oluşturmaz.

`observabilityV4.ts` bounded logs, spans, counters, metrics ve health window üretir. Telemetri koleksiyonlarının sınırsız büyümesi engellenir.

`releaseGateV4.ts` build id, runtime health, typecheck, test, deterministic guard, quality floor, forbidden primitive, asset integrity ve network protocol koşullarını tek raporda birleştirir.

`runtimeOrchestratorV4.ts` komut, scheduler, spatial, assets, network, render ve input sistemlerinin composition root'udur. Pause/resume/stop/recovery/snapshot işlemleri burada koordine edilir.

`runtimeV4Facade.ts` mevcut legacy 3D yüzeyi ile yeni runtime arasında kontrollü geçiş noktasıdır. Bu sayede eski `game3d.js` dünyası bir anda silinmeden yeni runtime aşamalı olarak üretim akışına alınabilir.

## Determinizm kuralları

v4 çekirdeğinde `Math.random`, dinamik `eval` ve `new Function` kullanılmamalıdır. Tick sırası explicit olmalı, entity ve command sonuçları stable sorting kullanmalıdır. Test ve release guard'ları bu sınırı tekrar kontrol eder.

## Bütçe politikası

Runtime her frame aşağıdaki alanları ayrı ayrı izler:

- frame süresi
- CPU/GPU yükü
- draw call ve triangle sayısı
- network byte hacmi
- asset byte hacmi
- aktif ve görünür entity sayısı
- queued command/asset sayısı

Kalite düşürme önce presentation katmanında yapılır; simulation doğruluğu korunur. Minimum kalite, release gate tarafından ayrıca doğrulanır.

## Ağ güvenliği

Network payload'ları revision ve checksum olmadan state'e uygulanmamalıdır. Peer sayısı bounded tutulur. Reliable queue dolduğunda unreliable telemetry ilk tahliye edilen trafik olmalıdır.

## Asset güvenliği

Asset URL'si ve descriptor'ı manifest üzerinden doğrulanmalıdır. Byte budget ve optionality runtime başlamadan önce bilinmelidir. İndirilen veri manifest byte sayısını karşılamıyorsa kabul edilmemelidir.

## Recovery

Recovery sırasında komut kuyruğu temizlenir, input state sıfırlanır ve streaming abort edilir. Runtime yeni bir composition root oluşturmadan aynı servis grafiği ile tekrar running durumuna geçer.

## Legacy geçişi

v4'ün amacı mevcut uygulamayı bir gecede kırmak değil, ownership'i netleştirmektir. Legacy modüller facade arkasında tutulmalı ve parity kanıtı biriktikçe gerçek implementasyonlar v4 sistemlerine taşınmalıdır.

## Release checklist

1. TypeScript strict check tamamlanmalı.
2. v4 regression suite tamamlanmalı.
3. Deterministik guard geçmeli.
4. Forbidden primitive taraması sıfır sonuç vermeli.
5. Runtime health release minimumunu geçmeli.
6. Asset integrity ve network protocol hataları sıfır olmalı.
7. Production build v4 facade ile smoke test edilmelidir.

## Beklenen sonuç

Bu katman, browser runtime'ının tek bir devasa `game3d.js` döngüsüne bağlı kalmasını azaltır. Sistem sınırları, veri sahipliği ve bütçe yönetimi tip seviyesinde görünür hale gelir. Sonraki migration turlarında gerçek scene implementation'larının aynı sözleşmeleri tüketmesi hedeflenir.
