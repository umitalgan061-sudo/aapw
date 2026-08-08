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

const stamp = env('RUN198_STAMP');
const stableTag = env('RUN198_STABLE_TAG');
const summary = env('RUN198_SUMMARY');
const budget = env('RUN198_BUDGET_JSON');
const liveMobile = env('RUN198_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN198_SMOKE_PASS_COUNT');
const perfRow = env('RUN198_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 198 — Canonical pagehide teardown + clean same-page re-init lifecycle preflight (${stamp})
- Session/concurrency: started only from merged Run197 main \`0128166a…\` after re-reading GOVERNANCE, Run197/ADR-0217, Run196/ADR-0216, recent commits and QUESTIONS_FOR_OWNER; no Run198/ADR-0218 occupancy or competing Run198 branch existed. Remote main is checked before branch publication and immediately before checkpoint/PR publication.
- Alt görev: added unimported \`worldReferenceLifecycleReinitShadow.js\`. It owns one capture-phase \`pagehide\` listener and disposes the Run197 gate before unchanged \`game3d.js\` begins its existing non-capture teardown. Default \`game3d.js\`/\`game3d.html\` imports remain byte-unchanged.
- Lifecycle proof: focused Chromium runs canonical-active → real pagehide → full current teardown → same-page \`initGame3D()\` again → a second canonical-active → pagehide teardown. ${summary}
- Leak/identity safety: both lifecycle generations end with zero tracked RAF callbacks, no cumulative connected DOM/window listener growth, no cumulative EventBus subscription growth, stable timer/interval baseline, exact restoration of Run197-wrapped update methods before current teardown, and fresh scene/renderer/player/input/controller identities on generation 2. Current scene geometry/material disposal coverage is verified for both generations; current resources are not disposed by canonical ownership before pagehide.
- Render proof: first-generation current/canonical and second-generation fresh-current submission snapshots remain deterministic within their contracts. Focused budget: ${budget}. Two visual angles are retained as artifacts, including fresh-current normal view and F4 wide view after re-init.
- Live regression: baseline/after browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Existing mobile budget remains ${liveMobile}; Run198 adds zero default-runtime render cost because the lifecycle coordinator has no live consumer.
- PWA/cache: one additive GAME3D_SHELL_FILES entry is appended for the Run198 shadow module; cache/installability guards pass.
- Memory/technical debt: lifecycle coordinator owns one explicitly removable once+capture listener and no timer/DOM/GPU allocation. \`game3d.js\` remains 547/600; \`worldReferenceSceneShadowAdapter.js\` remains 562/600; neither grows. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0218.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical replacement lifecycle-readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical startup hâlâ otomatikleştirilmez. Ayrı, açıkça developer-only bir gerçek entry point ile Run195-198 zincirini test-source injection olmadan çalıştır; startup başarısızlığında current world fallback ve gerçek navigation/pagehide geri dönüşünü kanıtla. Bu opt-in entry point geçmeden mevcut \`game3d.html\` source-of-truth değiştirilmez.`);

append('DECISIONS.md', `## ADR-0218 — Canonical ownership must dispose in pagehide capture phase before current runtime teardown and support a clean second init (run 198)

**Risk Seviyesi:** LOW

**Karar:** Run197 tick gate default runtimea bağlanmadan önce Run198 opt-in lifecycle coordinator ile sarılır. Coordinator \`pagehide\` olayını capture phase + once olarak dinler; canonical active ise \`gate.dispose()\` önce rollback yapıp bütün instance wrapper/streaming/current-scene ownershipini geri verir, ardından unchanged \`game3d.js\`'in mevcut non-capture pagehide cleanup zinciri current input/UI/entities/chunks/scene resources/renderer'ı dispose eder. Aynı document içinde sonradan çağrılan ikinci \`initGame3D()\` ayrı, fresh current runtime generation sayılır; önceki generation nesneleri tekrar kullanılmaz.

**Neden:** Run197 gerçek RAF tick'i güvenle freeze/resume etti ancak bir browser navigation/pagehide anında canonical wrapperlar current teardown'dan sonra kalırsa rollback resident chunk/resource invariantsını artık sağlayamaz. Capture-before-bubble sırası bunu default runtime kaynak satırı değiştirmeden, explicit preflight düzeyinde kanıtlar. Aynı-page re-init testi de teardown'ın yalnız 'sayfa zaten kapanıyor' varsayımıyla tesadüfen çalışmadığını; listener/RAF/EventBus/timer ve GPU kaynaklarının ikinci bootta kümülatif birikmediğini ölçer.

**Ölçüm:** ${summary} Focused render budget ${budget}. İki generation sonunda RAF active count sıfıra iner; post-teardown connected listener/EventBus/timer baseline generationlar arasında birebir aynı kalır. Generation-2 scene/renderer/player/keyboard/controller kimlikleri generation-1'den farklıdır. Her generationın scene geometry/material dispose gözlemleri teardown sırasında tamamlanır; Run197 canonical intervalinde borrowed-current dispose sayısı sıfır kalır. F4 ikinci initte yeniden çalışarak keyboard/debug listener zincirinin temiz yeniden kurulduğunu ayrıca kanıtlar.

**Alternatifler:** (1) Gate'i game3d pagehide cleanup'ından sonra dispose etmek reddedildi; Run196 rollback chunk/resource invariantsı teardown tarafından önceden bozulabilir. (2) Mevcut game3d.js pagehide bloğunu şimdi düzenlemek reddedildi; additive-only kuralını ve shadow preflight ile live adoptionı tek adımda birleştirirdi. (3) RAF'ı pagehide öncesi test harnessinden doğrudan iptal etmek reddedildi; gerçek current cleanup'ın kendi \`cancelAnimationFrame\` sorumluluğunu kanıtlamazdı. (4) Browser'ı tamamen kapatıp leak sonucunu yalnız process teardown'a bırakmak reddedildi; ikinci initte birikimi ölçemezdi. (5) Prototype/global subsystem patch reddedildi; Run197'nin instance-only sınırı korunur.

**Sonuç:** Canonical-active transaction gerçek pagehide sınırında current teardown'dan önce güvenle çözülüyor; unchanged runtime aynı documentte ikinci kez temiz current state kurabiliyor ve ikinci teardown aynı leak baselineına dönüyor. Run198 default oyuncu runtimeını hâlâ değiştirmez.

**Etkilenen sistemler:** new Run198 lifecycle shadow/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf. Existing \`game3d.js\`, \`game3d.html\`, gameplay/input/UI modules and Run195-197 runtime-shadow modules unchanged.

**Gelecek Faz Etkisi:** Bir sonraki migration kapısı test-only HTTP source injectionını kaldırıp ayrı developer-only gerçek entry pointte aynı transaction+lifecycle zincirini çalıştırmalıdır. Current fallback ve gerçek navigation geri dönüşü orada kanıtlanmadan default canonical startup değerlendirilmez.

**Geri alma planı:** Live consumer yoktur. Run198 contractı yanlışlanırsa yeni versioned lifecycle coordinator eklenir; Run197/Run196/Run195/current runtime byte-unchanged kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 198 canonical pagehide + clean re-init lifecycle preflight (ADR-0218); capture-before-current teardown + two fresh runtime generations + zero cumulative RAF/listener/EventBus/timer leak + scene resource disposal + F4 re-init proof PASS; live runtime delta 0.`);

console.log('[recordRun198LifecycleReinitShadow] PASS: Run198 governance records appended.');
