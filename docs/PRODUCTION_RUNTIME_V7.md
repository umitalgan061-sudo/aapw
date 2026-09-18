# AAPW Production Runtime V7

## Genel yaklaşım

Production Runtime V7, mevcut TypeScript-first mimarinin üzerine bounded ve deterministik bir uygulama çekirdeği ekler. Amaç tek bir dosyayı büyütmek değil; simülasyon, render, ağ, asset, persistence, güvenlik, gözlemlenebilirlik ve recovery kararlarını ortak runtime sınırında toplarken mevcut legacy Three.js yüzeylerinin kademeli olarak korunabilmesidir.

## Deterministik çekirdek

FixedClockV7 sabit frekanslı tick üretir. DeterministicRngV7 explicit seed ve fork desteği verir. stableStringifyV7 anahtar sıralamasını sabitleyerek snapshot ve benchmark checksum üretimini tekrar edilebilir hale getirir. SequenceWindowV7 eski veya tekrarlanan network sequence değerlerini filtreler.

## Entity ve world state

EntityStoreV7 bileşenleri immutable kopyalarla saklar. Vital değerleri sınırlar, tag setini normalize eder ve dirty network revision'larını izler. SpatialIndexV7 hücre tabanlı bounded sorgu sağlar. WorldStateRuntimeV7 tam snapshot uygulama, state replacement, digest ve delta üretimini üstlenir.

## Scheduler ve frame yönetimi

BudgetSchedulerV7 kritik, simulation, streaming, render, telemetry ve background lane'leri kullanır. Priority, yaşlanma ve bütçeye sığma birlikte değerlendirilir. FrameOrchestratorV7 inputtan background işlerine kadar aşamaları tek bir frame raporunda toplar ve bir stage hatasının bütün frame'i kırmasını önler.

## Network

NetworkRuntimeV7 packet boyutu, saniyelik byte ve command limitleri, snapshot rate limitleri, reliable mesaj expiration, retransmit sayısı, RTT ve jitter takibi sunar. Prediction buffer ve reconciliation sonucu server state ile client state arasındaki mesafeyi ölçerek rollback başlangıcı bildirir.

## Render policy

Platform sinyalleri başlangıç kalite profilini belirler. AdaptiveRenderPolicyV7 frame süresi, draw call, triangle ve memory baskısını birlikte değerlendirir. Baskı yükseldiğinde render scale azaltılır ve pahalı özellikler kontrollü biçimde devre dışı bırakılır. Bu kararlar tek bir global kalite sabitine bağlı değildir.

## Asset lifetime

AssetCacheV7 bounded resident memory kullanır. Critical varlıklar normal eviction akışında korunur. Aynı asset için eşzamanlı loader çağrıları tek in-flight promise üzerinden birleştirilir. Last-use tick ve hit bilgileri eviction kararını deterministik kılar.

## Persistence ve migration

SaveManagerV7 schema 7 envelope, checksum ve migration zinciri kullanır. Save payload sınırı konfigüre edilebilir. Legacy world payloadları migration.ts üzerinden normalize edilerek production world snapshot formatına çevrilebilir. Migration sonucu ayrıca checksum ile raporlanır.

## Güvenlik

RuntimeValidatorV7 input, command ve snapshot şekillerini bağımsız doğrular. RuntimeSecurityV7 sequence replay, duplicate command, payload büyüklüğü, text uzunluğu, coordinate sınırı ve resource amount gibi saldırı yüzeylerini sınırlar. Güvenlik kontrolü uygulanmadan world mutasyonu yapılmaz.

## Recovery ve health

RuntimeTelemetryV7 metric ring ve span toplar. Health skoru frame, simulation, RTT ve heap pressure sinyallerinden çıkarılır. RuntimeRecoveryV7 bu sinyallerden recovery planı oluşturur. Recovery adımları handler tabanlıdır; render ölçeği, asset cache, streaming, simulation, network ve background scheduler ayrı ayrı yönetilebilir.

## Bootstrap

bootstrapProductionRuntimeV7 uygulama composition root görevini görür. Tek bir handle runtime, frame orchestrator, lifecycle ve health yüzeylerine erişir. Headless ve constrained factory'leri CI ve düşük donanım doğrulaması için deterministik girişler sağlar.

## Test modeli

Production V7 testleri birim davranış, entegrasyon, deterministik tekrar, güvenlik, migration, scheduler, network, persistence, render policy ve release gate seviyelerini kapsar. Aynı seed ile çalışan benchmark ve state checksum değerlerinin değişmemesi beklenir.

## Entegrasyon sınırı

Bu paket mevcut nextgen, v3, v4 ve v6 modüllerini kaldırmadan üst seviye orchestration sağlar. Bir sonraki aşamada browser IndexedDB, mevcut asset loader, Three.js render bridge ve gerçek transport adapterları burada bağlanabilir. Böylece runtime sahipliği adım adım taşınır ve rollback maliyeti sınırlı tutulur.
