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
const lifecycle = env('RUN198_LIFECYCLE_JSON');
const liveMobile = env('RUN198_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN198_SMOKE_PASS_COUNT');
const perfRow = env('RUN198_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 198 — Canonical-active pagehide teardown + clean same-document re-init preflight (${stamp})
- Session/concurrency: started strictly from Run197 merge main \`0128166a…\` after re-reading GOVERNANCE, Run197/ADR-0217, recent commits and QUESTIONS_FOR_OWNER; no Run198/ADR-0218 occupancy existed. Remote main was rechecked before publication and again immediately before checkpoint publication.
- Alt görev: added only an unimported developer/preflight checker + CI/recorder. Default \`game3d.js\`, \`game3d.html\`, gameplay/world runtime, service-worker source and PWA import graph remain byte-unchanged. The checker composes the already-proven Run196+Run197 transaction around the real live state through an in-memory observation hook served only by the test HTTP server.
- Lifecycle proof: an early test-only pagehide owner is installed before runtime boot, guaranteeing canonical rollback/dispose occurs before the unchanged runtime pagehide teardown. First generation reaches canonical-active real-tick freeze, pagehide closes the transaction then tears down current runtime, the same document calls the real exported \`initGame3D()\` again with distinct scene/renderer/chunk/player identities, F4 toggles exactly once per keypress, then a second canonical-active pagehide repeats the same ordered shutdown. ${summary}
- Leak/identity proof: lifecycle counters are ${lifecycle}. Both teardown generations end with zero tracked RAF/timeout/interval handles; EventTarget listener/EventBus/3D DOM baselines are equal generation-to-generation; renderer/chunk/input/player/camera/world-event/HUD and every NPC/animal/dragon dispose path fires exactly once per generation. Second init does not reuse first scene/player/renderer/chunk-manager identity.
- Live regression: baseline/after browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Existing mobile remains ${liveMobile}. Run198 has zero live draw/triangle cost because no runtime source imports the checker.
- PWA/cache/determinism: service-worker/installability/cache, canonical world/reference, seeded determinism, accessibility/input/physics and mobile streaming/LOD/perf gates all PASS; no PWA shell line is required because Run198 adds no browser-runtime module.
- Memory/technical debt: \`game3d.js\` remains 547/600 and prior shadow modules are unchanged. Run198 adds no runtime listener/timer/DOM/GPU allocation; checker-owned instrumentation exists only inside its disposable test page. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0218.
- Perf snapshot: ${perfRow}
- World Coverage unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: lifecycle replacement-boundary readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical startup hâlâ otomatik değiştirilmesin. Run198 lifecycle kapısı geçtiği için bir sonraki adım, default \`game3d.html\` yerine ayrı opt-in developer entry pointinde canonical startup source-of-truth seçimini gerçek boot akışında kanıtlamak; current fallback/rollback yolu ve PWA offline boot aynı kanıt içinde korunmadan varsayılan oyuncu startup'ı değiştirilmez.`);

append('DECISIONS.md', `## ADR-0218 — Canonical ownership must survive ordered pagehide teardown and a clean second init before any startup source-of-truth switch (run 198)

**Risk Seviyesi:** LOW

**Karar:** Run197 tick-ownership transaction default runtime'a bağlanmadan önce developer-only browser preflightte gerçek \`pagehide\` lifecycle sınırından geçirilir. Test-only lifecycle owner runtime bootundan önce kaydolur; pagehide olduğunda canonical gate'i rollback+dispose eder, ardından mevcut \`game3d.js\`'in değişmemiş once-only teardown listener'ı current runtime kaynaklarını kapatır. Aynı document içinde gerçek exported \`initGame3D()\` ikinci kez çağrılır ve tamamen yeni current-runtime nesneleriyle temiz boot kanıtlanır. İkinci generation da canonical active→pagehide yolunu tekrarlar.

**Neden:** Run197 gerçek RAF tick altında simulation freeze/resume kanıtladı fakat navigation/lifecycle sınırı ayrı bir failure sınıfıdır: RAF/input listener sızıntısı, EventBus subscription birikmesi, iki kez F4 toggle, eski scene/resource identity reuse veya canonical gate'in already-disposed current resources üzerinde rollback denemesi ancak teardown+re-init ile görünür. İlk iki Run198 deneysel checker dalı bu test altyapısındaki iki varsayım hatasını erken yakaladı ve main'e alınmadı: async entity readiness yarışı ve aynı targetta sonradan eklenen pagehide listener'ının kayıt sırası. Final checker bu kök nedenleri çözmek için full-state readiness bekler ve lifecycle owner'ını runtime'dan önce kurar.

**Ölçüm:** ${summary} Lifecycle sayaçları ${lifecycle}. Her generation'da canonical tick pause hedeflerinin tamamı gerçek RAF tarafından çağrılıp bloklanır; pagehide başlangıcında mode \`canonical\`dır. Lifecycle order logunda \`gate-dispose\`, \`runtime-renderer-dispose\`dan önce gelir. Runtime teardown renderer/chunk/input/player/controls/free-camera/world-event/HUD ve tüm entity dispose yollarını tam bir kez çağırır. Her teardown sonunda tracked RAF/timeout/interval sayıları 0'dır. İkinci boot first-generation scene/player/renderer/chunk-manager nesnelerini reuse etmez. F4 ilk keydown'da true, ikinci keydown'da false olur; duplicate key listener yoktur. İki generation'ın active ve teardown EventTarget/EventBus/DOM imzaları birbirine eşittir; console/page error 0.

**Alternatifler:** (1) Gerçek navigation ile yeni document açmak tek başına reddedildi; document GC'si same-document duplicate-listener/re-init problemlerini maskeleyebilir. (2) Yalnız unit-level \`dispose()\` çağrıları reddedildi; gerçek pagehide listener sırasını doğrulamaz. (3) Default \`game3d.html\` importlarını şimdi değiştirmek reddedildi; lifecycle kanıtından önce ürün yolunu etkilerdi. (4) Canonical gate'i runtime teardown'dan sonra dispose etmek reddedildi; zaten dispose edilmiş borrowed current scene üzerinde rollback riski taşır. (5) Sonradan eklenen capture listener'a güvenmek reddedildi; aynı target üzerindeki listener registration ordering'i güvenli lifecycle ownership kontratı değildir.

**Sonuç:** Run196+Run197 canonical transaction gerçek lifecycle sınırında iki ardışık generation boyunca temiz kapanıp yeniden başlayabiliyor. Bu yalnız migration readiness kanıtıdır; default oyuncu runtime davranışı Run198'de değişmez.

**Etkilenen sistemler:** new Run198 checker/workflow/recorder; append-only progress/ADR/stable/perf. Existing runtime JS/HTML/CSS/service-worker, Run197/196 shadows, gameplay/world modules unchanged.

**Gelecek Faz Etkisi:** Sıradaki migration preflight ayrı opt-in developer startup entry pointinde canonical source-of-truth'u boot anından seçebilir. Current fallback ve offline/PWA boot eşdeğerliği kanıtlanmadan default \`game3d.html\` startup değişmez.

**Geri alma planı:** Live consumer yoktur. Run198 checker/CI kaldırılmadan da runtime etkisi sıfırdır; contract yanlışlanırsa yeni versioned checker eklenir, current runtime ve Run197/Run196 byte-unchanged kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 198 ordered canonical-active pagehide + same-document clean re-init preflight (ADR-0218); two lifecycle generations + gate-before-runtime teardown + exact single-dispose paths + zero RAF/timeout/interval leak + listener/EventBus/DOM baseline equality + distinct runtime identities + single F4 toggle + zero console error PASS; live runtime delta 0.`);

console.log('[recordRun198CurrentLifecycleReinitShadow] PASS: Run198 governance records appended.');
