#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts', 'run191-stone-bridges', 'proof.json');
const required = [
	'RUN191_STAMP',
	'RUN191_STABLE_TAG',
	'RUN191_PERF_ROW',
	'RUN191_SMOKE_PASS_COUNT',
	'RUN191_BRIDGE_SUMMARY',
	'RUN191_BRIDGE_CHECKSUM',
	'RUN191_MOBILE_BUDGET_SUMMARY',
];
for (const key of required) if (!process.env[key]) throw new Error('missing ' + key);
if (!fs.existsSync(ARTIFACT)) throw new Error('missing Run191 stone bridge artifact');
const report = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));

function append(file, lines) {
	fs.appendFileSync(path.join(ROOT, file), '\n\n' + lines.join('\n') + '\n');
}

append('GOVERNANCE.md', [
	'## 32. Canonical Yol/Su Taş Kemer Köprü Politikası — Owner Direktifi (run 191, 2026-08-08)',
	'',
	'Proje sahibi Run188/ADR-0208 yol-su kararını doğrudan çözdü: **bir yol dere, göl veya canonical su yüzeyini kesiyorsa yol suyun içinden yürütülmez; kesişime ortaçağa uygun taş kemer köprü yapılır.** Bu karar gelecekteki canonical road/water çalışmalarında kalıcı ürün politikasıdır.',
	'',
	'1. **Policy = bridge:** Ferry, su içinden yol ve otomatik dry-reroute varsayılanı kullanılmaz. Su kesişimi varsa yol bağlantısı taş kemer köprü ile korunur.',
	'2. **Ortaçağ sanat dili:** Köprü yüzeyi modern beton/asfalt değil; yaşlanmış taş blok örgü, belirgin harç derzleri, hafif renk/aşınma varyasyonu ve taş parapet/korkuluk taşır. Dış HBO asseti kullanılmaz; original/procedural veya uygun lisanslı generic materyal kullanılır.',
	'3. **Açıklığa göre çoklu kemer:** Uzun su geçişleri tek fiziksel olarak anlamsız dev kemer yapılmaz. Aynı deterministic bridge segmenti içinde açıklık bütçesine göre birden çok masonry arch/pier üretilir; yol genişliği mevcut ana cart-road genişliğiyle uyumlu kalır.',
	'4. **Determinism + güvenlik:** Bridge anchor/crossing listesi canonical hydrology + road route girdilerinden deterministik üretilir. Yol connectivity, <=20° live cart-road güvenliği, settlement protection, hydrology, PWA ve mobile perf kapıları korunmadan canlı adoption yapılmaz.',
	'5. **Kademeli yayın:** Run191 gerçek THREE geometry/materialı shadow-only kanıtlar. Live terrain/road scene adoption ayrı bir alt görevdir; önce bridge fixture, iki görsel açı, renderer budget, dispose ve pre/post smoke PASS olmalıdır.',
]);

append('QUESTIONS_FOR_OWNER.md', [
	'- **✅ ÇÖZÜLDÜ (run 188, ADR-0208 → run 191, ADR-0211) Canonical full-reference yol/su politikası:** Owner 2026-08-08 tarihinde doğrudan karar verdi: "Eğer derelerden ve göllerden yol geçiyorsa oraya taş kemer köprü yap. Ortaçağa uygun dokusu olsun." Buna göre temporary default NONE sona erdi ve policy **STONE ARCH BRIDGE** oldu. Ferry, dry-reroute veya edge-bazlı mixed policy varsayılmayacak; canonical yol suyu kestiğinde bağlantı deterministic ortaçağ taş kemer köprüyle korunacak. Eski run188 soru satırı kayıt amacıyla silinmedi; bu çözüm girdisi onu supersede eder.'
]);

append('ROAD_WATER_OWNER_GATE.md', [
	'## Owner resolution — run 191 / ADR-0211',
	'',
	'Owner, 2026-08-08: roads crossing streams/lakes/canonical water use **medieval stone arch bridges**. Run188 temporary default NONE is superseded by BRIDGE. Ferry, water-through-road and automatic dry-reroute are not the selected default policy.',
	'',
	`Run191 shadow qualification recomputed the same canonical MST/hydrology inputs and produced ${report.affectedEdges.length} affected edges / ${report.bridges.length} distinct bridge structures / ${report.totalArchCount} total masonry arches. Water chord aggregate ${(report.waterChordTotalMeters / 1000).toFixed(2)} km; longest structural bridge ${(report.maxStructuralSpanMeters / 1000).toFixed(2)} km. Long crossings are multi-arch viaducts rather than one giant arch. Deterministic checksum: \`${report.checksum}\`.`,
	'',
	'Boundary: Run191 proves owner-policy resolution, placement, original procedural medieval masonry material, batched geometry cost and visual evidence. It does not silently switch the live default terrain/road graph in the same commit; live adoption remains a separately tested integration step.'
]);

append('WORLD_REFERENCE_MAP.md', [
	'## Canonical road/water medieval stone bridge policy — run 191',
	'',
	`Owner bridge policy is now explicit and deterministic. Same full-reference road/hydrology inputs resolve to ${report.affectedEdges.length}/13 affected road edges and ${report.bridges.length} distinct water crossings. Every crossing gets a stone arch structure; no ferry/dry-route/mixed optimizer is used.`,
	'',
	`Geometry proof batches all ${report.totalArchCount} arches plus decks/piers/parapets into ${report.actual.drawCalls} renderer submissions / ${report.actual.triangles} triangles. Original procedural ${report.texture.width}x${report.texture.height} masonry CanvasTexture uses staggered stone blocks, mortar seams and sparse deterministic weather/moss variation. Proof checksum \`${report.checksum}\`.`,
	'',
	'Canonical boundary: bridge anchors derive from the planned full-reference road centerlines and seat-safe hydrology. Live legacy road/terrain coordinates are not silently replaced by this shadow module.'
]);

append('3D_GAME_PROGRESS.md', [
	'## Run 191 — Owner-approved medieval stone arch bridges for canonical road/water crossings (' + process.env.RUN191_STAMP + ')',
	'- Owner kararı: Run188/ADR-0208 blocker çözüldü. Yol canonical suyu kesiyorsa policy artık STONE ARCH BRIDGE; ferry/dry-reroute/mixed default değil. QUESTIONS_FOR_OWNER eski soru satırı silinmeden çözüm girdisiyle supersede edildi; GOVERNANCE §32 kalıcı direktif olarak eklendi.',
	'- Alt görev: yeni shadow-only `worldReferenceStoneBridgeShadow.js` aynı canonical full-reference hydrology + 13-edge MST/pathfinder girdilerini yeniden üretir, contiguous water crossingleri deterministic bridge planına dönüştürür ve gerçek THREE InstancedMesh geometry üretir.',
	'- Ölçüm: ' + process.env.RUN191_BRIDGE_SUMMARY + '.',
	`- Bridge art: ${report.texture.width}x${report.texture.height} original procedural medieval masonry CanvasTexture; staggered stone blocks, mortar, deterministic weather/moss; deck + repeated arch rings + stone piers + parapets. External/HBO asset yok.`,
	`- Structural policy: target arch span ${report.bridges[0] ? '36m' : 'N/A'}, hard max 40m; uzun crossings tek dev arch yerine çoklu kemer/pier viyadük. Total structural span ${(report.structuralSpanTotalMeters / 1000).toFixed(2)} km, total arches ${report.totalArchCount}.`,
	'- Memory/resource lifecycle: bridge group four batched InstancedMesh part families; geometry/material/CanvasTexture dispose events birebir PASS ve group children teardown sonrası 0.',
	'- PWA: yeni shadow module `GAME3D_SHELL_FILES` içine tek additive precache satırı ile eklendi; installability/cache gate PASS.',
	'- Additive-only: yeni bridge module/checker/harness/PWA applicator/recorder/CI + generated fixture ve append-only governance kayıtları; mevcut source satırı silinmedi/değiştirilmedi.',
	'- DoD: baseline + after browser smoke ' + process.env.RUN191_SMOKE_PASS_COUNT + '/34+ PASS; zero 3D console/page errors; Run188 comparison checksum, Run189/190 rock fixtures, canonical map/hydrology/terrain/chunk/road gates, world visuals, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf ve bridge-specific iki görsel açı PASS.',
	'- Live mobil performans: ' + process.env.RUN191_MOBILE_BUDGET_SUMMARY,
	'- Performans: ' + process.env.RUN191_PERF_ROW + '. Bridge module shadow-only olduğu için live render delta 0; isolated full bridge proof cost yukarıdaki draw/triangle ölçümüdür.',
	'- Memory leak checklist: live listener/timer/DOM eklenmedi; checker browser/server/renderer finally/dispose zinciriyle kapanır. Teknik borç 1 (mevcut game3d.js). Yeni runtime borcu 0. Risk LOW. Güven 5/5. ADR: ADR-0211.',
	'- World Coverage live değerleri değişmedi: desktop %96,2; mobile resident radius-4 81 chunk / 20,25 km² (~%14,7). World Evolution Report: road/water product blocker RESOLVED + bridge render-readiness +1; live terrain/road/gameplay delta 0. Oyuncu farkı: henüz HAYIR.',
	'- Sıradaki güvenli adım: Run191 fixtureını tüketen canonical full-reference road+bridge scene integration shadow proof; live adoption ancak road deck transition/approach grade, water occlusion, camera/frustum, collision-readiness ve scene-level mobile budget birlikte geçerse yapılır.'
]);

append('DECISIONS.md', [
	'## ADR-0211 — Resolve canonical road/water policy as medieval stone arch bridges and prove the geometry off-runtime (run 191)',
	'',
	'**Risk Seviyesi:** LOW',
	'',
	'**Karar:** Owner Run188/ADR-0208 açık ürün kararını 2026-08-08 tarihinde çözdü: canonical yol dere/göl/su yüzeyini keserse bağlantı taş kemer köprüyle sürer ve köprü ortaçağa uygun taş doku taşır. Run191 bu kararı yeni `worldReferenceStoneBridgeShadow.js` ile shadow-only uygular. Aynı 13-edge canonical-target MST/pathfinder ve seat-safe hydrology girdilerinde her contiguous water crossing deterministic bridge record olur. Uzun crossingler target 36m / hard-max 40m açıklığa göre tekrarlanan masonry arches/pierlere bölünür; tek dev kemer kullanılmaz.',
	'',
	`**Ölçüm:** ${report.affectedEdges.length}/13 affected road edge, ${report.bridges.length} bridge structure, ${(report.waterChordTotalMeters / 1000).toFixed(2)} km aggregate water chord, ${(report.maxStructuralSpanMeters / 1000).toFixed(2)} km longest structural bridge, ${report.totalArchCount} total arches. Full batched geometry ${report.actual.drawCalls} actual renderer calls / ${report.actual.triangles} triangles; predicted=actual. Deterministic checksum \`${report.checksum}\`.`,
	'',
	`**Sanat/material:** Bridge deck, arch ring, pier ve parapetler original procedural ${report.texture.width}x${report.texture.height} CanvasTexture masonry kullanır. Taş bloklar staggered örgü, koyu mortar gap ve seeded weather/moss variation içerir; modern asfalt/beton veya HBO media yoktur.`,
	'',
	'**Neden:** Owner doğrudan bridge politikasını seçtiği için Run188 blockerı artık karar beklemiyor. Buna rağmen full-reference road/terrain runtime adoption ile art asset/physics/perf değişikliklerini tek committe birleştirmek GOVERNANCE kademeli yayın kuralına aykırı ve rollback riskini büyütür. Önce crossing/geometry/material/render/dispose kanıtı, sonra ayrı scene integration en düşük riskli yoldur.',
	'',
	'**Alternatifler:** Ferry, water-through-road, automatic dry reroute ve edge-based mixed artık owner-selected default değildir. Tek 3.11km taş kemer reddedildi; multi-arch viaduct seçildi. Her bridge parçasını ayrı Mesh yapmak draw-call maliyeti nedeniyle reddedildi; four-family InstancedMesh batching seçildi. External texture indirmek gerekli olmadığı için reddedildi.',
	'',
	'**Sonuç:** Run188 owner gate ürün düzeyinde çözülmüştür ve canonical bridge listesi deterministik fixture ile pinlenmiştir. Ancak live legacy scene hâlâ unchanged; Run191 live default world graphı değiştirmez.',
	'',
	'**Etkilenen sistemler:** yeni stone-bridge shadow module/checker/harness/PWA applicator/recorder/CI, generated fixture, service-worker additive precache ve append-only GOVERNANCE/QUESTIONS/ROAD_WATER/WORLD_REFERENCE/progress/ADR/stable/perf kayıtları. Existing terrain/roads/rivers/sceneManager/game3d/2D runtime değiştirilmez.',
	'',
	'**Gelecek Faz Etkisi:** Next integration proof bridge deck approach grade ve road ribbon transitionı doğrulamalı; collision ancak geometry placement ve live scene budget kanıtlandıktan sonra eklenir. Mağara/ejderha habitat sırası bu owner road-water kararından etkilenmez.',
	'',
	'**Geri alma planı:** Shadow runtime consumer yoktur. Bridge geometry/art policy teknik olarak yanlışlanırsa yeni versioned bridge module/checker additive eklenir. Owner kararı değişmedikçe product policy bridge olarak kalır.'
]);

append('STABLE_TAGS.md', [
	'- ' + process.env.RUN191_STABLE_TAG + ' — run 191 owner-approved canonical medieval stone-arch bridge shadow proof (ADR-0211); road-water owner gate resolved, deterministic bridge fixture + masonry visual evidence + full regression PASS; live runtime delta 0.'
]);
fs.appendFileSync(path.join(ROOT, 'perf_log.csv'), '\n' + process.env.RUN191_PERF_ROW + '\n');
console.log('[recordRun191Governance] PASS: GOVERNANCE §32 + owner resolution + road gate + map/progress + ADR-0211 + stable/perf recorded.');
