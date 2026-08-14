#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
};
const append = (file, text) => fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);

const stamp = env('RUN195_STAMP');
const stableTag = env('RUN195_STABLE_TAG');
const summary = env('RUN195_SUMMARY');
const budget = env('RUN195_BUDGET_JSON');
const liveMobile = env('RUN195_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN195_SMOKE_PASS_COUNT');
const perfRow = env('RUN195_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 195 — Opt-in canonical replacement + exact rollback preflight (${stamp})
- Session/concurrency: started from merged Run194 main \`dc7d25d6…\` after an earlier stale Run194 attempt was correctly stopped by the remote-main gate and not published. GOVERNANCE, Run194/ADR-0214, recent commits and QUESTIONS_FOR_OWNER were re-read; no owner-pending decision was guessed.
- Alt görev: added versioned shadow-only \`worldReferenceOptInMigrationControllerShadow.js\`. It borrows current scene roots/current ground collider, detaches roots without disposal only during explicit opt-in canonical activation, routes ground queries to the Run194 clipped canonical window collider, then disposes the canonical candidate and restores the same current root identities/order plus the exact original collider on rollback. No live module imports it.
- Failure safety: unknown canonical target activation is intentionally exercised after current roots are detached; the controller restores current ownership before propagating the error. A second successful activation/rollback cycle proves the boundary is reusable rather than one-shot.
- Replacement/physics proof: one owner-approved bridge target is activated through Run194 clipped ownership; bridge deck ground precedence is confirmed through the canonical collider, then current collider identity is restored exactly. ${summary}
- Pre/post equality: deterministic current-runtime-compatible scene fixture renders byte-equivalent sampled pixel digest plus identical draw-call/triangle counts before activation and after rollback. Candidate mobile render remains below hard budget. Budget: ${budget}.
- Live regression: baseline/after full browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Live mobile remains ${liveMobile}; Run195 has zero default runtime draw/triangle cost because it is unimported shadow tooling.
- PWA/cache: new shadow controller receives one additive GAME3D_SHELL_FILES entry; existing cache entries are unchanged.
- Memory/technical debt: canonical window resources are disposed on each rollback; controller owns no current resources and never disposes borrowed roots/collider. Proof renderer/current fixture resources are disposed. Existing \`game3d.js\` structural debt remains; Run194 retained V1 tooling debt remains; new live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0215.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: reversible canonical replacement-boundary readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: controller contractını gerçek current scene ownership inventory + chunkManager streaming pause/resume semantics üzerinde ayrı opt-in integration preflight ile doğrula; default activation ancak current resourcesın dispose edilmediği, rollback sonrası streaming/input/physics state eşitliği ve pre/post live visual/perf/console gates birlikte kanıtlanırsa değerlendirilsin.`);

append('DECISIONS.md', `## ADR-0215 — Canonical migration replacement boundary must borrow current roots and restore exact identity before any default activation (run 195)

**Risk Seviyesi:** LOW

**Karar:** Canonical full-reference candidate için ilk replacement controller yalnız opt-in shadow modülüdür. Current scene rootları ve current ground collider controller tarafından ödünç alınır; canonical modda scene'den detach edilir ama dispose edilmez. Run194 clipped candidate ayrı ownership harnessıyla oluşturulur. Rollback canonical kaynakları dispose eder, current rootların aynı object identity/visibility/order durumunu ve aynı ground-collider objectini geri bağlar. Başarısız activation da current ownershipi restore etmeden hata döndüremez.

**Neden:** Run194 exact edge/window ownershipini kanıtladı fakat gerçek migration için en kritik geri dönüş sınırı current world kaynaklarının yanlışlıkla yok edilmemesidir. Live wiring yapmadan önce replacement API'nin rollback semantiği object identity seviyesinde kanıtlanmalıdır.

**Ölçüm:** İki başarılı activate→rollback cycle, bir kasıtlı başarısız activation, canonical bridge-deck collider ownershipi ve current collider identity restoration geçer. Current pre/post renderer call/triangle sayıları ve sampled framebuffer digest birebir eşittir; canonical candidate mobile hard budgetın altındadır. ${summary}

**Alternatifler:** (1) Current rootları activation sırasında dispose etmek reddedildi; rollback deterministik olamazdı. (2) Current colliderı yeni eşdeğer object ile yeniden yaratmak reddedildi; mutable runtime state kaybı riski taşır. (3) Controllerı şimdi \`game3d.js\`/\`sceneManager.js\` içine import etmek reddedildi; gerçek live ownership inventory/streaming pause-resume henüz ayrı kapıdan geçmedi. (4) Run194 closed modulesını edit etmek reddedildi; additive-only ve checkpoint sınırı korunur.

**Sonuç:** Canonical migration için reversible scene/collider ownership API şekli kanıtlandı ancak default oyuncu runtimeı değişmedi. Current world hâlâ source of truth ve startup defaultudur.

**Etkilenen sistemler:** new shadow controller/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf records. Live 2D/3D import graph unchanged.

**Gelecek Faz Etkisi:** Bir sonraki preflight gerçek current scene root inventorysini, chunk streaming pause/resume ve input/physics state restorationını bu controller şekline bağlayabilir. Bu doğrulanmadan default canonical activation yapılmaz.

**Geri alma planı:** Live consumer yoktur. Controller contractı yanlışlanırsa yeni versioned shadow controller eklenir; Run194 clipped ownership ve current runtime değiştirilmeden kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 195 opt-in canonical replacement/rollback controller shadow proof (ADR-0215); exact current root/collider restoration, failure-safe rollback, pre/post render equality and full regression PASS; live runtime delta 0.`);

console.log('[recordRun195OptInMigrationControllerShadow] PASS: Run195 governance records appended.');
