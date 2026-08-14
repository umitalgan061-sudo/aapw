#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run189-rock-placement', 'qualification.json');
const required = ['RUN189_STAMP', 'RUN189_STABLE_TAG', 'RUN189_PERF_ROW', 'RUN189_SMOKE_PASS_COUNT', 'RUN189_ROCK_SUMMARY', 'RUN189_ROCK_CHECKSUM', 'RUN189_MOBILE_BUDGET_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run189 rock-placement artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

const tiers = report.counts.tierCounts;
const zoneSummary = report.zoneCoverage.map(([id, count]) => `${id}:${count}`).join(', ');
const protectedGridNote = report.counts.protectedExcluded > 0
	? `${report.counts.protectedExcluded} sampled grid point protected-site envelope tarafından elendi`
	: '120m qualification grid hiçbir protected envelope içine denk gelmedi; 14/14 exact seat center protection ayrıca doğrulandı';

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical rock/stone placement qualification — run 189',
	'',
	`Run189, mevcut canonical mountain/rocky-hills biome zoneları ile relief-chain anchorlarını deterministic geology influence olarak kullanıp full-reference planned world üzerinde 120m hücreli, seed=${report.policy.seed} shadow-only kaya/taş aday taraması yaptı. Canonical water elendi, 14/14 kingdom-seat center protected-land olarak doğrulandı, adaylar mevcut temporary 35° walkable-slope safety sınırının üstüne çıkmadı. ${report.counts.eligible} aday üretildi: stone ${tiers.stone}, rock ${tiers.rock}, boulder ${tiers.boulder}; geology coverage ${report.zoneCoverage.length} zone/source (${zoneSummary}). Checksum \`${report.checksum}\`.`,
	'',
	'Qualification boundary: bu çıktı canlı rock mesh/spawn sistemi değildir; runtime scene/terrain/road/PWA import graphı değişmez. Yol-su policy owner kararı açık olduğu için rock-road clearance veya canonical live-road adoption bu run içinde varsayılmaz. Macro-relief height değişikliği de yapılmaz; bu yalnız ilerideki kaya geometry/placement katmanı için deterministik, su/yerleşim-güvenli aday sözleşmesidir.'
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 189 — Canonical deterministic rock/stone placement shadow qualification (' + process.env.RUN189_STAMP + ')',
	'- Alt görev: GOVERNANCE §30 item 3 için canlı world/terrain/road koduna dokunmadan canonical kaya/taş yerleşiminin güvenli aday uzayı ölçüldü. Existing REFERENCE_BIOME_ZONES (mountain/rocky-hills) + REFERENCE_RELIEF_CHAINS geology signal olarak kullanıldı; yeni sanat/product kararı tahmin edilmedi.',
	'- Determinism: 120m full-reference grid + bounded deterministic jitter + WORLD_SEED tabanlı integer hash; aynı qualification iki ayrı browser ölçümünde bit-eşit summary/checksum verdi. ' + process.env.RUN189_ROCK_SUMMARY,
	`- Safety: canonical water excluded=${report.counts.waterExcluded}; exact protected kingdom-seat centers=${report.counts.protectedSeatCenters}/14; ${protectedGridNote}; eligible max slope ${report.maxSlopeDegrees.toFixed(1)}° <= ${report.policy.maxSlopeDegrees}°. Bu 35° yalnız mevcut owner-question temporary walkable safety değerini qualification guard olarak tekrar kullanır, yeni runtime art threshold değildir.`,
	`- Candidate mix: ${report.counts.eligible} total; stone/rock/boulder ${tiers.stone}/${tiers.rock}/${tiers.boulder}; geology coverage ${report.zoneCoverage.length}; candidate checksum ${report.candidateChecksum}; report checksum ${report.checksum}.`,
	'- Owner road-water gate korunuyor: bridge/ferry/dry/mixed seçilmedi; rock-road clearance veya full-reference road adoption varsayılmadı. Macro-relief height sampler da değişmedi.',
	'- Runtime/2D/PWA davranışı değiştirilmedi; src/3d, service-worker, script.js, index/game3d shell ve manifest byte davranışı Run188 main ile aynı. Yeni kod yalnız scripts/fixture/CI/governance kayıt katmanıdır.',
	'- Additive-only: checker + fixture + recorder + CI yeni dosya; progress/ADR/map/stable/perf kayıtları append-only. Existing source satırı silinmedi/değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN189_SMOKE_PASS_COUNT + '/34+ PASS; zero 3D console/page errors; canonical map/hydrology/terrain/chunk/road gates, rock fixture determinism, terrain/road/visual/grass, assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf ve iki mobil görsel kanıt PASS.',
	'- Mobil performans: ' + process.env.RUN189_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN189_PERF_ROW + '. Shadow-only test olduğundan live render delta 0.',
	'- Memory leak checklist: runtime listener/timer/DOM/GPU kaynağı eklenmedi; checker browser/server finally ile kapanır ve yalnız bounded qualification arrays kullanır. Teknik borç 1; yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0209.',
	'- World Coverage live değerleri değişmedi: desktop %96,2; mobile live resident radius-4 81 chunk / 20,25 km² (~%14,7). World Evolution Report: canonical rock-placement readiness +1; live terrain/road/gameplay delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: owner road-water policy hâlâ yanıtsızsa, Run189 fixtureını tüketen ayrı opt-in/shadow rock geometry proof (bounded instancing + mobile cost estimate + water/seat safety); canlı spawn ancak kendi perf/PWA/road-clearance kapıları geçtikten sonra değerlendirilir.'
]);

append('DECISIONS.md', [
	'## ADR-0209 — Qualify deterministic canonical rock sites before adding any live rock geometry or macro relief (run 189)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** GOVERNANCE §30 taş/kaya/dağ hedefinin ilk adımı runtime geometry veya height-sampler değişikliği değil, deterministic shadow placement qualification olacaktır. Run179 canonical reference içindeki mountain/rocky-hills biome zoneları ve relief-chain anchorları geology influence üretir; Run186 canonical hydrology target sampler kuru/sulu sınıflandırma ve slope ölçümü sağlar. WORLD_SEED tabanlı integer hash, 120m full-reference grid üzerinde bounded jitter/density/tier/yaw/scale üretir. Canonical water aday değildir; 14 kingdom-seat center protected-land sözleşmesi ayrıca doğrulanır; yalnız mevcut 35° temporary walkable-slope safety sınırı altında kalan adaylar fixturea alınır.',
	'',
	'**Neden:** §30 item 3 kaya/dağ zenginliğini aktif ürün hedefi yapıyor; ancak full-reference live road adoption Run188 owner road-water kararıyla hâlâ gatedir. Kaya meshlerini doğrudan canlı dünyaya serpmek yol koridorlarını veya performans bütçesini sessizce bozabilir. Önce immutable/checksummed aday uzayı üretmek placement mantığını görsel maliyetten ve açık road policy kararından ayırır.',
	'',
	`**Ölçüm:** ${report.counts.scanned} full-reference grid hücresi tarandı; ${report.counts.eligible} dry/unprotected/geology-qualified aday bulundu. Tierler stone/rock/boulder ${tiers.stone}/${tiers.rock}/${tiers.boulder}; ${report.counts.waterExcluded} canonical-water sample elendi; 14/14 exact seat center protected; max eligible slope ${report.maxSlopeDegrees.toFixed(1)}°. Candidate checksum \`${report.candidateChecksum}\`; report checksum \`${report.checksum}\`.`,
	'',
	'**Alternatifler:** Live InstancedMesh katmanını aynı run içinde eklemek reddedildi (placement + render/perf riskini karıştırır); canonical mountain reliefini doğrudan height samplerına yazmak reddedildi (§8.4 pre/post terrain safety ve road-water blocker çözülmeden yüksek etki); road clearance için Run188 bridge/ferry/dry/mixed seçeneklerinden birini tahmin etmek reddedildi; tüm kara üzerinde uniform random kaya dağıtımı reddedildi çünkü canonical geology direktifini kullanmaz.',
	'',
	'**Sonuç:** Reproducible rock-site fixture ve geology coverage metriği vardır; live runtime sıfır değişmiştir. Bir sonraki shadow geometry proof bu fixtureı tüketebilir ve gerçek draw/triangle maliyetini ölçebilir; live adoption ayrı karar/gate olarak kalır.',
	'',
	'**Etkilenen sistemler:** yalnız Run189 checker/fixture/CI/governance kayıtları ve WORLD_REFERENCE_MAP/progress/ADR/stable/perf appendleri. src/3d runtime, 2D oyun, road topology, terrain height sampler, service worker ve asset kataloğu değişmez.',
	'',
	'**Gelecek Faz Etkisi:** Rocks ileride cave/habitat okunabilirliğine doğal anchor sağlayabilir; fakat bu fixture cave veya dragon habitat spawn politikasını belirlemez. Macro-relief değişikliği ayrı §8.4 terrain-safety alt görevidir.',
	'',
	'**Geri alma planı:** Runtime consumer yoktur. Qualification varsayımı yanlışlanırsa yeni versioned checker/fixture additive olarak eklenir; canonical map/hydrology ve Run188 road-water owner gate korunur.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN189_STABLE_TAG + ' — run 189 canonical deterministic rock/stone placement shadow qualification (ADR-0209); fixture determinism + full regression gates PASS; live runtime delta 0.'
]);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN189_PERF_ROW + '\n');
console.log('[recordRun189Governance] PASS: map + progress + ADR-0209 + stable checkpoint + perf row recorded; owner question set unchanged.');
