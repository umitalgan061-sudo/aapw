# Buzul Muhafızı — Photorealism Runtime V1

## Amaç

`photorealismEnvironmentPass.ts` artık yalnızca bir teşhis/plânlama katmanı değil. Bu turdaki runtime controller ve batch executor, P0–P5 kararlarını mevcut scene, renderer, fog, light, material, water, vegetation ve placement sahiplerine deterministik biçimde taşır.

Yeni katmanlar hiçbir coğrafya icat etmez, yeni bir terrain/material/placement otoritesi oluşturmaz ve editör DOM kodunu runtime’a taşımaz. `WorldAssetPlacementPipeline.js` ile `MaterialAssignmentCore.js` hâlâ asset hydrate/load → surface analysis → recipe → validation → ground transform → manifest → scene attach sırasının tek sahipleridir.

## Runtime akışı

1. Canonical `EnvironmentSample` alınır.
2. `buildEnvironmentPassPlan()` P0–P5 issue listesini ve bounded policy değerlerini üretir.
3. `createPhotorealismRuntimeController()` planı runtime hedeflerine çevrilecek operasyon listesine dönüştürür.
4. Visible failure varsa controller fail-closed davranır; sahneye mutasyon uygulanmaz.
5. Operation budget aşılırsa liste deterministik biçimde kesilir ve receipt içinde `budgetClamped=true` tutulur.
6. Placement hedefi yalnızca mevcut `placementQuery` sözleşmesini alır; gerçek asset yükleme ve attach ortak pipeline tarafından yapılır.
7. `createPhotorealismBatchExecutor()` yakın örnekleri priority + id sırasıyla işler ve batch sağlık metriklerini üretir.

## P0–P5 davranışı

- **P0:** dikdörtgen su, grid/seam, shoreline step ve water moiré için suppress/blend/normal policies.
- **P1:** ridge breakup, cliff exposure, scree band, micro-relief ve rendered/collider parity toleransı.
- **P2:** macro/micro breakup, triplanar blending, snowline, wet edge ve anti-tiling phase.
- **P3:** canopy/understory/shrub/grass yoğunlukları, clearing yarıçapı, instancing batch ve LOD bias.
- **P4:** shoreline fade, foam width, depth blend, normal scale ve moiré suppression.
- **P5:** fog density, aerial perspective, exposure, sky luminance ve black-sky guard.

## Güvenlik ve sınırlar

Controller `rejectVisibleFailures=true` ile çalıştırıldığında görünür acceptance kusurları sahne mutasyonundan önce reddedilir. Bu, bozuk su tile’ının, seam’li terrain yüzeyinin veya parity dışı placement’ın production scene’e uygulanmasını önler.

Controller yalnızca runtime hedeflerine operation gönderir; hedefler dışarıdan sağlanır. Böylece mevcut `createScene()` lifecycle’ı, shared material/placement contract ve diğer ekiplerin player/NPC/RPG authoritiesi korunur.

## Telemetri / kanıt

Her uygulama immutable receipt üretir:

- deterministic controller key;
- plan key;
- accepted/rejected state;
- rejection reason;
- applied operations;
- issue codes;
- operation count;
- budget clamp evidence.

Batch sonucu ayrıca processed/accepted/rejected, max parity error, visible failure count ve budget clamp count alanlarını taşır. Bu receipt’ler gerçek shipped runtime evidence üretiminde camera/seed/coordinate ile eşleştirilebilir.

## Acceptance notu

Bu katman tek başına full-world görsel borcun bittiğini iddia etmez. Asıl DoD hâlâ gerçek `createScene()` üzerinden alınan 1536×1024 orthographic full-world, far ve terrain-level near kanıtları; P0–P5 visible issue sayımlarının sıfıra yaklaşması; shared material/placement provenance; Terrain3D/HTerrain, browser/PWA/mobile/perf ve freshness kapılarının exact head üzerinde yeşil olmasıdır.
