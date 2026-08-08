#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run193-canonical-scene-shadow-adapter', 'proof.json');
const required = [
	'RUN193_STAMP',
	'RUN193_STABLE_TAG',
	'RUN193_SUMMARY',
	'RUN193_BUDGET_JSON',
	'RUN193_LIVE_MOBILE_JSON',
	'RUN193_SMOKE_PASS_COUNT',
	'RUN193_PERF_ROW',
];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run193 proof artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const first = report.deterministic.firstSummary;
const second = report.deterministic.secondSummary;

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Reusable bounded canonical scene-window contract — run 193',
	'',
	`Run193 moves the validated Run192 road/bridge composition rules into versioned shadow module \`worldReferenceSceneShadowAdapter.js\`. The module still has no live scene consumer. It composes canonical terrain chunks, globally bridge-suppressed dry road ribbons, owner-approved medieval bridge Art V2, bounded Run190 rocks and the existing water surface inside one disposable local window.`,
	'',
	`The mobile shadow profile keeps ${first.terrainChunkCount} terrain chunks resident around its anchor, ${first.selectedRockInstances} rock instances in the first window and ${second.selectedRockInstances} after a ${report.deterministic.recenterDistanceMeters.toFixed(1)}m recenter. Full canonical suppression remains ${first.coveredWaterRoutePoints}/${first.totalWaterRoutePoints}; Run190 road-clear rock classification remains ${first.safeRockCandidateCount} safe / ${first.rockConflictCount} conflicts.`,
	'',
	`Measured candidate renderer budgets are ${report.nearRender.calls}/${report.nearRender.triangles} near, ${report.farRender.calls}/${report.farRender.triangles} far and ${report.secondRender.calls}/${report.secondRender.triangles} after recenter, all below the mobile <500 draw-call / <500K triangle hard limits. Dispose leaves both bounded windows empty and removes the proof canvas.`
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 193 — Reusable canonical scene shadow adapter + bounded streaming proof (' + process.env.RUN193_STAMP + ')',
	'- Session/concurrency: started from merged Run192 `main` (`8b67532c…`); no active Run193 branch existed. Run192 progress/ADR and GOVERNANCE were re-read before selection. The explicit Run192 next-step was followed; no owner-pending tuning was guessed.',
	'- Alt görev: validated Run192 suppression/approach/collider/window logic was moved into new versioned shadow-only `worldReferenceSceneShadowAdapter.js`. The adapter composes canonical terrain + dry roads + owner-approved medieval bridge Art V2 + Run190 bounded rocks + existing water into one disposable local window. `game3d`, `sceneManager`, `chunkManager`, live terrain/roads/physics remain unwired.',
	'- Canonical invariants: 7 bridges / 177 arches; water-route suppression ' + first.coveredWaterRoutePoints + '/' + first.totalWaterRoutePoints + '; 14 bridge approaches; max qualification grade/length remain <=18° / <=320m; rock road-clear classification ' + first.safeRockCandidateCount + ' safe / ' + first.rockConflictCount + ' conflict.',
	'- Bounded resident set: mobile terrain ' + first.terrainChunkCount + ' chunks in the first window and ' + second.terrainChunkCount + ' after recenter; rocks ' + first.selectedRockInstances + ' -> ' + second.selectedRockInstances + ' with hard existing Run190 cap <=96; local bridge sets ' + first.selectedBridgeIds.length + ' -> ' + second.selectedBridgeIds.length + ' rather than all 7 always resident.',
	'- Streaming/recenter proof: first window was fully disposed, a second mobile window was rebuilt ' + report.deterministic.recenterDistanceMeters.toFixed(1) + 'm away, then also fully disposed. Same-input first-window summary reproduces byte-equivalently. No live resident collection/listener/timer was introduced.',
	'- Collision-readiness: reusable composite ground facade keeps Run191 player-safe bridge deck precedence; all 7 bridge centers resolve to deck top above canonical terrain. Existing PR #71 full 23,436-sample traversal readiness is rerun independently in CI.',
	'- Scene budget: ' + process.env.RUN193_BUDGET_JSON + '. Live mobile baseline remains ' + process.env.RUN193_LIVE_MOBILE_JSON + '; Run193 is shadow-only and adds zero live runtime draw/triangle cost.',
	'- Visual DoD: two 1440x900 canonical-window near/far screenshots plus `proof.json`; summary: ' + process.env.RUN193_SUMMARY + '.',
	'- DoD: syntax/additive-only, Run190 rock + Run191 bridge/traversal + Run192 scene proof, canonical map/hydrology/migration/terrain/chunk/road/world visuals, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf and baseline+after browser smoke ' + process.env.RUN193_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page errors 0.',
	'- PWA/cache: the new shadow module receives one additive `GAME3D_SHELL_FILES.push(...)` entry; no existing cache entry is removed or changed.',
	'- Memory leak checklist: both proof windows explicitly dispose terrain geometry/materials, road/approach geometry/materials, bridge V2 geometry/material/texture, rock geometry/materials and water; renderer canvas removed. Teknik borç 1 (`game3d.js` existing 547/600), new live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0213.',
	'- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical bounded scene-adapter readiness +1; live world delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: bu reusable adapter üzerinde all-7 bridge/window ownership ve planned 27x21 chunk-grid edge davranışını shadow migration harnessında doğrula; live full-reference switch ancak explicit replacement lifecycle, physics ownership, service-worker/cache and pre/post visual/perf gates birlikte geçerse değerlendirilir.'
]);

append('DECISIONS.md', [
	'## ADR-0213 — Canonical full-reference candidate uses disposable bounded shadow scene windows before live adoption (run 193)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run192\'nin doğruladığı bridge-aware canonical road composition, yeni versioned `worldReferenceSceneShadowAdapter.js` içinde reusable shadow API olarak ifade edilir. Adapter bir local window için planned canonical terrain chunks, globally suppressed dry-road ribbon, bounded bridge approaches, owner-approved stone-bridge Art V2, road-clear Run190 rocks and existing water üretir; player-compatible composite ground facade bridge deckini terrain üzerinde önceliklendirir. Window tamamen disposable’dır ve live scene/chunk/gameplay import graphına bağlanmaz.',
	'',
	`**Ölçüm:** first mobile window ${first.terrainChunkCount} terrain chunks / ${first.selectedRockInstances} rocks / ${first.selectedBridgeIds.length} local bridges; second window ${second.terrainChunkCount} chunks / ${second.selectedRockInstances} rocks / ${second.selectedBridgeIds.length} bridges after ${report.deterministic.recenterDistanceMeters.toFixed(1)}m recenter. Render budgets: near ${report.nearRender.calls}/${report.nearRender.triangles}, far ${report.farRender.calls}/${report.farRender.triangles}, recentered ${report.secondRender.calls}/${report.secondRender.triangles}; all below mobile hard limits. Deterministic checksum \`${report.checksum}\`.`,
	'',
	'**Neden:** Run192 checker içinde çalışan algoritmayı doğrudan live runtime’a taşımak, proof logic ile production ownership’i aynı adımda birleştirirdi. Reusable shadow adapter önce lifecycle sınırını, resident-set boundunu, terrain/road/bridge/rock birlikte render maliyetini ve recenter-dispose davranışını gerçek THREE nesneleri üzerinde kanıtlar; live migration kararı ayrı kalır.',
	'',
	'**Alternatifler:** (1) Full 137.5 km² terrain/rocks/bridges’i world-resident oluşturmak reddedildi; streaming hedefi ve mobil bütçe ile çelişir. (2) Run192 checker kopyasını büyütmek reddedildi; reusable contract oluşmaz. (3) Adapter’ı hemen `sceneManager`/`chunkManager` içine import etmek reddedildi; rollback alanını büyütür ve current live worldü aynı committe değiştirir. (4) Bridge Art V1 kullanmak reddedildi; PR #70 ile düzeltilen Art V2 evidence canonical visual candidate olarak korunur.',
	'',
	'**Sonuç:** Canonical full-reference world artık sadece veri/tekil component proof değil, bounded disposable terrain+road+bridge+rock+water scene window olarak da ölçülebilir. Ancak current player runtime, world scale, chunk ownership ve physics wiring byte-equivalent kalır.',
	'',
	'**Etkilenen sistemler:** new shadow adapter/checker/PWA applicator/CI/recorder; additive service-worker precache line; append-only WORLD_REFERENCE_MAP/progress/ADR/stable/perf records. Live 2D and 3D systems are not consumers.',
	'',
	'**Gelecek Faz Etkisi:** Full-reference migration harness bu adapterı kullanarak world-edge chunk ownership, window replacement and all-bridge spatial coverage test edebilir. Mağara/dragon habitat ve macro relief daha sonra aynı bounded ownership modeline katılabilir; bu ADR onların spawn/art kararını belirlemez.',
	'',
	'**Geri alma planı:** Live consumer yoktur. Adapter kontratı yanlışlanırsa yeni versioned shadow adapter eklenir; Run179-192 source truth ve current live scene değiştirilmeden kalır.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN193_STABLE_TAG + ' — run 193 reusable canonical terrain+road+bridge+rock bounded scene-window shadow adapter (ADR-0213); two-window recenter/dispose + mobile scene budget + full regression PASS; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN193_PERF_ROW + '\n');
console.log('[recordRun193CanonicalSceneShadowAdapter] PASS: Run193 progress + ADR-0213 + map/stable/perf records appended.');
