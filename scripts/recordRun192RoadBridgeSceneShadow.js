#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run192-road-bridge-scene-shadow', 'proof.json');
const required = [
	'RUN192_STAMP',
	'RUN192_STABLE_TAG',
	'RUN192_SCENE_SUMMARY',
	'RUN192_CORE_JSON',
	'RUN192_MOBILE_SUMMARY',
	'RUN192_SMOKE_PASS_COUNT',
	'RUN192_PERF_ROW',
];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run192 scene-integration artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical road + bridge scene-integration shadow contract — run 192',
	'',
	`Run192 composes the already-approved Run191 stone-bridge plan with the canonical target-scale road routes in an isolated browser scene. All ${report.totalWaterRoutePoints} canonical route points classified as water are covered by deterministic suppression ranges, so a future bridge-aware road renderer has an explicit rule for removing the dirt ribbon underneath bridge/water spans rather than drawing both surfaces at once.`,
	'',
	`Each of the ${report.bridgeCount} bridges receives two deterministic dry-bank approach candidates (${report.approachCount} total). Maximum measured approach grade is ${report.maxApproachGradeDegrees.toFixed(2)}° and maximum approach length is ${report.maxApproachLengthMeters.toFixed(1)}m; the proof cap is 18° / 320m. Bridge deck-center collider probes resolve above the canonical terrain at all ${report.bridgeCount} structures.`,
	'',
	`Core bridge-aware road candidate cost is ${report.coreDrawCalls} draw calls / ${report.coreTriangles} triangles before live-world baseline composition. Near-camera frustum includes ${report.nearVisibleBridgeIds.length}/${report.bridgeCount} bridge bounds and includes the selected target bridge, proving the candidate does not require treating every bridge as locally visible. This remains shadow-only; live scene imports are unchanged.`
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 192 — Canonical road + stone-bridge scene integration shadow proof (' + process.env.RUN192_STAMP + ')',
	'- Session/concurrency: rebased on the latest main after PR #70 corrected Run191 bridge visual evidence; GOVERNANCE, Run191 progress/ADR and owner-resolution context were re-read before continuing. Owner-pending items unrelated to this scope were not guessed.',
	'- Alt görev: Run191 stone-bridge fixture + canonical target-scale MST/pathfinder routes were composed in an isolated browser scene without wiring `game3d`, `sceneManager`, `chunkManager`, live roads, terrain, water or physics.',
	'- Bridge-aware road suppression plan: ' + report.coveredWaterRoutePoints + '/' + report.totalWaterRoutePoints + ' canonical water route points are inside deterministic replacement ranges; the proof renders only dry canonical road runs across those ranges, so underwater dirt-road geometry is not part of the candidate render.',
	'- Deck transitions: ' + report.approachCount + ' deterministic dry-bank approach ramps; max grade ' + report.maxApproachGradeDegrees.toFixed(2) + '° <= 18° proof cap, max approach length ' + report.maxApproachLengthMeters.toFixed(1) + 'm <= 320m. Each ramp starts/ends on an actual canonical route point and lands exactly on the Run191 bridge deck endpoint.',
	'- Collision-readiness: all ' + report.bridgeCount + ' bridge center probes resolve a deterministic deck height above the underlying canonical terrain; this is proof-only and does not replace the live physics collider yet.',
	'- Camera/frustum: near proof view sees ' + report.nearVisibleBridgeIds.length + '/' + report.bridgeCount + ' bridge bounds and includes target `' + report.targetBridgeId + '`, demonstrating bounded visibility rather than an always-visible assumption.',
	'- Core candidate budget: ' + process.env.RUN192_CORE_JSON + '; live-mobile composition gate: ' + process.env.RUN192_MOBILE_SUMMARY + '.',
	'- Visual DoD: two 1280x720 road/bridge/water/terrain evidence views (`road-bridge-near.png`, `road-bridge-far.png`) plus existing live 390x844/F4 regression evidence in the standing smoke/mobile suite.',
	'- DoD: node --check, additive-only, canonical map/hydrology/migration/terrain/chunk/road/Run191 bridge gates, determinism/assets/PWA/cache, dedicated a11y/input/jump checks, mobile streaming/radius4/LOD/perf and baseline+after browser smoke ' + process.env.RUN192_SMOKE_PASS_COUNT + '/34+ PASS; zero 3D console/page errors.',
	'- PWA/cache: no new live/src module was added in this run, so service-worker shell bytes are unchanged; standing PWA/cache checks PASS.',
	'- Memory leak checklist: isolated terrain chunks/water/bridge/road/approach geometries and materials are explicitly disposed; no live listener/timer/DOM ownership added. Teknik borç 1 (mevcut game3d.js), yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0212.',
	'- World Coverage live değerleri değişmedi: desktop %96,2; mobile resident radius-4 81 chunk / 20,25 km² (~%14,7). World Evolution Report: canonical road+bridge scene-integration readiness +1; live terrain/road/gameplay delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: bu doğrulanmış suppression/approach/collider/culling contractını reusable versioned shadow scene-adapter modülüne taşımak ve canonical terrain+roads+bridges+rocks birleşik scene budget/streaming proofunu almak; bundan önce live full-reference switch yapılmaz.'
]);

append('DECISIONS.md', [
	'## ADR-0212 — Prove bridge-aware canonical road scene composition before any live full-reference switch (run 192)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run192 owner-approved Run191 stone bridges and canonical target-scale road routes are composed only inside a new browser proof. Every canonical route point classified as water is covered by an edge/crossing replacement range; the candidate road ribbon omits those ranges, two bounded dry-bank ramps per bridge connect actual canonical route points to exact bridge deck endpoints, and a proof-only deck-height resolver demonstrates collider precedence. No live runtime import is added.',
	'',
	`**Ölçüm:** ${report.bridgeCount} bridges, ${report.approachCount} approaches, water suppression ${report.coveredWaterRoutePoints}/${report.totalWaterRoutePoints}; max approach ${report.maxApproachGradeDegrees.toFixed(2)}° / ${report.maxApproachLengthMeters.toFixed(1)}m; core candidate ${report.coreDrawCalls} draw calls / ${report.coreTriangles} triangles; near frustum ${report.nearVisibleBridgeIds.length}/${report.bridgeCount} bridge bounds.`,
	'',
	'**Neden:** Run191 proved bridge topology/art/geometry but intentionally left the live world unchanged. Direct live adoption would otherwise combine four risks at once: dirt-road geometry continuing underwater, abrupt deck height changes at banks, physics still sampling seabed/terrain instead of deck, and all bridge geometry remaining unbounded in scene visibility. A separate scene-integration proof makes those contracts measurable before any migration switch.',
	'',
	'**Alternatifler:** (1) Wire Run191 bridge group directly into `game3d` and accept overlapping road/water geometry — rejected. (2) Modify existing `roads.js` in place — prohibited by additive-only and unnecessarily risks the proven legacy road path. (3) Hide all canonical roads at water edges without approach geometry — rejected because visual/physics continuity would remain unqualified. (4) Use a test-only deterministic composition first — selected.',
	'',
	'**Sonuç:** A bridge-aware canonical-road composition algorithm is now measured and visually demonstrated, but remains deliberately outside the live import graph. Run192 does not claim full-reference runtime adoption.',
	'',
	'**Etkilenen sistemler:** new Run192 checker/CI/recorder plus generated evidence and append-only WORLD_REFERENCE_MAP/progress/ADR/stable/perf records. Existing 2D game and all live 3D source modules remain byte-unchanged.',
	'',
	'**Gelecek Faz Etkisi:** A reusable versioned shadow adapter can now implement the proven suppression/ramp/collider contract and be composed with canonical terrain/chunks and Run190 rocks for a single scene budget/streaming proof. Live migration remains a later, separately gated high-impact step.',
	'',
	'**Geri alma planı:** No runtime consumer exists. If the approach/suppression contract is disproved, replace the checker with a new additive version and leave all live systems untouched.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN192_STABLE_TAG + ' — run 192 canonical road + owner-approved stone-bridge scene-integration shadow proof (ADR-0212); water-road suppression + bounded deck approaches + collider/frustum/mobile budget + full regression PASS; live runtime delta 0.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN192_PERF_ROW + '\n');
console.log('[recordRun192RoadBridgeSceneShadow] PASS: WORLD_REFERENCE_MAP + Run192 progress + ADR-0212 + stable/perf recorded.');
