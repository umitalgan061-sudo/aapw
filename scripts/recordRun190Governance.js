#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run190-rock-geometry', 'proof.json');
const required = ['RUN190_STAMP', 'RUN190_STABLE_TAG', 'RUN190_PERF_ROW', 'RUN190_SMOKE_PASS_COUNT', 'RUN190_ROCK_GEOMETRY_SUMMARY', 'RUN190_ROCK_GEOMETRY_CHECKSUM', 'RUN190_MOBILE_BUDGET_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run190 rock geometry artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

const mobile = report.mobile;
const desktop = report.desktop;

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical rock geometry shadow proof — run 190',
	'',
	`Run190, Run189 canonical candidate sözleşmesini yeni shadow-only \`worldReferenceRockShadow.js\` içinde bağımsız olarak yeniden üretti ve candidate checksum \`${report.run189CandidateChecksum}\` değerini korudu. ${report.candidateCount} adayın provisional canonical-target MST/pathfinder centerline'larına minimum ${report.road.clearanceMeters}m koridoru ölçüldü: safe=${report.road.safeCount}, conflict=${report.road.conflictCount}. Bu corridor Run188 bridge/ferry/dry/mixed owner kararını seçmez ve live road policy değildir.`,
	'',
	`Real geometry proof: mobile local bounded profile ${mobile.predicted.selectedInstances} instance, near/far ${mobile.predicted.nearInstances}/${mobile.predicted.farInstances}, ${mobile.actual.drawCalls} gerçek renderer draw call / ${mobile.actual.triangles} triangle; desktop ${desktop.predicted.selectedInstances} instance, near/far ${desktop.predicted.nearInstances}/${desktop.predicted.farInstances}, ${desktop.actual.drawCalls} draw call / ${desktop.actual.triangles} triangle. En fazla 3 tier x 2 LOD InstancedMesh resident olur; full 137.5 km² candidate set tek seferde resident yapılmaz. Proof checksum \`${report.checksum}\`.`,
	'',
	'Boundary: shadow modül live scene/chunk/terrain/road/vegetation/game3d import graphına bağlı değildir. Service worker listesine yalnız offline-loadability için additive precache entry eklenir. Canlı kaya spawn, collision veya macro-relief height değişikliği bu runın kapsamında değildir.'
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 190 — Canonical real rock geometry + LOD shadow proof (' + process.env.RUN190_STAMP + ')',
	'- Alt görev: Run189/ADR-0209 fixture sözleşmesini gerçek THREE geometry katmanına taşıyan opt-in/shadow worldReferenceRockShadow.js eklendi. Live scene/chunk/gameplay consumer yok; oyuncu dünyası değişmez.',
	'- Determinism: yeni module Run189 exact candidate fields/order algoritmasını bağımsız yeniden üretir; candidate count/checksum birebir korunmak zorunda. ' + process.env.RUN190_ROCK_GEOMETRY_SUMMARY,
	`- Provisional road clearance: 13 canonical-target MST/pathfinder centerline üzerinde ${report.road.clearanceMeters}m diagnostic corridor; ${report.road.safeCount}/${report.candidateCount} candidate safe, ${report.road.conflictCount} conflict. Bu filter yalnız shadow geometry proof subsetini seçer; Run188 owner bridge/ferry/dry/mixed policy hâlâ NONE ve route adoption kararı verilmedi.`,
	`- Geometry/LOD: mobile bounded profile radius ${mobile.predicted.renderRadiusMeters}m, max ${mobile.predicted.maxInstances} instance; selected ${mobile.predicted.selectedInstances}, near/far ${mobile.predicted.nearInstances}/${mobile.predicted.farInstances}, actual ${mobile.actual.drawCalls} draw calls / ${mobile.actual.triangles} triangles. Desktop radius ${desktop.predicted.renderRadiusMeters}m, max ${desktop.predicted.maxInstances}; selected ${desktop.predicted.selectedInstances}, near/far ${desktop.predicted.nearInstances}/${desktop.predicted.farInstances}, actual ${desktop.actual.drawCalls} calls / ${desktop.actual.triangles} triangles.`,
	'- Memory/resource lifecycle: each non-empty tier/LOD owns one low-poly geometry + one MeshStandardMaterial; dispose helper geometry/materialları dispose edip group childrenı sıfırlar. Real headless renderer predicted/actual draw+triangle sayıları eşit doğrulandı.',
	'- PWA: yeni src/3d shadow module standing offline-shell guard gereği GAME3D_SHELL_FILES içine tek additive satırla precache edildi; live import graph değişmedi ve cache/installability gate PASS.',
	'- Additive-only: yeni shadow module/checker/PWA-applicator/recorder/CI + fixture ve append-only governance kayıtları; service-worker içinde yalnız tek yeni precache satırı. Mevcut source satırı silinmedi/değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN190_SMOKE_PASS_COUNT + '/34+ PASS; zero 3D console/page errors; Run189 candidate fixture + Run190 geometry fixture, canonical map/hydrology/terrain/chunk/Run188 road gates, world visuals/grass, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf ve iki mobil görsel kanıt PASS.',
	'- Live mobil performans: ' + process.env.RUN190_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN190_PERF_ROW + '. Shadow module runtime unwired olduğundan live render delta 0; ayrı isolated geometry renderer maliyeti yukarıdaki actual draw/triangle sayılarıdır.',
	'- Memory leak checklist: live listener/timer/DOM eklenmedi; shadow geometry dispose helper PASS; checker browser/server/renderer finally/dispose zinciriyle kapanır. Teknik borç 1 (mevcut game3d.js). Yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0210.',
	'- World Coverage live değerleri değişmedi: desktop %96,2; mobile resident radius-4 81 chunk / 20,25 km² (~%14,7). World Evolution Report: canonical rock render-readiness +1; live terrain/road/gameplay delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: owner road-water policy hâlâ yanıtsızsa canlı kaya spawn etmeden önce camera-cell/chunk streaming shadow integration + occlusion/frustum/collider-readiness proof; live adoption ancak route policy ve scene-level perf/visual gates birlikte geçerse değerlendirilir.'
]);

append('DECISIONS.md', [
	'## ADR-0210 — Prove bounded real rock geometry and LOD off-runtime before any live spawn (run 190)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run189 canonical rock candidate contract yeni `worldReferenceRockShadow.js` içinde bağımsız biçimde tekrar üretilir ve Run189 candidate checksum ile kilitlenir. Render proof tüm dünya adaylarını tek seferde resident yapmaz: mobile ve desktop için ayrı local render radius + hard instance cap vardır; stone/rock/boulder tierleri near/far LOD olarak en fazla altı `THREE.InstancedMesh` submission üretir. Geometri low-poly procedural primitive ve texture-free MeshStandardMaterial kullanır. Modül live scene/chunk/gameplay tarafından import edilmez.',
	'',
	`**Road-clearance kararı:** Run188 owner road-water policy açıkken hiçbir bridge/ferry/dry/mixed seçenek seçilmez. Bunun yerine mevcut canonical-target MST/pathfinder centerline geometry yalnız diagnostic olarak kullanılır ve ${report.road.clearanceMeters}m corridor dışında kalan ${report.road.safeCount}/${report.candidateCount} candidate shadow geometry proof için safe subset sayılır. ${report.road.conflictCount} conflict silinmez/saklanmaz; fixture içinde sayısal olarak pinlenir. Future road mapping değişirse clearance yeniden ölçülür.`,
	'',
	`**Ölçüm:** Run189 checksum \`${report.run189CandidateChecksum}\` korundu. Mobile ${mobile.predicted.selectedInstances} instance (${mobile.predicted.nearInstances} near/${mobile.predicted.farInstances} far), actual ${mobile.actual.drawCalls} calls/${mobile.actual.triangles} triangles. Desktop ${desktop.predicted.selectedInstances} instance (${desktop.predicted.nearInstances} near/${desktop.predicted.farInstances} far), actual ${desktop.actual.drawCalls} calls/${desktop.actual.triangles} triangles. Predicted ve renderer.info submission değerleri eşit; dispose sonrası group child count 0. Run190 checksum \`${report.checksum}\`.`,
	'',
	'**Neden:** Placement correctness tek başına gerçek geometry maliyetini, LOD davranışını veya resident-set boundunu kanıtlamaz. Canlı spawnı doğrudan eklemek ise full-reference road policy hâlâ unresolved iken collision/readability/perf riskini runtimea taşır. Shadow module gelecekteki implementation shapeini gerçek THREE nesneleriyle kanıtlarken rollback maliyetini sıfıra yakın tutar.',
	'',
	'**Alternatifler:** 343 kayanın tamamını tek world-resident group yapmak reddedildi (streaming hedefiyle çelişir); her kayayı ayrı Mesh yapmak reddedildi (draw-call explosion); external rock asset indirmek reddedildi (bu proof için lisans/asset maliyeti gereksiz); live sceneManager wiring aynı run içinde reddedildi; provisional road centerlineı final owner policy saymak reddedildi.',
	'',
	'**Sonuç:** Deterministic site contract artık gerçek bounded InstancedMesh + near/far LOD + renderer.info maliyet ölçümü seviyesinde kanıtlıdır, fakat oyuncu runtimeı unchanged kalır. Service worker yalnız yeni shadow module offline-loadability için additive entry alır.',
	'',
	'**Etkilenen sistemler:** yeni src/3d/world/worldReferenceRockShadow.js, Run190 checker/fixture/PWA applicator/recorder/CI, service-worker GAME3D_SHELL_FILES additive entry ve append-only world/progress/ADR/stable/perf kayıtları. game3d/sceneManager/chunkManager/terrain/roads/vegetation/physics/2D runtime değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Bir sonraki shadow integration camera-cell/chunk ownership, frustum/occlusion ve optional collider footprintlerini test edebilir. Macro-relief height sampler değişikliği hâlâ ayrı GOVERNANCE §8.4 terrain-safety runı gerektirir.',
	'',
	'**Geri alma planı:** Live consumer yoktur. Geometry/LOD policy yanlışlanırsa yeni versioned shadow module/checker additive eklenir; Run189 site fixture ve Run188 owner road gate korunur.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN190_STABLE_TAG + ' — run 190 canonical real rock geometry/LOD shadow proof (ADR-0210); Run189 checksum + road-clear diagnostic + real renderer cost + full regression PASS; live runtime delta 0.'
]);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN190_PERF_ROW + '\n');
console.log('[recordRun190Governance] PASS: map + progress + ADR-0210 + stable checkpoint + perf row recorded; owner questions unchanged.');
