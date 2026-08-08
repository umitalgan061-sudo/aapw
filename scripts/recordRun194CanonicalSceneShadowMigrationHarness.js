#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const readEnv = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
};
const append = (file, text) => fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);

const stamp = readEnv('RUN194_STAMP');
const stableTag = readEnv('RUN194_STABLE_TAG');
const summary = readEnv('RUN194_SUMMARY');
const budget = readEnv('RUN194_BUDGET_JSON');
const liveMobile = readEnv('RUN194_LIVE_MOBILE_JSON');
const smokePassCount = readEnv('RUN194_SMOKE_PASS_COUNT');
const perfRow = readEnv('RUN194_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 194 — Canonical scene migration ownership + 27x21 edge harness (${stamp})
- Session/concurrency: started from merged Run193 main \`62387c23…\`; GOVERNANCE.md, Run193 progress/ADR, QUESTIONS_FOR_OWNER.md and recent commits were re-read. Run193's explicit next safe step was selected; owner-pending calibration/design items were not guessed.
- Alt görev: added shadow-only \`worldReferenceSceneShadowMigrationHarness.js\`, wrapping the closed Run193 adapter rather than editing it. The wrapper constrains terrain residents to the planned 27x21 full-reference chunk grid and exposes deterministic ownership helpers; live \`game3d\`, \`sceneManager\`, \`chunkManager\`, terrain, road and physics consumers remain unwired.
- Full-grid ownership: every planned chunk is reachable (567/567). Mobile radius-2 ownership is bounded to 9 chunks at corners, 15 on non-corner edges and 25 in the interior; no out-of-grid terrain chunk survives the migration wrapper.
- All-bridge ownership: all 7 owner-approved Run191 stone bridges are selected by their own mobile anchored window and each resulting terrain resident set stays within the planned grid. Existing 7 bridges / 177 arches, 399/399 water-route suppression, 14 approaches and Run190 rock-clearance invariants remain delegated to the Run193 adapter and rerun in CI.
- Visual DoD: two 1440x900 world-edge screenshots (northwest and southeast corners) plus \`proof.json\`. ${summary}
- Candidate edge render budget: ${budget}. Live mobile baseline remains ${liveMobile}; Run194 is shadow-only and adds zero live runtime draw/triangle cost.
- DoD: syntax/additive-only, Run193 canonical scene proof, canonical map/hydrology/migration/terrain/chunk/road/world visuals, determinism/assets/PWA/cache, a11y/input/physics, mobile streaming/LOD/perf and baseline+after browser smoke ${smokePassCount}+ PASS; 3D console/page errors 0.
- PWA/cache: the new shadow harness receives one additive \`GAME3D_SHELL_FILES.push(...)\` entry; no existing cache line is removed or changed.
- Memory leak checklist: out-of-grid terrain meshes are removed and disposed immediately; every bridge/edge proof window is fully disposed through the Run193 lifecycle; renderer canvas is removed. Teknik borç 1 (existing \`game3d.js\` structural debt), new live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0214.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical migration edge/ownership readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: explicit replacement lifecycle + physics ownership + rollback semantics için ayrı shadow migration orchestrator proof oluştur; current live scene ile canonical candidate arasında gerçek runtime switch ancak pre/post browser visual, console, PWA/cache and perf gates aynı değişiklikte geçerse değerlendirilsin.`);

append('DECISIONS.md', `## ADR-0214 — Full-reference candidate terrain ownership is clipped to the planned 27x21 grid in a shadow migration wrapper (run 194)

**Risk Seviyesi:** LOW

**Karar:** Run193 \`worldReferenceSceneShadowAdapter.js\` kapalı/kanıtlanmış bir kontrat olarak değiştirilmez. Yeni \`worldReferenceSceneShadowMigrationHarness.js\`, Run193 window'unu oluşturduktan sonra yalnız planlanan centered 27x21 chunk gridinin dışındaki terrain meshlerini scene'den çıkarıp derhal dispose eder. Aynı modül saf ownership çözümleyicisiyle 567 planned chunkın tamamını ve mobile radius-2 edge davranışını deterministik olarak tanımlar.

**Neden:** Run193 adapter'ının terrain-window fonksiyonu doğal olarak 5x5 kare üretir ve world edge'de planlanan full-reference grid dışına taşabilir. Bunu mevcut satırları değiştirerek düzeltmek additive-only guard ile çelişir ve kapanmış Run193 proof yüzeyini yeniden açardı. Versioned wrapper, edge semantiğini ayrı rollback sınırında kanıtlar.

**Ölçüm:** 27x21 = 567 planned chunkın 567/567'si reachable; mobile resident count corner=9, non-corner edge=15, interior=25. 7/7 owner-approved bridge kendi anchored windowunda resident. Northwest ve southeast gerçek THREE renderları mobile <500 draw-call / <500K triangle bütçesi içinde kalır. ${summary}

**Alternatifler:** (1) Run193 adapter satırlarını edit etmek reddedildi: additive-only ihlali + kapanmış adapterı yeniden büyütme riski. (2) Out-of-grid chunkları üretmeye devam edip sadece görünmez yapmak reddedildi: GPU/CPU residency gerçek ownership proof olmaz. (3) Canlı \`chunkManager\`a hemen bounds eklemek reddedildi: shadow edge contractı ve rollback kanıtlanmadan high-impact runtime migration olurdu.

**Sonuç:** Canonical scene candidate artık yalnız local bounded window değil, full planned gridin sınırlarında deterministik ve dispose-safe ownership semantiğine de sahip. Live world byte-equivalent kalır.

**Etkilenen sistemler:** yeni shadow migration wrapper/checker/PWA applicator/CI/recorder; additive service-worker precache line; append-only WORLD_REFERENCE_MAP/progress/ADR/stable/perf kayıtları. Live 2D/3D runtime consumer yok.

**Gelecek Faz Etkisi:** Bir sonraki migration proof explicit current-scene replacement lifecycle, player/bridge ground ownership ve rollback sırasını bu bounded wrapper üzerinde sınayabilir. Bu ADR asset, gameplay, quest veya biome tasarımı belirlemez.

**Geri alma planı:** Live consumer yoktur. Edge ownership kontratı yanlışlanırsa yeni versioned wrapper/checker eklenir; Run193 adapter ve current runtime değiştirilmeden kalır.`);

append('WORLD_REFERENCE_MAP.md', `## Planned full-reference chunk ownership edge contract — run 194

Run194 keeps the Run193 scene adapter unchanged and adds a shadow-only migration wrapper that clips terrain residency to the planned centered 27x21 chunk grid. All 567 planned chunk centers are reachable. A mobile radius-2 window owns 9 chunks at a corner, 15 along a non-corner edge and 25 in the interior; out-of-grid terrain meshes are removed and disposed rather than retained invisibly.

All 7 owner-approved stone bridges are covered by their own anchored mobile window under the same bounded ownership contract. Northwest and southeast edge windows were rendered as independent visual evidence and disposed completely. No live scene/chunk/physics consumer imports the wrapper.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 194 canonical 27x21 world-edge + all-7 bridge migration ownership shadow proof (ADR-0214); bounded edge residency, disposal, full regression and PWA/perf gates PASS; live runtime delta 0.`);

console.log('[recordRun194CanonicalSceneShadowMigrationHarness] PASS: Run194 governance records appended.');
