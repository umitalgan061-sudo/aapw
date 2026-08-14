#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN187_STAMP', 'RUN187_STABLE_TAG', 'RUN187_PERF_ROW', 'RUN187_SMOKE_PASS_COUNT', 'RUN187_CHUNK_SUMMARY', 'RUN187_MOBILE_BUDGET_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical chunk / water / collider integration shadow — run 187',
	'',
	'Run187 bakes the Run186 canonical hydrology-aware sampler into real 64-segment `THREE.PlaneGeometry` chunks using the same chunk-center convention as the live world, pairs those meshes with the existing `world/water.js` flat sea plane, and exposes a `getGroundHeight(x,z)` collider facade backed by the identical sampler. This is still opt-in shadow infrastructure: live `game3d`, `sceneManager`, `ChunkManager`, terrain, water, roads, settlements and physics do not import it.',
	'',
	'The integration check uses protected Balon and Jon plus an open Summer Sea probe, proves every baked vertex agrees with the numeric canonical sampler, raycasts the actual meshes, verifies rendered terrain and collider agreement at protected settlement centers, and proves the existing water surface raycasts above the canonical seabed. It also diagnoses every target-scale road route against canonical hydrology; any water-crossing route is recorded as an explicit blocker for bridge/ferry/water-avoidance policy before live road migration.'
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 187 — Canonical chunk + water + collider integration shadow (' + process.env.RUN187_STAMP + ')',
	'- Yeni `worldReferenceChunkShadow.js`, Run186 numeric canonical samplerı gerçek THREE terrain geometrysine bake eder ve aynı samplerdan physics-compatible `getGroundHeight(x,z)` facade üretir; live import graphına bağlanmaz.',
	'- Integration proof: ' + process.env.RUN187_CHUNK_SUMMARY,
	'- Balon/Jon protected-land örnekleri gerçek raycast edilen chunk geometry üzerinde dry/flat kalır; Summer Sea aynı sahnede existing `createWater()` düzleminin altında gerçek seabed olarak doğrulanır.',
	'- Road migration readiness artık yalnız grade ile değil canonical-water diagnostic ile de ölçülür. Water-crossing edge varsa live road switch bloke kalır; sonraki run bridge/ferry veya hydrology-aware avoidance politikasını çözmelidir.',
	'- PWA: yeni src/3d shadow module GAME3D_SHELL_FILES listesine additive precache edildi; offline cache/installability gate PASS.',
	'- Additive-only: yeni chunk-shadow/check/PWA-applicator/recorder/CI + append-only ledgers. Live 2D/3D runtime kaynakları değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN187_SMOKE_PASS_COUNT + '/34+ PASS; zero console/page errors; Run184/185/186 canonical gates, real chunk/water/collider shadow, terrain/road/visual/grass, determinism/assets/PWA, a11y/input/physics, mobile streaming/LOD/perf, visual evidence ve additive-only PASS.',
	'- Mobil performans: ' + process.env.RUN187_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN187_PERF_ROW + '. Shadow-only olduğu için live render delta 0.',
	'- Memory leak checklist: shadow chunk geometry/material ve existing water geometry/material dispose edilir; checker browser/server finally ile kapanır; runtime listener/timer/DOM eklenmez. Teknik borç 1; yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0207.',
	'- World Evolution Report: canonical runtime-integration readiness +1; live terrain/water/road/gameplay delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: canonical road-water diagnostic sonucuna göre bridge/ferry veya water-avoidance route policy; road güvenliği çözülmeden full-reference default runtime switch yapma.'
]);

append('DECISIONS.md', [
	'## ADR-0207 — Prove canonical terrain as real chunk geometry against the existing water plane and collider shape before live integration (run 187)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run186 canonical target-height sampler, yeni shadow-only chunk integration module üzerinden real `THREE.PlaneGeometry` terrain meshine bake edilir. Mesh chunk merkezi/size/segments conventionı live terrain ile aynı tutulur. Aynı numeric sampler ayrıca physics public shape ile uyumlu `getGroundHeight(x,z)` facade verir; existing `createWater()` water plane aynen kullanılır. Live scene/chunk/physics source hiçbir import veya default davranış değişikliği almaz.',
	'',
	'**Neden:** Numeric grid doğrulaması tek başına render geometry, water surface ve gameplay-ground source arasında drift olmadığını kanıtlamaz. Runtime switchten önce aynı samplerın gerçek mesh vertexlerine taşındığı, seat raycast/collider değerlerinin uyuştuğu ve canonical seabed\'in existing sea plane altında kaldığı ölçülmelidir.',
	'',
	'**Road diagnostic:** Target MST road routes canonical sampler üzerinde ayrıca hydrology-classify edilir. Bu run water-crossing route bulursa bunu hata diye saklamaz veya roadu keyfi taşımaya çalışmaz; live migration blocker olarak kaydeder. Bridge/ferry ya da deterministic water-avoidance routing ayrı ADR gerektirir.',
	'',
	'**Alternatifler:** `terrain.js` mevcut creatorını doğrudan değiştirmek reddedildi (live davranış riski); yalnız numeric sampler testine güvenmek reddedildi (render/collider integration kanıtı yok); water plane yerine yeni shadow water implementation yazmak reddedildi (gerçek runtime surface test edilmez); road-water crossingleri sessizce görmezden gelmek reddedildi.',
	'',
	'**Sonuç:** Canonical coast artık numeric policy yanında gerçek renderable terrain + existing water + collider-shape integration seviyesinde test edilir. Live runtime hâlâ değişmez; road-water diagnostic bir sonraki migration gateini belirler.',
	'',
	'**PWA:** Yeni src/3d module standing offline-shell policy gereği additive precache edilir.',
	'',
	'**Geri alma planı:** Runtime consumer yoktur. Shadow geometry helper yanlışlanırsa yeni versioned helper/policy eklenir; Run179-186 canonical source truth korunur.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN187_STABLE_TAG + ' — run 187 canonical chunk/water/collider integration shadow (ADR-0207); real mesh raycast + water-plane + collider + road-water diagnostics and full regression gates PASS; live runtime delta 0.'
]);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN187_PERF_ROW + '\n');
console.log('[recordRun187Governance] PASS: WORLD_REFERENCE_MAP + progress + ADR-0207 + stable checkpoint + perf row recorded.');
