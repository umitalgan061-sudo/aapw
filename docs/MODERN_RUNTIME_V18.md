# AAPW Modern Runtime V18

V18, AAPW'nin mevcut TypeScript-first çalışma zamanını tek bir monolitik sınıfa taşımak yerine, açık sınırları olan bağımsız runtime servisleri halinde birleştirir.

## Mimari

`RuntimeApplication` composition root'tur. Aşağıdaki sistemleri tek lifecycle altında tutar:

- `ApplicationKernelV3`: faz sıralaması ve fixed-step frame çalışması.
- `RuntimeTopologyV18`: dependency graph, capability ownership ve servis yaşam döngüsü.
- `InputPipelineV18`: keyboard, pointer, touch ve gamepad sinyallerinin semantic komutlara dönüşümü.
- `WorldLifecycleV18`: oyuncu/kamera ilgisine göre bounded zone streaming.
- `AssetLifecycleV18`: byte-budget, retry, integrity ve eviction.
- `RenderPolicyV18`: WebGPU/WebGL2 seçimi ve pressure-aware quality.
- `PersistenceEnvelopeV18`: boyut sınırlı, checksummed save envelope.
- `ObservabilityV18`: bounded telemetry, counters, histograms ve trace spans.
- `RuntimeMigrationRegistryV18`: JS -> TS sahiplik geçişi için parity ve blocker kaydı.
- `TypedLegacyBoundaryV18`: legacy JavaScript modülleri için dar typed seam.

## Tarayıcı entegrasyonu

`createBrowserRuntimeBridgeV18()` DOM olaylarını doğrudan gameplay'e iletmez. Önce semantic input pipeline'a çevirir. RAF loop, visibility değişimi, resize ve disposal aynı bridge tarafından yönetilir.

Bu ayrım sayesinde renderer bağımlı kodlar runtime core'a sızmaz.

## JS -> TypeScript stratejisi

Mevcut legacy JS bir kerede silinmez. Her yüzey:

1. legacy,
2. adapter,
3. shadow,
4. typed,
5. validated

aşamalarından geçer.

Parity gerektiren yüzeylerde minimum kanıt skoru runtime registry tarafından zorunlu tutulur.

## Performans

V18 darboğazları ölçülebilir tutulur:

- world residency RAM baytı üzerinden,
- asset residency yine RAM baytı üzerinden,
- input queue uzunluk ve drop sayıları,
- render pressure frame/cpu/gpu/memory/thermal sinyallerinden,
- telemetry event/metric sayıları bounded ring mantığıyla.

## Güvenlik

Runtime core:

- `eval()` ve `new Function()` kullanmaz,
- input queue'yu sınırlı tutar,
- asset boyutlarını doğrular,
- asset SHA-256 bilgisi sağlandığında integrity check uygular,
- save envelope boyutunu sınırlar,
- legacy kodu typed boundary arkasında tutar.

## Üretim geçişi

Önerilen akış:

`gameEntry.ts` -> `createBrowserRuntimeBridgeV18()` -> `RuntimeApplication` -> mevcut renderer/gameplay.

İlk geçişte renderer davranışı değiştirilmez. V18 kararları telemetry ve adapter katmanında gözlemlenir; parity kanıtı oluştuğunda ownership typed tarafa alınır.

## Doğrulama

CI V18 guardı:

- zorunlu dosyaların varlığını,
- modern barrel exportlarını,
- strict TypeScript seçeneklerini,
- `@ts-nocheck`, `@ts-ignore`, `eval` ve `new Function` yasaklarını

kontrol eder.

Ayrıca V18 hedef testleri ve modern production build çalıştırılır.
