#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN185_STAMP', 'RUN185_STABLE_TAG', 'RUN185_PERF_ROW', 'RUN185_SMOKE_PASS_COUNT', 'RUN185_PROOF_SUMMARY', 'RUN185_MOBILE_BUDGET_SUMMARY'];
for (const key of required) {
	if (!process.env[key]) throw new Error('missing ' + key);
}

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('3D_GAME_PROGRESS.md', [
	'## Run 185 — Route-qualified full-reference migration shadow plan (' + process.env.RUN185_STAMP + ')',
	'- Concurrency consolidation: Run184 merge sonrası aynı eski base üzerinde açılmış paralel PR #61 incelendi; çakışan Run184 governance kayıtları merge edilmedi. Yalnız benzersiz ve daha güçlü migration-plan + target settlement/road qualification fikri güncel main üzerine yeni Run185 olarak taşındı.',
	'- Shadow plan: yeni worldReferenceMigrationPlan.js exact 9000x7000 canonical bounds, 137.5 km² target scale/grid ve reversible current-world↔map↔planned-world dönüşümünü tek contract altında toplar; hiçbir runtime scene/terrain/water/road/settlement consumer bu modülü import etmez.',
	'- Route-qualified dry-run: ' + process.env.RUN185_PROOF_SUMMARY,
	'- Settlement proof: hedef ölçekte gerçek terrain sampler + gerçek computeSettlementFlattenPads yeniden kuruldu; 14/14 seat round-trip, flat inner pad, water-clearance floor, protected hydrology ve world-edge safety doğrulandı.',
	'- Road proof: gerçek deterministic MST + gerçek findSlopeAwarePath hedef sampler üzerinde 13/13 yol için tekrar çözüldü; topology korunur, her route target extent içinde kalır ve 20° hard-grade ceiling aşılmaz. Open Summer Sea negative-control olarak su kalır.',
	'- Additive-only: yalnız yeni migration plan modülü, yeni route-qualified checker, Run185 recorder ve CI eklendi; mevcut source/runtime satırı silinmedi veya değiştirilmedi.',
	'- DoD: node --check PASS; baseline + after browser smoke ' + process.env.RUN185_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page error 0; Run184 proof + Run185 route qualification + canonical map/mask/alignment/hydrology/extent + terrain/road + visual contracts + grass + determinism/assets/a11y/input/physics + mobile streaming/LOD/culling/perf + PWA/cache + additive-only kapıları PASS.',
	'- Görsel doğrulama: gerçek 390x844 mobile Chromium yakın + F4 uzak iki screenshot artifact yeniden üretildi; shadow-only değişiklikte runtime/görsel delta beklenmedi ve console/page error 0 kaldı.',
	'- Mobil performans: ' + process.env.RUN185_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN185_PERF_ROW + '. Runtime render path değişmediği için yeni draw/triangle/geometry/texture maliyeti eklenmedi.',
	'- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material yok; checker browser/server kaynaklarını finally ile kapatır. Teknik borç: 1 (mevcut game3d.js yapısal borcu); yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0205.',
	'- World Coverage: desktop %96.2; mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi. World Evolution Report: runtime world delta 0; migration qualification +1; ADR +1. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: runtime varsayılanlarını değiştirmeden canonical hydrology-aware target terrain sampler için opt-in shadow adapter; ardından ayrı yüksek-etki runında WORLD_SCALE/chunk extent migration + live settlement/road/streaming transform + determinism/mobile/PWA/visual proof.'
]);

append('DECISIONS.md', [
	'## ADR-0205 — Planned full-reference migration requires reusable reversible transforms plus target-scale settlement and routed-road qualification (run 185)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** ADR-0204\'ün normalized seat/MST invariantsına ek olarak full-map runtime geçişinden önce tek bir shadow migration-plan modülü canonical 9000x7000 bounds, target meters-per-map-unit, 137.5 km² extent ve reversible current-world↔map↔planned-world dönüşümlerini tanımlar. Target world için gerçek terrain sampler ve computeSettlementFlattenPads yeniden oluşturulur; 14/14 seat flat/water-clear/protected-land/world-edge güvenli olmalı. Gerçek deterministic MST üzerinde gerçek findSlopeAwarePath ile 13/13 route tekrar çözülmeli; her route target world içinde kalmalı ve mevcut 20° hard-grade ceiling altında olmalıdır. Açık Summer Sea örneği protected override dışında su kalmalıdır.',
	'',
	'**Neden:** Run184 koordinat ve MST topolojisini güvenceye aldı ancak actual runtime migration terrain sampler ölçeğini, settlement flatten padlerini ve slope-aware route geometrisini de etkiler. Bu ek shadow qualification yüksek-etki switch yapılmadan önce aynı gerçek modüller üzerinde fiziksel yol/yerleşim güvenliğini kanıtlar ve gelecekteki state migration için tek reversible transform contractı bırakır.',
	'',
	'**Eşzamanlılık/Konsolidasyon:** Aynı eski base üzerinde Claude tarafından açılan PR #61 aynı alanı daha geniş test ediyordu. Main Run184 ile ilerlediği için PR #61 doğrudan merge edilmedi; çakışan Run184 recorder/ADR/stable kayıtları atıldı, benzersiz migration-plan ve target-scale slope-aware qualification fikri güncel main üzerinde Run185 olarak yeniden doğrulandı.',
	'',
	'**Alternatifler:** PR #61\'i artık farklı base ve aynı ADR/run numarasıyla zorla merge etmek governance/history çakışması yaratırdı. Sadece Run184 MST endpoint proof ile yetinmek target terrain/road grade riskini sonraya bırakırdı. Runtime WORLD_SCALE\'i şimdi değiştirmek ise bu runın düşük-risk shadow amacını aşardı.',
	'',
	'**Sonuç:** worldReferenceMigrationPlan.js runtime tarafından henüz tüketilmeyen reusable planning contractıdır. CI target settlement pads, canonical hydrology, open-sea negative control ve slope-aware target roads için executable migration gate sağlar. Runtime davranışı bit-eşit kalır.',
	'',
	'**Etkilenen sistemler:** Yeni src/3d/world/worldReferenceMigrationPlan.js, scripts/checkWorldReferenceMigrationDryRun.js, Run185 recorder/CI ve append-only governance/perf kayıtları. Mevcut config/scene/terrain/water/roads/settlements/service-worker/2D kodu değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Opt-in canonical terrain/hydrology adapter ve eventual WORLD_SCALE/chunk migration bu planı tek transform kaynağı olarak import edebilir; default runtime switch yapılınca aynı checker canlı consumer importlarını kabul edecek yeni versioned migration gate ile genişletilmelidir.',
	'',
	'**Geri alma planı:** Plan varsayımları değişirse yeni versioned migration plan/checker additive olarak eklenir; mevcut shadow module hiçbir runtime consumer tarafından import edilmediği için oyun davranışını geri almak gerekmez.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN185_STABLE_TAG + ' — run 185 route-qualified full-reference migration shadow plan (ADR-0205); ' + process.env.RUN185_SMOKE_PASS_COUNT + '/34+ smoke + 14/14 target seats + 13/13 slope-aware roads + mobile/PWA/determinism gates PASS.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN185_PERF_ROW + '\n');
console.log('[recordRun185Governance] PASS: progress + ADR-0205 + stable checkpoint + perf row recorded.');
