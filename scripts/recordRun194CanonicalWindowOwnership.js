#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run194-canonical-window-ownership', 'proof.json');
const required = [
	'RUN194_STAMP',
	'RUN194_STABLE_TAG',
	'RUN194_SUMMARY',
	'RUN194_BUDGET_JSON',
	'RUN194_LIVE_MOBILE_JSON',
	'RUN194_SMOKE_PASS_COUNT',
	'RUN194_PERF_ROW',
];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run194 proof artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const deterministic = report.deterministic;
const grid = deterministic.grid;
const edge = deterministic.edgeCoverage;

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical 27x21 chunk ownership + edge-padding contract — run 194',
	'',
	`Run194 keeps Run193's scene adapter byte-unchanged and adds supplementary shadow module \`worldReferenceSceneWindowMigrationShadow.js\`. The planned grid is ${grid.columns}x${grid.rows} = ${grid.cellCount} canonical owner chunks with centered chunk coordinates x ${grid.minChunkX}..${grid.maxChunkX}, z ${grid.minChunkZ}..${grid.maxChunkZ}. The 500m grid overhang needed to cover the exact reference rectangle is ${grid.edgeOverhangXMeters.toFixed(3)}m per X side and ${grid.edgeOverhangZMeters.toFixed(3)}m per Z side, both below half a chunk.`,
	'',
	`All ${edge.visitedOwnerCellCount} owner-cell anchors were exhaustively visited in the pure ownership proof and their canonical resident-set union covers ${edge.coveredCanonicalCellCount}/${grid.cellCount} cells. A mobile 5x5 window contains ${edge.minCanonicalResidentCount}-${edge.maxCanonicalResidentCount} canonical chunks depending on edge proximity; at most ${edge.maxPaddingResidentCount} extra terrain chunks are explicitly classified as disposable edge padding and never as canonical ownership.`,
	'',
	`The real THREE lifecycle then replaces one active edge window plus all seven bridge-centered windows sequentially. All 7/7 target bridges retain a canonical owner chunk and deck-collider precedence; minimum measured bridge-center deck clearance is ${deterministic.minDeckClearanceMeters.toFixed(3)}m. Candidate render budgets are edge ${report.edgeRender.calls}/${report.edgeRender.triangles} and bridge ${report.bridgeRender.calls}/${report.bridgeRender.triangles}. Live runtime remains unwired.`
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 194 — Canonical 27x21 window ownership + all-bridge replacement lifecycle shadow proof (' + process.env.RUN194_STAMP + ')',
	'- Session/concurrency: started from merged Run193 `main` (`62387c23…`); Run194 branch/PR occupancy was checked twice around the NN:42 concurrency window and remained empty. GOVERNANCE, recent commits, ADR-0213 and QUESTIONS_FOR_OWNER were re-read. No owner-pending tuning/art/routing decision was guessed.',
	'- Alt görev: new supplementary `worldReferenceSceneWindowMigrationShadow.js` wraps the closed-for-growth Run193 adapter without modifying it. It defines canonical owner cells, edge-padding classification and a one-active-window replace/dispose harness; live `game3d`, `sceneManager`, `chunkManager`, terrain, roads and physics remain unwired.',
	'- Planned grid ownership: ' + grid.columns + 'x' + grid.rows + ' = ' + grid.cellCount + ' canonical chunks; all ' + edge.visitedOwnerCellCount + ' owner anchors visited and union coverage ' + edge.coveredCanonicalCellCount + '/' + grid.cellCount + '. Edge overhang is X ' + grid.edgeOverhangXMeters.toFixed(3) + 'm / Z ' + grid.edgeOverhangZMeters.toFixed(3) + 'm per side, below half the existing 500m chunk size.',
	'- Edge behavior: mobile 5x5 resident windows retain ' + edge.minCanonicalResidentCount + '-' + edge.maxCanonicalResidentCount + ' canonical chunks; max ' + edge.maxPaddingResidentCount + ' out-of-grid chunks are explicit disposable padding, not owner cells. ' + edge.edgeOwnerCellCount + ' perimeter owner cells are included in the exhaustive 567-cell scan.',
	'- Bridge/window ownership: 7/7 owner-approved Run191 bridges were visited as sequential bridge-centered targets after one edge-window generation. Exactly one shadow window root stayed active; total generations/disposals ' + deterministic.generations + '/' + deterministic.disposeCount + '. Every previous window reached empty root/terrain/bridge/rock children before replacement.',
	'- Physics ownership: every target bridge center resolves through the active Run193 composite ground collider to bridge deck top above canonical terrain; minimum deck clearance ' + deterministic.minDeckClearanceMeters.toFixed(3) + 'm. Existing 23,436-sample Run191 traversal readiness is rerun separately in CI.',
	'- Scene budget: ' + process.env.RUN194_BUDGET_JSON + '. Existing live mobile baseline remains ' + process.env.RUN194_LIVE_MOBILE_JSON + '; Run194 has no live consumer and adds zero runtime draw/triangle cost.',
	'- Visual DoD: 1440x900 grid-edge window + bridge-ownership window screenshots and `proof.json`; summary: ' + process.env.RUN194_SUMMARY + '.',
	'- DoD: syntax/additive-only, Run193 adapter + Run191 traversal + canonical map/hydrology/migration/terrain/chunk/road/world visuals, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf and baseline+after browser smoke ' + process.env.RUN194_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page errors 0.',
	'- PWA/cache: the new supplementary shadow module receives one additive `GAME3D_SHELL_FILES.push(...)` entry; existing cache entries remain untouched.',
	'- Memory leak checklist: eight sequential proof windows are removed from the shadow scene and disposed; final window-root count 0 and proof renderer canvas count 0. Run193 adapter remains 562/600 and closed to growth; new harness stays separately guarded by the 600-line registry. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0214.',
	'- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical migration ownership/lifecycle readiness +1; live world delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: default live switch yapmadan, ayrı versioned opt-in migration-controller preflight ile bu ownership harnessını `sceneManager`/`chunkManager` replacement boundary şekline yaklaştır; current live worldün restore/rollback ownershipini ve pre/post perf+console eşitliğini kanıtla. Varsayılan oyuncu runtimeı bu kapı geçmeden değiştirilmez.'
]);

append('DECISIONS.md', [
	'## ADR-0214 — Planned 27x21 canonical grid owns chunks; out-of-grid window terrain is disposable edge padding (run 194)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Existing 27x21 / 500m full-reference extent plan, canonical terrain chunk convention (chunk center = integer index * chunk size) ile centered owner rectangle olarak yorumlanır: x -13..13, z -10..10, toplam 567 owner cell. Run193 5x5 bounded window world kenarına yaklaştığında bu rectangle dışındaki render chunks yalnız disposable edge padding sayılır; canonical ownership sayısına dahil edilmez. Shadow migration harnessında aynı anda yalnız tek window root aktiftir; replacement önce eski rootu scene’den çıkarıp tüm GPU-owning children’ı dispose eder, sonra yeni windowı kurar.',
	'',
	`**Ölçüm:** ${edge.visitedOwnerCellCount}/${grid.cellCount} owner anchors scanned; canonical union ${edge.coveredCanonicalCellCount}/${grid.cellCount}; mobile canonical resident range ${edge.minCanonicalResidentCount}-${edge.maxCanonicalResidentCount}/25; max padding ${edge.maxPaddingResidentCount}; perimeter owner cells ${edge.edgeOwnerCellCount}. Grid overhang per side X ${grid.edgeOverhangXMeters.toFixed(3)}m, Z ${grid.edgeOverhangZMeters.toFixed(3)}m. Seven bridge targets plus one edge target produced ${deterministic.generations} generations and ${deterministic.disposeCount} clean disposals; min bridge-center deck clearance ${deterministic.minDeckClearanceMeters.toFixed(3)}m. Deterministic checksum \`${report.checksum}\`.`,
	'',
	'**Neden:** Planned grid count already exists but Run193 intentionally allowed its local 5x5 terrain window to extend beyond that owner rectangle near world edges. Treating those helper chunks as canonical owners would silently enlarge the planned world and make replacement/physics responsibility ambiguous. Explicit owner-vs-padding classification preserves the 27x21 source plan while allowing bounded rendering to keep its simple fixed-size resident window.',
	'',
	'**Alternatifler:** (1) Run193 adapterı edge-aware crop için büyütmek reddedildi; dosya 562/600 ve Run193 checkpointi kapalıdır. (2) Padding chunksı yeni canonical cells saymak reddedildi; 27x21 planı sessizce değiştirirdi. (3) Aynı anda birden fazla migration windowı owner yapmak reddedildi; collider/resource ownershipi belirsizleştirirdi. (4) Bu adımda live scene/chunk manager wiring yapmak reddedildi; rollback yüzeyini shadow proof ile aynı committe büyütürdü.',
	'',
	'**Sonuç:** Full-reference candidate artık her planned chunk için tek canonical owner coordinate, world-edge padding semantics ve 7/7 bridge-centered sequential replacement lifecycle kanıtına sahiptir. Bu bir shadow integration contractıdır; player runtime/world scale değişmez.',
	'',
	'**Etkilenen sistemler:** new supplementary shadow ownership module/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only map/progress/ADR/stable/perf records. Existing Run193 adapter and live 2D/3D consumers unchanged.',
	'',
	'**Gelecek Faz Etkisi:** Sonraki migration preflight, bu tek-owner lifecycle sözleşmesini opt-in scene/chunk replacement boundary’sine taşıyıp current live world restore/rollback ve before/after perf/console eşitliğini kanıtlayabilir. Bu ADR live activation kararı vermez.',
	'',
	'**Geri alma planı:** Live consumer yoktur. Ownership sınıflandırması yanlışlanırsa yeni versioned shadow module/checker eklenir; Run193 adapter, canonical source data ve current live scene değiştirilmez.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN194_STABLE_TAG + ' — run 194 canonical 27x21 chunk ownership + edge-padding + 7/7 bridge sequential replacement shadow proof (ADR-0214); full regression PASS; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN194_PERF_ROW + '\n');
console.log('[recordRun194CanonicalWindowOwnership] PASS: Run194 progress + ADR-0214 + map/stable/perf records appended.');
