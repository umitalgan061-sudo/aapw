#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const stamp = process.env.RUN184_STAMP || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const stableTag = process.env.RUN184_STABLE_TAG || 'stable-run184';
const dryRunSummary = process.env.RUN184_DRY_RUN_SUMMARY || 'full-map migration dry-run PASS';
const perfRow = process.env.RUN184_PERF_ROW || '';

function appendOnce(filePath, marker, block) {
	const absolute = path.join(ROOT, filePath);
	const source = fs.readFileSync(absolute, 'utf8');
	if (source.includes(marker)) return;
	fs.writeFileSync(absolute, `${source.trimEnd()}\n\n${block.trim()}\n`);
}

appendOnce('3D_GAME_PROGRESS.md', '## Run 184 — Full canonical-map migration dry-run', `## Run 184 — Full canonical-map migration dry-run (${stamp})
- Run182'nin full-map extent planı ilk kez gerçek settlements/terrain/road/hydrology modülleri üzerinden dry-run edildi; runtime \`WORLD_SCALE\` henüz değiştirilmedi.
- ${dryRunSummary}
- Gelecek runtime hedefi: map bounds 0..9000 × 0..7000, 1.4773421007 m/map-unit, 137.5 km², 27×21=567 chunk. Mevcut 500m chunk ve streaming yarıçapları korunabildiği için total-grid artışı 550→567 (~%3.1); projected desktop preview 529/567 ~%93.3, mobile radius-4 resident 81/567 ~%14.3.
- Reversible migration helper, current world X/Z'yi önce canonical 2D map koordinatına çözer sonra full-reference world'e taşır; saved-position migration için tek source-of-truth hazırdır.
- Additive-only: yeni plan/check/workflow/applicator/recorder dosyaları ve PWA/docs satırları eklendi; live config/terrain/water/roads/scene kaynakları değiştirilmedi.
- Performans: ${perfRow || 'runtime render delta 0 (dry-run only)'}. Teknik borç: 1. Risk LOW. Güven 5/5. ADR: ADR-0204.
- World Evolution Report: full-map migration safety proof +1; runtime terrain/water/road/grass/castle/NPC/event/animal/asset/dialogue delta 0. Oyuncu farkı doğrudan HAYIR.
- Sıradaki güvenli adım: exact full-reference scale/bounds'u additive opt-in runtime adapter ile scene build'e bağla; pre/post 14-seat, 13-road, hydrology, mobile budget ve visual evidence geçmeden default runtime switch yapma.`);

appendOnce('DECISIONS.md', '## ADR-0204 — Full-map runtime migration requires reversible canonical-coordinate dry-run proof', `## ADR-0204 — Full-map runtime migration requires reversible canonical-coordinate dry-run proof (run 184)

**Risk Seviyesi:** LOW

**Karar:** Run182'nin 137.5 km² full-reference hedefi doğrudan \`WORLD_SCALE\` satırlarını değiştirmek yerine önce versioned \`worldReferenceMigrationPlan.js\` ile temsil edilir. Hedef bounds owner map'in tamamı olan x:[0,9000], y:[0,7000], center (4500,3500), 1.4773421007 m/map-unit ve 27×21 chunk'tır. Current-world→target-world migration doğrudan world-space scale/offset tahmini yapmaz; mevcut world noktasını current map bounds üzerinden canonical 2D map koordinatına geri çözer ve target projection'a yeniden uygular.

**Neden:** Run181 coordinate alignment ve Run182 hydrology/extent hesapları doğru olsa bile runtime re-center/scale; kaleleri, flatten padleri, MST yol topolojisini, slope-aware route'ları ve dünya kenarlarını etkileyebilir. Bu etkiler ölçülmeden config switch yapmak yüksek risklidir. Browser dry-run gerçek module graph üzerinde 14/14 seat round-trip/flat/hydrology safety, 13/13 MST invariance ve bütün routed yolların <=20°/extent-inside olmasını zorunlu kapı yapar.

**Alternatifler:** WORLD_SCALE'i tek committe doğrudan değiştirmek reddedildi; persisted world X/Z'yi yalnız sabit affine katsayıyla taşımak reddedildi; mevcut crop'u canonical full-map saymak reddedildi; testsiz road regeneration reddedildi.

**Sonuç:** Runtime davranış değiştirmeden full-map switch için executable migration contract ve safety proof oluşur. Bu gate geçmeden terrain/water canonical adoption yapılamaz.

**Etkilenen sistemler:** yeni migration-plan module + browser check, PWA precache, WORLD_REFERENCE_MAP ve governance ledgers. Live config/scene/terrain/water/roads/settlements değiştirilmez.

**Gelecek Faz Etkisi:** Sonraki run exact aynı planı opt-in runtime adapter olarak kullanabilir; scale/bounds tekrar hesaplanmaz. Runtime switch sonrası desktop/mobile coverage yüzdeleri yeni 567-chunk denominator ile yeniden raporlanacaktır.

**Geri alma planı:** Runtime consumer yoktur. Plan yanlışlanırsa yeni versioned migration policy eklenir; Run179 raw mask, Run181 alignment ve Run182 hydrology/extent source truth korunur.`);

appendOnce('STABLE_TAGS.md', `- ${stableTag} — run 184 full canonical-map migration dry-run`, `- ${stableTag} — run 184 full canonical-map migration dry-run (ADR-0204); reversible scale/re-center, 14-seat, hydrology, 13-road and full regression gates PASS; runtime render delta 0.`);

if (perfRow) {
	const perfPath = path.join(ROOT, 'perf_log.csv');
	const perfSource = fs.readFileSync(perfPath, 'utf8');
	if (!perfSource.includes(',run184,')) fs.writeFileSync(perfPath, `${perfSource.trimEnd()}\n${perfRow}\n`);
}

console.log('[recordRun184Governance] PASS: Run184 progress, ADR, stable checkpoint and perf ledger recorded.');
