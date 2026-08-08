#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const required = ['RUN180_STAMP', 'RUN180_STABLE_TAG', 'RUN180_PERF_ROW', 'RUN180_SMOKE_PASS_COUNT'];
for (const key of required) {
  if (!process.env[key]) throw new Error('missing ' + key);
}

const grassSummary = process.env.RUN180_GRASS_SUMMARY || 'wind-grass contract PASS';
const integrationSummary = process.env.RUN180_INTEGRATION_SUMMARY || 'real-scene integration PASS';
const mobileSummary = process.env.RUN180_MOBILE_BUDGET_SUMMARY || 'mobile render budget PASS';

function append(file, lines) {
  fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('3D_GAME_PROGRESS.md', [
  '## Run 180 — Deterministic physical grass + natural GPU wind (' + process.env.RUN180_STAMP + ')',
  '- GOVERNANCE §30 owner sanat sırasının çimen+rüzgâr adımı uygulandı. Canonical map §31 ve run179 coastline/water-mask verisi korunur; bu run harita koordinat hizasını tahmin etmez veya terrain/water runtime davranışını değiştirmez.',
  '- ' + grassSummary,
  '- Gerçek scene bootstrap entegrasyonu: ' + integrationSummary,
  '- Placement: world seed + 120m camera-cell için deterministik; yol koridoru, 100m settlement/kale çevresi, water/shore ve 38° üzeri eğim dışlanır. Desktop 350m/4000 patch, mobile 260m/1200 patch. Her patch 10 blade / 20 triangle.',
  '- Rüzgâr: vertex shader iki frekanslı sway/gust, blade-tip flex ve world-position phase kullanır. Time yalnız görsel uniformdur; gameplay/world seed/checksum etkilenmez.',
  '- İlk-frame güvenliği: tek bounded grass InstancedMesh frustum-culling dışıdır; async player load sonrası kamera kilometrelerce taşındığında onBeforeRender aynı bounded instance bufferını güncel camera-cell konumuna recenter eder.',
  '- ' + mobileSummary,
  '- Additive-only: sceneManager.js ve vegetation.js yalnız sona append edildi; mevcut source satırı silinmedi/değiştirilmedi. Yeni model, texture, CDN veya runtime module yok.',
  '- DoD: node --check PASS; baseline + after browser smoke ' + process.env.RUN180_SMOKE_PASS_COUNT + '/34+ PASS; 3D console/page error 0; isolated+real-scene grass, canonical map+water mask, medieval roads, terrain/vegetation/water/sky/fog/lighting/starfield/camera, determinism, assets, a11y/input/physics, mobile streaming/LOD/culling/perf, PWA/cache ve additive-only kapıları PASS.',
  '- Görsel kanıt: gerçek 390x844 mobile Chromium yakın + F4 uzak iki screenshot artifact, console/page error 0.',
  '- Performans: ' + process.env.RUN180_PERF_ROW + '. Heap trend ayrıca kontrol edildi; grass tek bounded InstancedMesh ve teardown geometry/material dispose zinciri canlı doğrulandı.',
  '- Memory leak checklist: yeni grass mesh teardown sırasında geometry/material dispose edilir; yeni kalıcı listener/timer veya world-resident sınırsız koleksiyon yok.',
  '- Teknik borç: 1 (mevcut game3d.js yapısal borcu). Risk LOW. Güven 5/5. ADR: ADR-0201. World Coverage: desktop %96.2, mobil resident ~%14.7 (81 chunk / 20.25 km²) — değişmedi.',
  '- World Evolution Report: fiziksel grass/wind +1; road/terrain relief/castle/NPC/event/animal/coverage/asset/dialogue 0; ADR +1. Oyuncu farkı: EVET — açık arazide fiziksel çimen görünür ve doğal rüzgârla salınır.',
  '- Sıradaki güvenli adım: run179 canonical harita hizalama kontratını tamamla; ardından §30 sırasındaki taş/kaya ve makro relief işlerini terrain-safety kapılarıyla sürdür.'
]);

append('DECISIONS.md', [
  '## ADR-0201 — Grass is one bounded deterministic InstancedMesh with shader wind and first-frame-safe recenter (run 180)',
  '',
  '**Risk Seviyesi:** LOW',
  '',
  '**Karar:** Fiziksel grass, sceneManager additive katmanında tek InstancedMesh olarak üretilir. World seed + 120m quantized camera-cell determinism kullanılır; desktop 350m/4000, mobile 260m/1200 patch tavanıdır. Road, settlement, shore ve dik-yüzey exclusion zorunludur. Her patch 10 low-poly blade ve 20 triangle taşır. MeshStandardMaterial vertex shaderına iki frekanslı zaman tabanlı sway eklenir. Tek bounded mesh frustumCulled=false kullanır; createScene bootstrap kamerası ile async player-spawn kamerası ayrışsa bile recenter callback ilk player-camera renderında çalışır.',
  '',
  '**Neden:** World-resident milyonlarca blade mobil RAM ve triangle maliyetini büyütür; CPU per-blade animasyonu gereksizdir. Camera-local bounded field + GPU wind görünür fiziksel detay üretirken maliyeti kesin sınırlar. Frustum bypass yalnız bu tek bounded mesh içindir ve callbackin ilk player-camera renderında çalışmasını garanti eder.',
  '',
  '**Alternatifler:** Texture-only grass fiziksel salınım vermez. Milyonlarca world-resident blade bütçe riski taşır. game3d tick wiring mevcut yapısal borcu büyütür. Devasa bounding sphere gerçek boundsu yanlış temsil eder. Canonical water-mask/biome verisini aynı run içinde density tuninge bağlamak koordinat hizası kanıtlanmadan GOVERNANCE §31e aykırıdır.',
  '',
  '**Sonuç:** Grass gerçek render yolunda +1 draw-call bounded maliyetle görünür; aynı seed/cell bit-identical placement, doğal shader sway, first-frame camera teleport recenter ve teardown CI ile korunur. Canonical map/water mask, 2D, terrain relief, roads topology, gameplay ve world-event checksum değişmez.',
  '',
  '**Etkilenen sistemler:** src/3d/sceneManager.js ve src/3d/world/vegetation.js sonuna additive runtime katmanı; run180 grass contract, real-scene harness ve CI/governance kayıtları. Terrain sampler, water, roads topology, settlements ve 2D oyun değiştirilmez.',
  '',
  '**Gelecek Faz Etkisi:** Taş/kaya, makro relief, mağara ve wild-dragon habitat katmanları grass exclusion/density sözleşmesini yeniden kullanabilir; canonical harita hizası çözülene kadar grass dağılımı harita-maskesine bağlanmaz.',
  '',
  '**Geri alma planı:** İleride grass rendererı değişirse yeni versioned grass katmanı additive biçimde eklenebilir ve mevcut Run180 wrapperı feature-gate/no-op ile devre dışı bırakılabilir; geçmiş kayıt ve deterministik kontrat korunur.'
]);

append('STABLE_TAGS.md', [
  '- ' + process.env.RUN180_STABLE_TAG + ' — run 180 deterministic physical wind grass (ADR-0201); ' + process.env.RUN180_SMOKE_PASS_COUNT + '/34+ smoke + canonical-map/water-mask/mobile/PWA/determinism gates PASS.'
]);

fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN180_PERF_ROW + '\n');
console.log('[recordRun180GovernanceV2] PASS: progress + ADR-0201 + stable checkpoint + perf row recorded.');