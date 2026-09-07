# Canonical Biome Asset Distribution

Bu katman, owner-supplied canonical dünya haritasını gerçek dünya asset dağılımına bağlayan render-semantic sözleşmedir.

## Yetki sınırları

`worldReferenceMap.js` canonical biyom, su ve rölyef referanslarını tanımlar. `worldReferenceAlignment.js` 2D harita ile normalize edilmiş referans arasındaki dönüşümü tanımlar. Bu yeni katman bu iki kaynağı tüketir; yeniden harita çizmez.

`MaterialAssignmentCore.js` gerçek material uygulama otoritesidir. `biomeSurfaceFabric.js` yalnızca bu otoriteye verilecek semantik yüzey tariflerini üretir. `WorldAssetPlacementPipeline.js` footprint/grounding otoritesidir. Yeni planner placement isteği üretir ama mesh attach etmez.

Gameplay, combat, NPC AI, navigation, water height, terrain height ve collider mantığı bu katmanın dışında kalır.

## Neden gerekli?

Önceki yapı kuzeyde cryosphere ve vegetation özel kurallarıyla iyi sonuç veriyordu; fakat canonical haritanın güney/doğu bölgeleri tek bir genel vegetation diliyle temsil edilebiliyordu. Bu nedenle çöl, steppe, jungle, kıyı, dağ ve volkanik bölgeler arasındaki asset yoğunluğu ve aile farkı görsel olarak yeterince güçlü değildi.

Yeni sözleşmede her canonical zone önce profile'a çözülür. Profile; land-cover, scatter ailesi, geology ailesi, mimari adayları, material sinyalleri, mevsimsel tutum ve micro-patch parametrelerini birlikte taşır.

## Dağılım modeli

Dağılım deterministiktir. Seed aynı kaldığında aynı profile, aile, scale ve asset tercihi elde edilir. Spatial placement random yerine bounded spiral/radial sampling kullanır; böylece grove/clearing karakteri üretilebilirken road, seat, shore ve steep-slope exclusion korunur.

Yoğunluk; biyom katsayısı, su etkisi, slope, grove/clearing politikası ve kategoriye göre hesaplanır. Jungle ve lush profilleri daha yüksek organik yoğunluk alırken desert, volcanic ve exposed-rock profilleri daha düşük biyotik yoğunluk ve daha yüksek geology ağırlığı alır.

## Asset-first yaklaşımı

Gerçek repository GLB adayları doğrudan profile içinde listelenir. Candidate seçimi asset hazır olduğu anlamına gelmez. Hydration/readiness ve Shared Material Placement kontratları hâlâ authoritative kapıdır.

Asset bulunamaz veya LFS pointer olarak kalırsa mevcut üretim sistemi kendi procedural fallback'ine dönebilir. Bu katman asla placeholder modeli gerçek asset diye işaretlemez.

## Surface fabric

Aynı model ailesi farklı coğrafyalarda aynı plastik yüzeye sahip olmamalıdır. Surface fabric; base semantic color, roughness, micro-normal strength, dirt, wetness, snow ve weathering sinyallerini biome profile'dan üretir.

Örnekler:

- Snow: yüksek frost ve snow response, soğuk granite/aged pine sinyali.
- Desert: düşük wetness, yüksek dust/exposure, warm sand ve oxidized metal.
- Jungle: çok yüksek rain/wetness, humid green ground, rain-darkened wood.
- Coast: salt/wetness etkisi ve weathered timber/shore rock.
- Valyria: ash-black ground, basalt/obsidian geology ve charred timber.

Texture generation yine Shared Material Core tarafından gerçekleştirilir; fabric ikinci bir texture engine değildir.

## Planner çıktısı

Planner her placement için deterministic `x/z/y/scale/yaw`, family, optional real asset path, slope, water depth, road/seat distance ve confidence üretir. Bu kayıtlar debugging ve future streaming için yeterli, fakat gameplay state taşımaz.

`validatePlacementPlan()` minimum spacing ve exclusion invariants'larını tekrar kontrol eder. Böylece daha sonraki producer katmanı planner'ı güvenliksiz biçimde tüketse bile contract ihlali görünür olur.

## Kabul kapsamı

Acceptance testleri canonical 17 biome zone'unun merkezlerini ve deterministik çevre örneklerini tarar. Ayrıca profile round-trip, seed determinism, dry-vs-forest ayrımı, cold-vs-broadleaf ayrımı, jungle yoğunluğu, mountain geology, coastal transition, material role coverage ve real repository candidate yollarını kontrol eder.

Placement acceptance synthetic terrain ile road/seat/water/slope exclusion'larını, spacing'i, target budget'i, category factories'ini ve digest determinism'ini kontrol eder.

Surface acceptance bütün profile'ların ground/rock/wood/metal tariflerini doğrular; snow/desert/jungle arasında gerçekten farklı yüzey tepkisi olduğunu test eder.

## Sonraki üretim sahipleri

Vegetation producer bu planner'ı kullandığında mevcut north cryosphere kuralını kaybetmemeli; planner yalnız bölgesel asset family/density yönünü eklemelidir.

Natural geology producer, planner'ın geology family önerisini kullanabilir ancak gerçek height/normal/physics değerlerini kendi mevcut terrain authority'sinden almaya devam etmelidir.

Village producer, architecture candidate'larını mevcut `WorldAssetPlacementPipeline` grounding ve material validation zincirinden geçirerek attach etmelidir.

Player regional appearance adapter'ı ile bu katman aynı map SHA'sını kullanır. Böylece oyuncu kıyafet dili ile çevre asset dili birbirinden kopmaz.

## CI

`biome-asset-distribution.yml` exact-main ancestry, changed-line budget, syntax checks ve üç deterministic acceptance script'ini çalıştırır. Son adımda QA snapshot ve digest artifact olarak yayınlanır.

Workflow bu katmanın 3000 satırlık sınırı aşmasını da reddeder. Bu sayede küçük, denetlenebilir ve additive bir vertical slice olarak kalır.
