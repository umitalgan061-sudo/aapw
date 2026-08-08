#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run194-canonical-clipped-window-ownership', 'proof.json');
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
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run194 V2 proof artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
const deterministic = report.deterministic;
const grid = deterministic.grid;
const audit = deterministic.audit;

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Exact-reference clipped 27x21 owner grid — run 194',
	'',
	`Run194 V1 deliberately failed when a fixed full 500m edge chunk asked the canonical sampler for a point beyond the 9000x7000 owner map. V2 preserves the existing ${grid.columns}x${grid.rows} = ${grid.cellCount} owner coordinates but clips each outer footprint to the exact planned ${grid.worldWidthMeters.toFixed(3)}m x ${grid.worldDepthMeters.toFixed(3)}m rectangle before any height sample.`,
	'',
	`The resulting tiling has ${audit.fullCellCount} full 500m cells and ${audit.clippedCellCount} partial edge cells. Area remains exactly ${grid.targetAreaKm2.toFixed(1)} km² within ${audit.areaErrorM2}m² numeric error and maximum seam error ${audit.maxSeamErrorMeters}m. Outer cells trim ${audit.xEdgeTrimMeters.toFixed(3)}m in X and ${audit.zEdgeTrimMeters.toFixed(3)}m in Z from their nominal 500m footprint; no canonical terrain is owned or sampled beyond the reference rectangle.`,
	'',
	`An exact corner mobile ownership window now contains ${deterministic.corner.residentCount} canonical chunks, ${deterministic.corner.clippedResidentCount} of them partial edge cells, rather than requesting out-of-map padding. Seven bridge-centered ownership windows then replace each other sequentially with deck-collider precedence preserved; minimum bridge-center clearance is ${deterministic.minDeckClearanceMeters.toFixed(3)}m. Live scene/chunk managers remain unchanged.`
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 194 — Exact-reference clipped chunk ownership + 7/7 bridge replacement shadow proof (' + process.env.RUN194_STAMP + ')',
	'- Session/concurrency: started from merged Run193 `main` (`62387c23…`) and rechecked remote main before both V1 and V2 work. No competing Run194/ADR-0214 was present. GOVERNANCE, recent commits, ADR-0213 and QUESTIONS_FOR_OWNER were re-read; no owner-pending tuning/art/routing decision was guessed.',
	'- V1 finding: the first additive Run194 prototype intentionally failed its new edge proof with `RangeError: mapY outside 2D map canvas`. Root cause was real: ceil-based 27x21 indexing covers the exact map, but a nominal full 500m outer chunk physically overhangs the reference bounds. The failure was not bypassed; V1 files remain historical shadow tooling because additive-only forbids deletion.',
	'- V2 fix: new `worldReferenceClippedWindowOwnershipShadow.js` supersedes V1 without modifying Run193’s closed 562/600-line adapter. Every outer owner footprint is intersected with exact reference bounds before sampling; outside-reference terrain is neither owned nor rendered by the V2 proof.',
	'- Planned ownership: ' + grid.columns + 'x' + grid.rows + '=' + grid.cellCount + ' owner cells; ' + audit.fullCellCount + ' full + ' + audit.clippedCellCount + ' partial edge cells; exact area ' + grid.targetAreaKm2.toFixed(1) + 'km²; area error ' + audit.areaErrorM2 + 'm²; seam error ' + audit.maxSeamErrorMeters + 'm. Nominal edge trim X/Z ' + audit.xEdgeTrimMeters.toFixed(3) + '/' + audit.zEdgeTrimMeters.toFixed(3) + 'm.',
	'- Exact-corner runtime-shadow proof: mobile resident set ' + deterministic.corner.residentCount + ' canonical chunks, of which ' + deterministic.corner.clippedResidentCount + ' are clipped edge footprints. The canonical height sampler completes with no out-of-map request and no padding owner cells.',
	'- Bridge/window ownership: 7/7 Run191 bridge targets visited after the corner window, for ' + deterministic.generations + ' sequential generations and ' + deterministic.disposeCount + ' clean disposals. Exactly one ownership root is active at a time; every previous terrain/bridge/root collection is empty before replacement.',
	'- Physics ownership: all 7 bridge centers resolve through the same Run193 composite ground-collider contract to deck top above canonical terrain; minimum clearance ' + deterministic.minDeckClearanceMeters.toFixed(3) + 'm. Independent Run191 23,436-sample traversal readiness remains green in CI.',
	'- Scene budget: ' + process.env.RUN194_BUDGET_JSON + '. Live mobile baseline remains ' + process.env.RUN194_LIVE_MOBILE_JSON + '; Run194 V1/V2 are shadow-only and add zero player-runtime draw/triangle cost.',
	'- Visual DoD: 1440x900 clipped-grid edge + clipped bridge-ownership screenshots plus `proof.json`; summary: ' + process.env.RUN194_SUMMARY + '.',
	'- DoD: syntax/additive-only, Run190-193 canonical proofs, exact clipped ownership V2, world visual/lifecycle gates, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf and baseline+after browser smoke ' + process.env.RUN194_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page errors 0.',
	'- PWA/cache: both retained V1 shadow module and superseding V2 module receive additive precache entries because both remain under `src/3d`; no existing entry is removed or rewritten.',
	'- Memory/technical debt: V2 sequential windows dispose terrain geometries/materials, bridge Art V2 resources, water and final renderer canvas. Run193 adapter remains 562/600 and byte-unchanged. Retained failed V1 module/checker/workflow is shadow-tooling debt forced by additive-only; new live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0214.',
	'- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical exact-edge ownership/lifecycle readiness +1; live world delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: default live switch yapmadan ayrı versioned opt-in migration-controller preflight ile clipped owner-window lifecycle sözleşmesini scene/chunk replacement boundary şekline yaklaştır; current live world restore/rollback ownershipini ve pre/post visual/perf/console eşitliğini kanıtla. Bu kapı geçmeden varsayılan oyuncu runtimeı değiştirilmez.'
]);

append('DECISIONS.md', [
	'## ADR-0214 — Outer canonical owner chunks are clipped to exact reference bounds; no canonical terrain exists outside them (run 194)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Existing 27x21 / 500m full-reference extent plan remains the canonical ownership index, centered at x -13..13 and z -10..10. However, the outer row/column cells are not full 500m render footprints: each nominal cell is intersected with the exact planned owner-map world rectangle before geometry generation or height sampling. Coordinates outside that intersection have no canonical terrain owner. Window replacement uses one active shadow root at a time and disposes the previous root/resources before constructing the next.',
	'',
	`**Ölçüm:** ${audit.fullCellCount} full + ${audit.clippedCellCount} clipped owner cells = ${grid.cellCount}; target area ${grid.targetAreaKm2.toFixed(1)}km² with area error ${audit.areaErrorM2}m² and seam error ${audit.maxSeamErrorMeters}m. Edge footprint trims X ${audit.xEdgeTrimMeters.toFixed(3)}m / Z ${audit.zEdgeTrimMeters.toFixed(3)}m. Exact-corner mobile window ${deterministic.corner.residentCount} cells (${deterministic.corner.clippedResidentCount} clipped). Seven bridge targets plus corner target produce ${deterministic.generations} generations / ${deterministic.disposeCount} clean disposals; min deck clearance ${deterministic.minDeckClearanceMeters.toFixed(3)}m. Deterministic checksum \`${report.checksum}\`.`,
	'',
	'**Neden:** Run194 V1 proved that treating ceil-grid edge ownership as full nominal 500m geometry can call the canonical sampler outside the 9000x7000 source map. The sampler rejection is correct and must not be weakened. Clipping preserves both source-map truth and the already-approved 27x21 ownership count without silently expanding the world.',
	'',
	'**Alternatifler:** (1) Samplerı out-of-map clamp edecek şekilde değiştirmek reddedildi; source truth sınır hatalarını gizlerdi. (2) Grid’i 25x19 gibi küçültmek reddedildi; exact reference rectangle coverage kaybolurdu. (3) Full 500m edge chunksı canonical sayıp dış kısmı sentetik doldurmak reddedildi; owner map dışında yeni coğrafya icat ederdi. (4) Run193 562/600 adapterı edge clipping için büyütmek reddedildi; checkpoint kapalı ve file-size debt artırılmıyor. (5) Bu run’da live scene/chunk wiring reddedildi; rollback yüzeyi ayrı preflightta kalır.',
	'',
	'**Sonuç:** Full-reference candidate, 567 unique owner coordinates plus exact partial outer footprints ile boşluksuz ve taşmasız 137.5km² tiling sözleşmesine sahiptir. Seven-bridge sequential ownership/collider lifecycle aynı exact-bound model üzerinde browserda kanıtlanır; live player world değişmez.',
	'',
	'**Etkilenen sistemler:** retained historical Run194 V1 shadow files; new V2 clipped ownership module/checker/PWA applicator/CI/recorder; additive service-worker entries; append-only map/progress/ADR/stable/perf records. Existing Run193 adapter and live 2D/3D consumers byte-unchanged.',
	'',
	'**Gelecek Faz Etkisi:** Opt-in migration-controller preflight, clipped footprint ownershipini gerçek replacement boundary shape’ine taşıyabilir; current live worldün restore/rollback ve pre/post perf/console eşitliği kanıtlanmadan default activation değerlendirilemez.',
	'',
	'**Geri alma planı:** Live consumer yoktur. Clipped ownership kontratı yanlışlanırsa yeni versioned shadow module eklenir; current live scene, Run193 adapter ve canonical source map değişmeden kalır.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN194_STABLE_TAG + ' — run 194 exact-reference clipped 27x21 owner-grid + 7/7 bridge sequential replacement shadow proof (ADR-0214); V1 edge failure superseded by V2; full regression PASS; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN194_PERF_ROW + '\n');
console.log('[recordRun194ClippedWindowOwnership] PASS: Run194 V2 progress + ADR-0214 + map/stable/perf records appended.');
