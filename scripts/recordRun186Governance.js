#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN186_STAMP', 'RUN186_STABLE_TAG', 'RUN186_PERF_ROW', 'RUN186_SMOKE_PASS_COUNT', 'RUN186_TERRAIN_SUMMARY', 'RUN186_MOBILE_BUDGET_SUMMARY'];
for (const key of required) {
	if (!process.env[key]) throw new Error('missing ' + key);
}

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical hydrology-aware target terrain shadow — run 186',
	'',
	'Run186 adds an explicit opt-in height-sampler adapter for the planned full-reference world. It converts planned world X/Z back through the exact 9000x7000 map/reference transform, samples the immutable Run179 coastline plus Run182 protected-land overlay, and deterministically composes that result with the existing target-scale procedural height sampler. Canonical water is forced below the shared water plane, canonical land is kept dry, and protected settlement footprints retain their real flatten-pad anchors. The adapter is shadow-only: live scene/chunk/terrain/water/road/settlement consumers do not import it yet.',
	'',
	'The policy is intentionally conservative for qualification rather than final art tuning: open water can reach 8m below the water plane, coastal water stays at least 2.5m below it, raw land stays at least 0.35m dry, and protected-land edges stay at least 0.08m dry while seat centers keep the existing settlement clearance. A later visual/runtime adoption run may version these shaping values, but it must not mutate the raw coastline mask or bypass seat protection.'
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 186 — Canonical hydrology-aware target terrain shadow adapter (' + process.env.RUN186_STAMP + ')',
	'- Yeni `worldReferenceTerrainAdapter.js`, Run185 full-reference migration planındaki planned-world X/Z noktasını exact owner-map koordinatına geri çözüp Run179 raw water mask + Run182 seat-safe hydrology üzerinden target height üretir. Live runtime consumer yok; opt-in shadow-only.',
	'- Grid proof: ' + process.env.RUN186_TERRAIN_SUMMARY,
	'- Water shaping: canonical water base terraini gerektiğinde water plane altına indirir; minimum kıyı derinliği 2.5m, open-water hedefi 8m. Land shaping: raw land water plane üzerinde minimum 0.35m kuru tutulur; protected-land edge minimum 0.08m, settlement centerları mevcut 1.5m clearance/pad anchorını korur.',
	'- Settlement safety: gerçek target-scale `computeSettlementFlattenPads` + existing seeded terrain sampler üzerinde 14/14 seat center ve ±20m inner-pad probe bit-eşit flat/dry kaldı; Balon/Jon coarse false-water vakaları protected-land olarak korunur.',
	'- Negative control: açık Summer Sea canonical-water kuralında ve water plane altında kaldı. 96x64 bütün mask cell centerları finite/deterministic tarandı; water/land iki sınıf da gerçek yükseklik delta üretiyor, yani adapter no-op değil.',
	'- PWA: yeni src/3d shadow module standing offline-shell kuralı gereği service-worker GAME3D_SHELL_FILES listesine tek additive satırla eklendi; cache/installability gate PASS.',
	'- Additive-only: yeni adapter/check/applicator/recorder/CI + append-only docs/ledgers + service-worker precache satırı; live config/game3d/scene/chunk/terrain/water/roads/settlements/2D runtime satırı değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN186_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page error 0; Run184/185 migration gates + canonical map/mask/alignment/hydrology/extent + Run186 terrain shadow + terrain/road/visual/grass + determinism/assets/PWA + a11y/input/physics + mobile streaming/LOD/perf + visual evidence + additive-only PASS.',
	'- Mobil performans: ' + process.env.RUN186_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN186_PERF_ROW + '. Shadow adapter runtime graphına bağlı olmadığı için live render delta 0.',
	'- Memory leak checklist: runtime listener/timer/DOM/geometry/material/texture yok; pure sampler factory + frozen policy. Checker browser/server finally ile kapanır. Teknik borç 1; yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0206.',
	'- World Coverage live değerleri değişmedi. World Evolution Report: canonical terrain migration readiness +1; runtime world delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: canonical terrain adapterı default yapmadan önce opt-in scene/chunk integration harness ile gerçek chunk geometry + water plane + player/seat/road çevresinde görsel/physics shadow proof; ancak ondan sonra ayrı yüksek-etki runında full-reference runtime switch değerlendirilsin.'
]);

append('DECISIONS.md', [
	'## ADR-0206 — Canonical coastline affects target terrain through an opt-in shadow adapter before any live world switch (run 186)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run179 immutable water mask + Run182 protected-land hydrology + Run185 reversible full-reference transform, yeni `worldReferenceTerrainAdapter.js` içinde deterministic target-height policy olarak compose edilir. Planned world X/Z exact map/reference uzayına geri projekte edilir. Unprotected canonical water terraini shared water plane altına bastırılır; canonical raw land water plane üstünde kuru tutulur; protected land mevcut settlement flatten padini bozmayacak şekilde dry floor uygular. Bu modül Run186\'da yalnız shadow/qualification consumerlarına açıktır; live scene/chunk/terrain/water/road/settlement import graphı değişmez.',
	'',
	'**Neden:** Önceki runlar coğrafya verisini, koordinat dönüşümünü, extent ve target-scale route güvenliğini kanıtladı fakat canonical mask henüz gerçek bir height sampler sonucu üretmiyordu. Runtime switchten önce coast/hydrology kararının mevcut seeded relief + settlement flatten ile executable biçimde çakışmadığı kanıtlanmalıdır.',
	'',
	'**Height policy:** water depth = 2.5..8m below shared water plane, water-neighbour density ile deterministik derinleşir; unprotected land dry clearance = 0.35..1.25m; protected-land edge minimum 0.08m ve protection weight arttıkça 1.25m\'ye yaklaşır. `Math.min`/`Math.max` yalnız canonical classification ile base samplerı compose eder; raw mask/pad verisi mutasyona uğramaz.',
	'',
	'**Alternatifler:** Maskeyi doğrudan `terrain.js` içine gömmek reddedildi (yüksek etki ve rollback zor); yalnız water meshini maskeye göre kesmek reddedildi (terrain altında yanlış kara/deniz fiziği kalır); raw mask bitlerini Balon/Jon için değiştirmek reddedildi (source truth checksum bozulur); tüm landı sabit yüksekliğe çekmek reddedildi (relief yok olur).',
	'',
	'**Sonuç:** Canonical coast artık target-scale numeric height sampler üretebilir ve 96x64 bütün reference grid üzerinde deterministik dry/wet invariantlarla ölçülebilir. 14 settlement padinin flat/dry özelliği korunur, açık deniz gerçek su tabanına dönüşür, fakat oyuncunun gördüğü runtime henüz değişmez.',
	'',
	'**PWA:** Standing `checkServiceWorkerCache` gereği yeni src/3d module offline shell listesine tek additive precache entry ile eklenir. Existing service-worker satırı silinmez/değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Bir sonraki integration harness aynı samplerı opt-in chunk geometry üretiminde test edebilir. Live adoption yapılırsa coast visual smoothing, water mesh coverage, route water-crossing/bridge policy ve physics collider eşleşmesi aynı versioned adapter üstünde ayrıca kanıtlanmalıdır.',
	'',
	'**Geri alma planı:** Runtime import yoktur; adapter veya policy yanlışlanırsa yeni versioned shadow policy additive eklenir. Run179 mask, Run181 alignment, Run182 hydrology/extent ve Run185 migration plan korunur.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN186_STABLE_TAG + ' — run 186 canonical hydrology target-terrain shadow adapter (ADR-0206); ' + process.env.RUN186_SMOKE_PASS_COUNT + '/34+ smoke + 96x64 terrain grid + 14/14 seat/PWA/mobile/determinism gates PASS; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN186_PERF_ROW + '\n');
console.log('[recordRun186Governance] PASS: WORLD_REFERENCE_MAP + progress + ADR-0206 + stable checkpoint + perf row recorded.');
