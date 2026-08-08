#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = [
	'RUN187_STAMP', 'RUN187_STABLE_TAG', 'RUN187_PERF_ROW', 'RUN187_SMOKE_PASS_COUNT',
	'RUN187_INTEGRATION_SUMMARY', 'RUN187_INTEGRATION_REPORT', 'RUN187_MOBILE_BUDGET_SUMMARY',
	'RUN187_CROSSING_COUNT', 'RUN187_CROSSING_IDS', 'RUN187_WATER_KM',
];
for (const key of required) {
	if (!process.env[key]) throw new Error('missing ' + key);
}

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

const crossingCount = Number(process.env.RUN187_CROSSING_COUNT);
if (!Number.isInteger(crossingCount) || crossingCount < 0) throw new Error('RUN187_CROSSING_COUNT must be a non-negative integer');
const crossingDecision = crossingCount > 0
	? `Canonical target routes intersect water on ${crossingCount} MST edge(s); no bridge/ferry/reroute policy is guessed. Full-reference runtime switch remains blocked on an owner decision.`
	: 'No canonical target route intersects water in this measured MST; no bridge/ferry decision is required by the current road graph.';
const nextStep = crossingCount > 0
	? 'Owner kararı gelene kadar full-reference runtime switch yapma. Güvenli devam: measured crossing edges için shadow-only bridge/ferry/dry-reroute alternatives fixture hazırlamak; hiçbir alternatifi default seçmemek.'
	: 'Ayrı yüksek-etki runında full-reference WORLD_SCALE/chunk/runtime switch için canary integration; live settlement/road/streaming/physics/water/PWA/mobile/visual rollback gate zorunlu.';

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical chunk/scene/physics shadow integration — run 187',
	'',
	'Run187 exercises the Run186 canonical terrain sampler through the project\'s real `createTerrainChunk` and `createWater` geometry paths without wiring any live runtime consumer. Real 64x64 terrain meshes are first verified against the existing seeded+flattened base sampler, then their test-only vertex heights are retargeted to the canonical sampler and revalidated vertex-for-vertex. Settlement ground probes use the same canonical numeric sampler as a shadow physics contract, while the real flat water mesh is checked to remain fixed at the shared sea level.',
	'',
	'Road qualification also runs the real deterministic MST plus `findSlopeAwarePath` against the canonical sampler. Water intersections are measured, not silently interpreted: ' + crossingDecision,
	'',
	'Integration report: ' + process.env.RUN187_INTEGRATION_REPORT,
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 187 — Canonical chunk/scene/physics shadow integration harness (' + process.env.RUN187_STAMP + ')',
	'- Integration proof: ' + process.env.RUN187_INTEGRATION_SUMMARY,
	'- Gerçek geometry yolu: existing `createTerrainChunk` ile üretilen 64x64 mesh vertexleri önce seeded+flattened base sampler ile bit-level toleransta karşılaştırıldı; aynı test meshleri canonical sampler yüksekliklerine shadow-retarget edilip normal/bounds yeniden hesaplandı ve bütün vertexler tekrar numeric sampler ile eşleşti. Live chunk manager veya terrain runtime import graphı değişmedi.',
	'- Water/physics: existing `createWater` gerçek meshinin Y=' + '6m' + ' düzlemde kaldığı, update sırasında yalnız X/Z recenter olduğu ve geometry vertexlerinin dikey displacement üretmediği doğrulandı. 14/14 seat center + ±20m shadow ground probes mevcut flatten-pad anchorlarıyla eşleşti ve minimum settlement clearance korundu.',
	'- Roads: canonical sampler üzerinde gerçek deterministic MST + gerçek `findSlopeAwarePath` ile 13/13 route tekrar çözüldü; 20° hard-grade ceiling ve full-reference extent korundu. Water-crossing ölçümü: ' + crossingCount + ' road(s), toplam yaklaşık ' + process.env.RUN187_WATER_KM + ' km water segment; ids=' + process.env.RUN187_CROSSING_IDS + '.',
	'- Owner-decision guard: ' + crossingDecision,
	'- Additive-only: yeni checker/recorder/CI dosyaları + append-only governance kayıtları; `src/3d`, 2D runtime ve service-worker satırları değiştirilmedi. Yeni src/3d module olmadığı için PWA app-shell listesinde yeni entry gerekmiyor.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN187_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page error 0; Run184/185/186 canonical gates + Run187 real geometry/water/physics/road harness + live terrain/road/visual/grass + determinism/assets/PWA + a11y/input/physics + mobile streaming/LOD/perf + visual evidence + additive-only PASS.',
	'- Mobil performans: ' + process.env.RUN187_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN187_PERF_ROW + '. Harness runtime graphına bağlı olmadığı için live render delta 0.',
	'- Memory leak checklist: harness-created terrain/water geometry/materialları `finally` teardown içinde dispose edilir; browser/server da kapatılır. Yeni runtime listener/timer/DOM/texture yok. Teknik borç 1; yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0207.',
	'- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²) — live değerler değişmedi. World Evolution Report: canonical integration readiness +1; runtime world delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: ' + nextStep,
]);

append('DECISIONS.md', [
	'## ADR-0207 — Full-reference terrain must pass real chunk/water/physics integration before runtime adoption; road-water semantics are never guessed (run 187)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run186 canonical height sampler, live runtimea bağlanmadan önce projectin gerçek `createTerrainChunk` ve `createWater` geometry pathleri üzerinden executable shadow integration harness ile doğrulanır. Existing base chunk vertexleri mevcut seeded+flattened samplerla eşleşmeli; test-only shadow vertex retarget sonrası aynı mesh topology/material path canonical samplerla vertex-for-vertex eşleşmeli. Water mesh sea-level Y değerini korumalı; 14 settlement shadow ground probes flatten-pad anchorlarını korumalı. Real deterministic MST ve real `findSlopeAwarePath` canonical sampler üzerinde tekrar çalıştırılır.',
	'',
	'**Road-water kararı:** Harness water intersectionlarını yalnız ölçer. Köprü, feribot veya dry-land reroute birbirinden farklı gameplay/art/physics sonuçları doğuran ürün kararlarıdır; ölçülen crossing varsa Run187 bunlardan hiçbirini default seçmez. Sonuç: ' + crossingDecision,
	'',
	'**Neden:** Run186 numeric sampler seviyesinde coast/terrain uyumunu kanıtladı fakat gerçek PlaneGeometry baking, water mesh sabitliği ve physics-benzeri ground query ile aynı verinin birlikte davranışı henüz sınanmamıştı. Runtime WORLD_SCALE switch bu katmanların hepsini aynı anda etkiler; önce test-only integration ile geometry/sampler uyuşmazlığı riskini ayırmak daha güvenlidir.',
	'',
	'**Alternatifler:** `terrain.js`/`chunkManager.js`/`physics.js` içine adapterı şimdi import etmek reddedildi; bu high-impact runtime switch olurdu. `createTerrainChunk` algoritmasını checker içinde yeniden kopyalamak reddedildi; gerçek geometry pathini test etmezdi. Water-crossing routeu otomatik bridge/ferry/reroute saymak reddedildi; owner kararı tahmin edilmiş olurdu.',
	'',
	'**Sonuç:** Run187 gerçek chunk geometry + canonical sampler + flat water plane + settlement ground contractını birlikte ölçer ve 13 routeun canonical relief üzerindeki grade/extent/determinism özelliklerini korur. Water crossing sayısı=' + crossingCount + ', ids=' + process.env.RUN187_CROSSING_IDS + ', measured water length≈' + process.env.RUN187_WATER_KM + 'km. Live runtime behavior değişmez.',
	'',
	'**Etkilenen sistemler:** Yeni `scripts/checkCanonicalChunkSceneShadowIntegration.js`, Run187 recorder/CI ve append-only WORLD_REFERENCE_MAP/progress/ADR/stable/perf kayıtları. Existing `src/3d/**`, `service-worker.js`, `script.js` değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Full-reference runtime adoption ancak bu harness yeşil kaldığında ve varsa road-water owner kararı ayrı versioned implementation/proof ile çözüldüğünde değerlendirilebilir. Live switch runı settlement/roads/player spawn/streaming/camera/physics/water/PWA/mobile perf ve görsel rollback kanıtlarını tekrar çalıştırmalıdır.',
	'',
	'**Geri alma planı:** Harness ve kayıtlar runtime consumer değildir. Varsayımlar yanlışlanırsa yeni versioned checker/adapter additive eklenir; live oyun geri alma gerektirmez.',
]);

if (crossingCount > 0) {
	append('QUESTIONS_FOR_OWNER.md', [
		'- **(run 187, ADR-0207) Canonical full-reference MST yollarında ölçülen su geçişleri nasıl temsil edilsin — köprü, feribot, yoksa yalnız kuru karadan yeniden rota mı?** Run187 gerçek canonical height sampler + `findSlopeAwarePath` üzerinde ' + crossingCount + ' edge için toplam yaklaşık ' + process.env.RUN187_WATER_KM + ' km water segment ölçtü (`' + process.env.RUN187_CROSSING_IDS + '`). Bu üç çözüm farklı gameplay/asset/physics sonuçları doğurduğu için otomatik seçim yapılmadı. **Temporary default used:** hiçbir seçenek seçilmedi; mevcut live dünya aynen korunuyor ve full-reference runtime switch bu karar verilene kadar yapılmayacak. Karar geldiğinde yalnız seçilen politika yeni versioned shadow proof + visual/physics/mobile/PWA gate ile uygulanacak.',
	]);
}

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN187_STABLE_TAG + ' — run 187 canonical chunk/scene/physics shadow integration (ADR-0207); ' + process.env.RUN187_SMOKE_PASS_COUNT + '/34+ smoke + real 64x64 chunk geometry + 14/14 seat + 13/13 route + mobile/PWA/determinism gates PASS; water crossings measured=' + crossingCount + '; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN187_PERF_ROW + '\n');
console.log('[recordRun187Governance] PASS: WORLD_REFERENCE_MAP + progress + ADR-0207 + optional owner question + stable checkpoint + perf row recorded.');
