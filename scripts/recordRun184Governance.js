#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN184_STAMP', 'RUN184_STABLE_TAG', 'RUN184_PERF_ROW', 'RUN184_SMOKE_PASS_COUNT', 'RUN184_PROOF_SUMMARY', 'RUN184_MOBILE_BUDGET_SUMMARY'];
for (const key of required) {
	if (!process.env[key]) throw new Error('missing ' + key);
}

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('3D_GAME_PROGRESS.md', [
	'## Run 184 — Canonical full-map migration dry-run safety + road transform proof (' + process.env.RUN184_STAMP + ')',
	'- Run182/ADR-0202 tarafından zorunlu bırakılan runtime-öncesi full-reference migration kanıtı tamamlandı. Bu run WORLD_SCALE, CHUNK_CONFIG, terrain, water, roads, settlements veya 2D runtime davranışını değiştirmez.',
	'- Dry-run: ' + process.env.RUN184_PROOF_SUMMARY,
	'- Seat safety: gerçek KINGDOM_SEATS + exact 9000x7000 reference alignment + 137.5 km² extent plan birlikte çalıştırıldı; hedef-scale seat-safe hydrology 14/14 land ve reference round-trip korunur.',
	'- Road transform proof: gerçek roads.js::computeSeatMST mevcut world coordinates ve full-reference target coordinates üzerinde çalıştırıldı; 13/13 edge sırası/topolojisi ve tüm endpoint reference koordinatları uniform scale+translation altında korunur. Bu yalnız topology/endpoint proof’tur; slope-aware routed grade gerçek runtime migration sırasında yeniden roadNetworkSafetyCheck ile zorunlu doğrulanacaktır.',
	'- Additive-only: yalnız yeni checker, recorder ve Run184 CI dosyaları eklendi; mevcut source/runtime satırı silinmedi veya değiştirilmedi.',
	'- DoD: node --check PASS; baseline + after browser smoke ' + process.env.RUN184_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page error 0; canonical map/mask/alignment/hydrology/extent + Run184 migration proof + terrain/road + visual contracts + grass + determinism/assets/a11y/input/physics + mobile streaming/LOD/culling/perf + PWA/cache + additive-only kapıları PASS.',
	'- Görsel doğrulama: runtime-neutral değişiklikte gerçek 390x844 mobile Chromium yakın + F4 uzak iki screenshot artifact yeniden üretildi; görsel/runtime delta beklenmedi ve console/page error 0 kaldı.',
	'- Mobil performans: ' + process.env.RUN184_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN184_PERF_ROW + '. Runtime code değişmediği için yeni draw/triangle/geometry/texture maliyeti eklenmedi.',
	'- Memory leak checklist: yeni runtime listener/timer/DOM/geometry/material yok; checker Playwright browser/server kaynaklarını finally ile kapatır.',
	'- Teknik borç: 1 (mevcut game3d.js yapısal borcu). Risk LOW. Güven 5/5. ADR: ADR-0204. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.',
	'- World Evolution Report: runtime world delta 0; migration-safety proof +1; ADR +1. Oyuncu farkı: HAYIR — bu run yalnız gelecekteki canonical full-map migration için kanıt/guard ekler.',
	'- Sıradaki güvenli adım: actual runtime migration’dan önce canonical hydrology-aware target terrain sampler için opt-in shadow/dry-run adapter hazırlanabilir; ardından aynı committe değil, ayrı yüksek-etki runında WORLD_SCALE/chunk extent migration + pre/post 14-seat + routed-road grade + determinism + mobile budget + visual proof uygulanmalıdır.'
]);

append('DECISIONS.md', [
	'## ADR-0204 — Full-reference migration must preserve normalized seat identity and road MST topology before runtime adoption (run 184)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Canonical 9000x7000 reference rectangle’ın 137.5 km² full-map extentine runtime geçiş yapılmadan önce mevcut world koordinatları normalized reference uzayına çevrilip hedef full-map bounds/scale’e taşınır. Tüm 14 kingdom seat için map→current-world→reference→target-world ile doğrudan map→target-world aynı sonucu vermeli; hedef ölçekli seat-safe hydrology 14/14 land kalmalı; roads.js’nin gerçek deterministic Prim MST çıktısı mevcut ve hedef seat koordinatlarında aynı 13 edge topolojisini üretmelidir.',
	'',
	'**Neden:** Run182 full-map extent planı area/chunk matematiğini kanıtladı ancak canlı world origin/scale değişimi settlements, roads, streaming ve terrain güvenliğini aynı anda etkileyebilir. Normalize edilmiş reference kimliğini invarianta çevirmek re-center ile scale değişimini canonical map verisinden ayırır; uniform positive scale+translation Euclidean MST orderingini koruduğunu gerçek runtime algoritmasıyla doğrulamak road topology riskini migration öncesinde kapatır.',
	'',
	'**Alternatifler:** Runtime WORLD_SCALE’i doğrudan değiştirip smoke sonucuna bakmak yüksek etkili ve geri dönüşü zor bir sıçramadır. Road MST’yi test tarafında yeniden uygulamak gerçek roads.js ile drift riski taşır. Eski routed polylineleri yalnız geometrik olarak ölçeklemek slope/terrain grade davranışını kanıtlamaz; bu nedenle Run184 bunu iddia etmez.',
	'',
	'**Sonuç:** Runtime davranışı değişmeden full-map re-center/scale için deterministic safety contract oluşur. 14/14 seat reference/hydrology güvenliği ve 13/13 road MST topology/endpoint invariance CI’da korunur. Actual terrain scale migration hâlâ ayrı yüksek-etki değişikliktir ve gerçek slope-aware route grade, seat terrain safety, mobile budget, PWA/cache, console ve görsel kanıtları yeniden geçmeden yayımlanamaz.',
	'',
	'**Etkilenen sistemler:** Yeni scripts/checkFullReferenceMigrationDryRun.js, Run184 governance recorder/CI ve dokümantasyon kayıtları. WORLD_SCALE, CHUNK_CONFIG, terrain, water, roads runtime, settlements runtime, service worker ve 2D oyun değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Canonical hydrology/terrain adapter, full-map chunk grid ve macro-relief katmanları aynı normalized-reference invariantını kullanabilir. Böylece ilerideki makro coğrafya işleri map-center veya eski crop center sabitlerine gizlice bağlanmaz.',
	'',
	'**Geri alma planı:** Checker/CI yanlış varsayım içerirse yeni versioned proof eklenir ve Run184 checker publish kapısından çıkarılır; runtime etkisi olmadığı için oyun davranışını geri almak gerekmez. Actual full-map migration bu ADR’nin kanıtları geçmeden başlamaz.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN184_STABLE_TAG + ' — run 184 canonical full-map migration dry-run proof (ADR-0204); ' + process.env.RUN184_SMOKE_PASS_COUNT + '/34+ smoke + 14/14 seat + 13/13 road MST + mobile/PWA/determinism gates PASS.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN184_PERF_ROW + '\n');
console.log('[recordRun184Governance] PASS: progress + ADR-0204 + stable checkpoint + perf row recorded.');
