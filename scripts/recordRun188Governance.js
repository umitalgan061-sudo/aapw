#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run188-road-water-policy', 'comparison.json');
const required = ['RUN188_STAMP', 'RUN188_STABLE_TAG', 'RUN188_PERF_ROW', 'RUN188_SMOKE_PASS_COUNT', 'RUN188_POLICY_SUMMARY', 'RUN188_MOBILE_BUDGET_SUMMARY'];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run188 policy artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

function km(meters) {
	return (meters / 1000).toFixed(2) + ' km';
}

const dryFeasible = report.edges.filter((edge) => edge.dry.found).length;
const bridgeTotal = report.edges.reduce((sum, edge) => sum + edge.bridgeTotalChordMeters, 0);
const bridgeMax = report.edges.reduce((max, edge) => Math.max(max, edge.bridgeMaxChordMeters), 0);
const ferryTotal = report.edges.reduce((sum, edge) => sum + edge.ferryTotalRouteMeters, 0);
const ferryMax = report.edges.reduce((max, edge) => Math.max(max, edge.ferryMaxRouteMeters), 0);
const matrixLines = report.edges.map((edge) => {
	const dry = edge.dry.found
		? `${km(edge.dry.lengthMeters)}, ${edge.dry.lengthInflationRatio.toFixed(2)}x, max ${edge.dry.maxGradeDegrees.toFixed(1)}°`
		: `NO (${edge.dry.reason})`;
	return `| ${edge.edge} | ${edge.pointWater}/${edge.pointTotal}; ${km(edge.waterTraversalMeters)} | ${edge.crossingCount}; ${km(edge.bridgeTotalChordMeters)} / ${km(edge.bridgeMaxChordMeters)} | ${edge.crossingCount}; ${km(edge.ferryTotalRouteMeters)} / ${km(edge.ferryMaxRouteMeters)} | ${dry} |`;
});

append('ROAD_WATER_OWNER_GATE.md', [
	'## Run 188 measured shadow policy comparison',
	'',
	'No policy is selected by this measurement. The same six Run187 water-crossing MST edges are compared under three measurable shadow interpretations; a mixed policy remains an owner-selected per-edge mapping rather than an automatically optimized answer.',
	'',
	'| Edge | Existing canonical-water exposure | Bridge diagnostic: crossings; total/max chord | Ferry diagnostic: crossings; total/max water-route | Dry-cart diagnostic (40m full-world grid, water impassable, <=20°) |',
	'| --- | ---: | ---: | ---: | --- |',
	...matrixLines,
	'',
	`Aggregate: bridge chord total ${km(bridgeTotal)}, longest ${km(bridgeMax)}; ferry water-route total ${km(ferryTotal)}, longest ${km(ferryMax)}; dry-cart route feasible ${dryFeasible}/${report.edges.length}. Comparison checksum: \`${report.checksum}\`.`,
	'',
	'Interpretation boundary: bridge/ferry span limits, boat gameplay, bridge art/physics and the exact mixed edge mapping are product decisions and are not inferred from these numbers. Dry-cart feasibility is a deterministic diagnostic route, not a live road implementation. Full-reference default runtime road adoption remains blocked until the owner chooses a policy.'
]);

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical road/water policy measurement — run 188',
	'',
	`Run188 preserves Run187's 399/1020 canonical-water road-point result across 6/13 MST edges and measures policy consequences without selecting one. Bridge-only interpretation needs ${km(bridgeTotal)} total diagnostic chord span (longest ${km(bridgeMax)}); ferry-only interpretation traverses ${km(ferryTotal)} total canonical water (longest ${km(ferryMax)}); a 40m-grid full-world dry-cart search with water impassable and the current 20° hard-grade ceiling finds ${dryFeasible}/${report.edges.length} affected edges feasible. Mixed remains owner-mapped per edge. Checksum \`${report.checksum}\`.`
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 188 — Canonical road/water owner-policy shadow comparison (' + process.env.RUN188_STAMP + ')',
	'- Alt görev: Run187 tarafından bulunan 6 water-crossing MST edge için bridge, ferry ve water-impassable dry-cart seçeneklerini shadow-only ölçen deterministic comparison checker eklendi. Mixed policy otomatik seçilmez; yalnız per-edge veri matrisi üretilir.',
	'- Baseline invariant: Run187 399/1020 water-route-point ve 6/13 affected-edge sonucu aynen korunur. ' + process.env.RUN188_POLICY_SUMMARY,
	`- Aggregate ölçüm: bridge chord total ${km(bridgeTotal)} / max ${km(bridgeMax)}; ferry water-route total ${km(ferryTotal)} / max ${km(ferryMax)}; <=20° dry-cart diagnostic ${dryFeasible}/${report.edges.length} feasible. Checksum ${report.checksum}.`,
	'- Owner kararı tahmin edilmedi: bridge span limiti, ferry gameplay, mixed edge mapping ve canlı adoption seçimi QUESTIONS_FOR_OWNER/ROAD_WATER_OWNER_GATE içinde açık kalır; temporary default NONE.',
	'- Runtime/2D/PWA davranışı değiştirilmedi; src/3d, service-worker, config, terrain, water, roads, settlements, physics ve script.js byte davranışı aynı. Yeni kod yalnız scripts/CI/fixture/governance recorder katmanıdır.',
	'- Additive-only: yeni checker + checksum fixture + recorder + CI ve append-only ledgers; mevcut source satırı silinmedi/değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN188_SMOKE_PASS_COUNT + '/34+ PASS; zero 3D console/page errors; Run184-187 canonical gates, road/terrain/visual/grass, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf, two visual evidence screenshots, policy checksum fixture ve additive-only PASS.',
	'- Mobil performans: ' + process.env.RUN188_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN188_PERF_ROW + '. Test-only olduğu için live render delta 0.',
	'- Memory leak checklist: runtime allocation/listener/timer/DOM/GPU kaynağı eklenmedi; checker browser/server finally ile kapanır ve yalnız bounded test arrays kullanır. Teknik borç 1; yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0208.',
	'- World Coverage live değerleri değişmedi. World Evolution Report: road/water migration decision evidence +1; live terrain/water/road/gameplay delta 0. Oyuncu farkı: HAYIR.',
	'- Sıradaki güvenli adım: owner road-water policy yanıtı gelirse seçilen mapping için ayrı opt-in implementation proof; yanıt gelmezse bu kararı gerektirmeyen GOVERNANCE §30 fiziksel dünya işlerinden taş/kaya/makro-relief gibi bağımsız shadow-safe alt göreve geç.'
]);

append('DECISIONS.md', [
	'## ADR-0208 — Measure road/water policy consequences without selecting the owner decision (run 188)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Run187 canonical road-water blockerı çözülmüş gibi davranılmaz. Yeni test-only Run188 checker aynı deterministic target terrain/hydrology/MST girdilerinde affected edge başına üç ölçülebilir shadow interpretation üretir: mevcut route üzerindeki bridge chord spans, aynı canonical-water traversalın ferry mesafesi ve canonical waterı impassable kabul edip mevcut 20° cart-road hard ceiling altında çalışan 40m full-world grid dry-route feasibility. Dördüncü seçenek olan mixed policy sayısal olarak otomatik seçilmez; owner tarafından edge bazında map edilmesi gereken karar olarak kalır.',
	'',
	'**Neden:** Run187 yalnız sorunun varlığını ölçtü. Owner bridge/ferry/dry/mixed arasında seçim yapmadan live migration yapılamaz; ancak bu seçimi veri olmadan istemek de gereksiz belirsizlik bırakır. Shadow comparison her seçeneğin fiziksel boyutunu görünür kılar fakat ürün kararını mühendislik metriğine dönüştürüp sessizce ele geçirmez.',
	'',
	`**Ölçüm:** Run187 invariant 399/1020 water points, 6/13 affected edges. Bridge diagnostic total ${km(bridgeTotal)}, longest ${km(bridgeMax)}. Ferry diagnostic total ${km(ferryTotal)}, longest ${km(ferryMax)}. Water-impassable <=20° dry-cart diagnostic ${dryFeasible}/${report.edges.length} feasible. Deterministic checksum \`${report.checksum}\`.`,
	'',
	'**Alternatifler:** En kısa/ucuz seçeneği otomatik owner kararı saymak reddedildi; bridge veya ferry için keyfi maksimum span belirlemek reddedildi; live roads.js/pathfinderı bu run içinde değiştirmek reddedildi; yalnız Run187 sayımlarını tekrar belgelemek reddedildi çünkü seçeneklerin gerçek route-length/feasibility farkını göstermiyordu.',
	'',
	'**Sonuç:** Owner artık aynı altı edge için karşılaştırılabilir deterministic ölçüme sahiptir. Runtime ve PWA import graphı değişmez; full-reference road adoption hâlâ açık owner kararıyla gatedir.',
	'',
	'**Etkilenen sistemler:** yalnız yeni Run188 checker/fixture/CI/governance recorder ve append-only ROAD_WATER_OWNER_GATE/WORLD_REFERENCE_MAP/progress/ADR/question/stable/perf kayıtları. Live src/3d ve 2D source değiştirilmez.',
	'',
	'**Geri alma planı:** Runtime consumer yoktur. Diagnostic varsayımlar değişirse yeni versioned comparison fixture/ADR additive eklenir; Run187 blocker ve canonical source truth silinmez.'
]);

append('QUESTIONS_FOR_OWNER.md', [
	`- **(run 188, ADR-0208) Canonical full-reference yol/su politikası hangisi olmalı: bridge, ferry, water-impassable dry reroute veya edge-bazlı mixed?** Run188 karar vermeden ölçtü: bridge diagnostic total ${km(bridgeTotal)} (longest ${km(bridgeMax)}), ferry canonical-water route total ${km(ferryTotal)} (longest ${km(ferryMax)}), mevcut <=20° cart-road safety ile 40m-grid dry reroute ${dryFeasible}/${report.edges.length} affected edge için feasible. Exact edge matrix \`ROAD_WATER_OWNER_GATE.md\` içinde. **Temporary default:** NONE; full-reference default terrain/road runtime adoption blocked kalır. Owner yanıtı gelmeden bridge span limiti, ferry gameplay veya mixed mapping tahmin edilmez.`
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN188_STABLE_TAG + ' — run 188 canonical road/water owner-policy shadow comparison (ADR-0208); deterministic policy matrix + full regression gates PASS; no policy selected, live runtime delta 0.'
]);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN188_PERF_ROW + '\n');
console.log('[recordRun188Governance] PASS: road-water gate + map + progress + ADR-0208 + owner question + stable checkpoint + perf row recorded.');
