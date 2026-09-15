# Terrain Groundwater Surface Layer

## Amaç

`terrainGroundwaterRegime.js` mevcut terrain yüzeyinin altında varsayılan bir su tabakası simüle etmez. Bu katman yalnızca render kararları üretir. Üretilen sinyaller suya yakınlık, doygunluk, kapiler yükselme, sızıntı yüzeyi, yüzey filmi, su birikintisi kalıcılığı, mineral taşınımı ve kuruma direnci gibi görsel kanallardır.

Bu ayrım özellikle önemlidir: gerçek dünya benzerliği için yeni arazi geometrisi üretmek yerine mevcut geometry ve hidrology sinyallerinin görünüşe etkisi zenginleştirilir. Böylece katman terrain authority haline gelmez.

## Değişmezler

Aşağıdaki kurallar bu katmanın tasarım sözleşmesidir:

- canonical terrain height değişmez.
- canonical hydrology topology değişmez.
- coastline geometry değişmez.
- collider geometry değişmez.
- navigation geometry değişmez.
- vegetation placement kararları değişmez.
- yeni coğrafya veya kalıcı su kütlesi oluşturulmaz.
- bütün sinyaller deterministiktir.
- bütün sunum kanalları `[0, 1]` aralığında tutulur.
- shader tarafında vertex displacement yapılmaz.

## Katman akışı

```text
terrain sample
    |
    v
normalization
    |
    +--> deterministic groundwater field
    |          |
    |          +--> regional signal
    |          +--> local signal
    |          +--> capillary texture
    |          +--> seepage texture
    |          +--> contour texture
    |
    +--> recharge potential
    +--> water-table proximity
    +--> capillary rise
    +--> seepage face
    +--> surface saturation
    +--> saturation memory
    +--> drying resistance
    +--> surface film
    +--> mineral mobilization
    +--> puddle persistence
    +--> marsh-edge factor
    +--> stress channels
    |
    v
surface adapter
    |
    v
material response + bounded shader hooks
```

## Normalizasyon

`normalizeGroundwaterSample()` tüm çevresel girdileri güvenli aralıklara indirger. World koordinatları sayısal değilse sıfıra düşer. Eğim `0..89`, toprak derinliği `0..6 m`, yüzey suyu uzaklığı ve yeraltı su seviyesi mesafeleri pozitif üst sınırlarla sınırlandırılır.

`dayOfYear` için 360 günlük deterministik döngü kullanılır. Negatif günler ve 360 üzerindeki günler döngüye sarılır. Bu, seasonal katmanıyla birleşirken floating-point drift üretmemeyi hedefler.

`windExposure` normalize edilen sample içinde tutulur. Kuruma direnci hesaplaması böylece stack içindeki diğer wind katmanlarından gelen çevresel girdiye cevap verebilir.

## Deterministik alan

Groundwater field tek bir büyük noise çağrısından oluşmaz. Beş farklı ölçek kullanılır:

| Alan | Ölçek | Rol |
| --- | ---: | --- |
| regional | 410 m | geniş su tablası eğilimi |
| local | 74 m | yerel nem cepleri |
| capillary | 18 m | kapiler mikro varyasyon |
| seepage | 9x14 m | sızıntı çizgileri |
| contour | 57x91 m | eğik çevresel bağlantı |

Bu alanlar hash tabanlı lattice/value noise ile oluşturulur. `Math.random()` kullanılmaz. Aynı world coordinate her zaman aynı sonucu üretir.

## Recharge

`rechargePotential` yağış, runoff, mevsimsel forcing, eğim, drenaj, toprak kapasitesi ve geçirgenlik bileşimini kullanır. Maksimum sinyal doğrudan bir fiziksel hacim değildir; yalnızca yüzeyin yağışa görsel cevap verme ihtimalini ifade eder.

Eğim arttığında yüzeyde tutulma azalır. Drenaj arttığında recharge görsel etkisi sınırlanır. Bunun amacı su akışını yeniden çözmek değil, mevcut runoff katmanını tamamlamaktır.

## Water-table proximity

`waterTableProximity` dört temel ipucunu birleştirir:

1. groundwater depth,
2. yüzey suyu uzaklığı,
3. geniş ölçekli lowland eğilimi,
4. yerel seepage texture.

Bu kanal ``su burada gerçekten mevcut`` demek değildir. Sadece mevcut yüzey materyalinin yeraltı su sistemine yakın görünme ihtimalidir.

## Kapiler yükselme

Kapiler sinyal, su tablasına yakınlık ile toprak derinliğini birleştirir. Geçirgenlik tek başına maksimum kapiler etkiyi belirlemez; yüzeyin kuruma talebi ve eğim de hesaba katılır.

Bu kanalın önemli bir özelliği sürekliliktir. Nem bir karede açılıp diğer karede kapandığı bir binary switch değildir.

## Seepage face

Seepage, sızıntının eğimli bir yüzey üzerinde görünür hale geldiği durum için ayrıdır. Sinyal eğim bandı, water-table proximity, seepage texture ve drenaj ile sınırlandırılır.

Seepage yüzeyde yeni bir dere veya akış çizgisi yaratmaz. Sadece mevcut yüzeyin malzeme tepkisini değiştirir.

## Surface saturation

Yüzey doygunluğu şu bileşenlerle kurulur:

```text
recharge
water-table proximity
capillary rise
seepage face
rain/runoff
wet-history memory
- evaporation demand
```

Sonuç clamp edilerek `[0,1]` aralığında kalır.

## Saturation memory

Geçmişte ıslak kalan yüzeylerin görsel olarak hemen kuruması engellenir. `wetDays` pozitif yönde retention sağlar. `dryDays` arttığında retention azalır.

Bu mekanizma canonical state saklamaz. Girdiden yeniden türetilen deterministic bir hafıza yaklaşımıdır.

## Kuruma direnci

Kuruma direnci water-table proximity, capillary rise, toprak derinliği, wind exposure ve sıcaklık talebinin birleşimidir. Değer yükseldikçe yüzeyin nemli görünümünü koruması daha olasıdır.

Wind exposure normalizasyonu özellikle stack entegrasyonunda kritiktir. Varsayılan değer güvenli olsa da gerçek sample değeri mevcutsa onun kullanılması gerekir.

## Surface film

Surface film, doygunluk, hafıza, seepage ve düşük eğimli mikro doku sinyallerinin görsel sentezidir.

Material katmanında film:

- roughness düşürür,
- çok küçük bir renk biası verir,
- sınırlı normal response ekler.

Film asla mesh displacement yapmaz.

## Mineral mobilization

Mineral kanalı iki ayrı görsel davranış üretir:

- fine transport: ıslak yüzeyde ince malzeme taşınımı,
- salt ring: ıslaklığın geri çekildiği yüzeyde mineral birikim izi.

Bu iki kanal aynı anda maksimuma ulaşmayacak şekilde birbirine bağlıdır. Salt ring kuru kenar görünümünü temsil eder; gerçek evaporatif kimyasal simülasyon değildir.

## Puddle persistence

Puddle persistence, surface film, drainage, slope ve yerel field texture kullanır. Düşük eğim ve zayıf drenaj, kalıcılık sinyalini yükseltir.

Puddle yalnız materyal görünüşü veya gelecekteki dekoratif decal kararları için sinyal olabilir. Bu modül kendi başına su mesh'i oluşturmaz.

## Marsh edge

Marsh edge, water-table proximity, surface saturation, düşük kot ve sığ eğim bileşimidir. Bu kanal biyom değişikliği değildir. Mevcut lowland fabric katmanına materyal geçişi için ek kanaldır.

## Material response

`groundwaterMaterialResponse()` temel renkten küçük bir sapma üretir. Roughness ve normal güçleri policy limitleri içinde kalır.

Policy:

```text
maxWetnessShift      0.16
maxAlbedoShift       0.12
maxRoughnessShift    0.12
maxNormalStrength    0.08
```

Gerçek stack'te `applyGroundwaterBudget()` son bir bounded guard olarak kullanılır.

## Shader entegrasyonu

`terrainGroundwaterShader.js` Three.js `onBeforeCompile` hook'larına eklenir. Üç fragment noktası vardır:

- `color_fragment`
- `roughnessmap_fragment`
- `normal_fragment_maps`

Vertex shader'a write yapılmaz. Height map, collision veya hydrology buffer güncellenmez.

`customProgramCacheKey()` groundwater material policy anahtarını içerir. Bu, aynı Three.js material'ın farklı shader varyantlarını güvenli biçimde cache'lemesine yardımcı olur.

## Adapter

`terrainGroundwaterSurfaceAdapter.js` CPU/state tarafındaki sinyalleri material-friendly kanallara dönüştürür. Adapter ayrıca komşuluk agregasyonu ve edge accent sağlar.

Kanal seti:

| Kanal | Anlam |
| --- | --- |
| wetness | nihai yüzey ıslaklığı |
| surfaceFilm | geçici yüzey filmi |
| waterTableProximity | su tablasına görsel yakınlık |
| capillaryRise | kapiler nem |
| seepageFace | sızıntı yüzeyi |
| saturation | anlık doygunluk |
| memory | nem hafızası |
| dryingResistance | kuruma direnci |
| puddlePersistence | birikinti kalıcılığı |
| marshEdge | bataklık kenarı sinyali |
| fineTransport | ince malzeme taşınımı |
| saltRing | mineral kenar izi |
| freezeWetness | ıslak-don stresi |
| dryingDemand | kuruma talebi |

## Material stack

`terrainGroundwaterMaterialStack.js` mevcut terrain stack içine kontrollü bir facade sağlar.

Önerilen sıra:

1. base-terrain
2. sediment
3. soil-structure
4. seasonality
5. climate-exposure
6. wind-drying
7. thermal-microclimate
8. groundwater
9. material-budget

Bu sıra groundwater'ı ayrı bir hydrology authority yapmadan son yüzey ayrıntılarından biri olarak tutar.

## Event responses

Stack facade beş görsel olay tipini destekler:

- `storm`
- `drought`
- `freeze-thaw`
- `snowmelt`
- `recovery`

Olaylar yalnız material delta üretir. Persistent simulation state yazılmaz.

## Diagnostics

`terrainGroundwaterDiagnostics.js` her state için confidence, presentation tier, severity, metric snapshot ve telemetry üretir.

Confidence hesabı fizik doğruluğu puanı değildir. Input kalitesinin ve sinyal gücünün görsel sunum kararlarına uygunluğunu anlatır.

Presentation tier:

```text
>= .84 high
>= .64 medium
>= .42 low
else suppressed
```

Severity ise wetness, drought ve stress kanallarının görsel riskini sınıflandırır.

## Determinism QA

Aynı sample'ın aynı signature üretmesi kritik bir kapıdır. Testler aşağıdakileri kontrol eder:

- grid determinism,
- day wrap,
- extreme input clamping,
- state freezing,
- signature stability,
- material response bounds,
- shader hook presence,
- neighborhood aggregation,
- event response bounds.

## Boundary QA

Boundary suite minimum ve maksimum girdileri dener:

- 0/89 derece eğim,
- 0/1 yağış,
- 0/1 runoff,
- 0/1 moisture,
- 0/1 permeability,
- 0/6 m soil depth,
- 0/5000 m water distance,
- 0/5000 m groundwater depth,
- 0/365 wet/dry days,
- -40/+55°C sıcaklık,
- 0/1 drainage.

Beklenti, tüm sonuçların finite ve bounded olmasıdır.

## Seasonal QA

360 günlük cycle üzerinde 12 mevsimsel pencere kullanılır. Testler sezon sınırlarını ve wrap davranışını doğrular. Wet history arttığında retention'ın anlamsız şekilde tersine dönmemesi, dry history arttığında recovery sinyalinin azalabilmesi beklenir.

## Material QA

Material suite aşağıdaki davranışları kapsar:

- color channels finite,
- roughness finite,
- normal strength bounded,
- wetness bounded,
- blend endpoints identity,
- midpoint interpolation,
- neighborhood edge contrast,
- budget guard,
- idempotent shader installation.

## Integration QA

Integration suite state -> frame -> stack akışının policy zincirini koruduğunu denetler. Her seviyede canonical invariant alanlarının korunması beklenir.

Özellikle şu yol tek bir referans zinciridir:

```text
resolveTerrainGroundwaterState()
        |
        v
resolveGroundwaterSurfaceFrame()
        |
        v
resolveGroundwaterStackFrame()
        |
        v
applyGroundwaterBudget()
```

## Failure modes

### Aşırı yağış

Yüzey film ve saturation yükselir, fakat maksimum kanal değeri 1 ile sınırlıdır. Material response doğrudan yağış miktarı olarak yorumlanmamalıdır.

### Çok derin su tablası

Water-table proximity azalır. Surface film tamamen sıfırlanmak zorunda değildir; rainfall, local field ve moisture history yine etkileyebilir.

### Çok dik yüzey

Puddle ve film azalır. Seepage ancak eğim bandı içinde anlamlı hale gelir.

### Çok sıcak hava

Evaporation demand yükselir. Salt ring ancak uygun seepage ve wetness gradient'i ile görünürleşir.

### Kuvvetli rüzgâr

Drying resistance azalır. Bu, existing wind-exposure layer ile uyumlu bir presentation signal'dir.

### Soğuk ve ıslak yüzey

Freeze stress artabilir. Bu değer doğrudan geology change değildir; freeze-thaw surface aging katmanına görsel input olarak verilebilir.

## Performance notu

CPU functions pure ve allocation açısından küçük nesneler döndürür. Per-fragment noise ise birkaç octave kullanır ve fragment-only'dir.

Üretimde aynı state'i frame boyunca tekrar hesaplamaktan kaçınmak için adapter frame cache'lenebilir. Cache key world coordinate, relevant environmental inputs ve policy version birleşiminden oluşmalıdır.

## Cache güvenliği

Material cache key policy ID'leri içermelidir. Groundwater shader değiştiğinde yeni bir material program variantı oluşması beklenir.

Runtime cache'leri canonical world state yerine render state saklamalıdır.

## Regression fixture kullanımı

`terrainGroundwaterFixturesLowland.js` ve `terrainGroundwaterFixturesUpland.js` sınır örnekleri sağlar. Fixture'lar farklı kot, eğim, su mesafesi, groundwater depth, substrate ve biome kombinasyonlarını temsil eder.

Fixture bir terrain patch tanımlamaz; yalnız hesaplama için deterministic input'tur.

## Substrate çeşitliliği

Preset catalog sekiz substrate üzerinden çalışır:

- loam
- clay
- sand
- gravel
- peat
- marl
- shale
- limestone

Bunların amacı gerçek jeoloji sınıflandırması yapmak değil, permeability, soil depth ve drainage farklılıklarını kontrollü biçimde test etmektir.

## Preset catalog

24 groundwater preset'i farklı biome + substrate + drainage + groundwater depth kombinasyonlarını kapsar. Preset interpolasyonu binary biome switching yerine sürekli çevresel geçiş testine imkan verir.

## Telemetry

Önerilen telemetry alanları:

```json
{
  "policyId": "terrain-groundwater-regime-2026-09-15-v1",
  "confidence": 0.0,
  "presentationTier": "medium",
  "severity": "nominal",
  "metrics": {
    "surfaceFilm": 0.0,
    "surfaceSaturation": 0.0,
    "waterTableProximity": 0.0
  }
}
```

Telemetry persisted gameplay save state değildir.

## Kabul ölçütleri

Bir değişiklik aşağıdaki kapılar geçmeden merge edilmemelidir:

1. Determinism suite geçmeli.
2. Boundary suite geçmeli.
3. Seasonal suite geçmeli.
4. Material/shader suite geçmeli.
5. Integration suite geçmeli.
6. `git diff --check` temiz olmalı.
7. PR latest main ile aynı veya onun üstünde olmalı.
8. Canonical invariants korunmalı.
9. 4.000+ anlamlı değişiklik/ekleme kuralı sağlanmalı.

## Gelecek stack bağlantıları

Groundwater layer sonraki terrain yüzey katmanlarına açık girişler sağlar. Potansiyel bağlantılar:

- sediment film taşıma,
- wet soil darkening,
- thermal cracking sonrası mineral açığa çıkması,
- drought recovery,
- lowland vegetation edge weights.

Bu bağlantılar material/surface presentation ile sınırlı kalmalıdır. Yeni hydrology solver oluşturmak veya mevcut terrain authority'yi bölmek bu modülün kapsamı değildir.

## Son kontrol listesi

- [ ] policy ID değişiklikte güncellenmiş mi?
- [ ] shader yalnız fragment hook kullanıyor mu?
- [ ] vertex displacement yok mu?
- [ ] tüm kanallar finite ve bounded mı?
- [ ] state ve frame immutability korunuyor mu?
- [ ] material budget uygulanıyor mu?
- [ ] deterministic signature değişikliği bilinçli mi?
- [ ] fixture coverage güncel mi?
- [ ] integration suite kaynak zincirini doğruluyor mu?
- [ ] main freshness doğrulandı mı?
- [ ] 4.000+ meaningful-line kapısı sağlandı mı?
