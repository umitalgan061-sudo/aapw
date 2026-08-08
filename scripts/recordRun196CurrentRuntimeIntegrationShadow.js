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

const stamp = env('RUN196_STAMP');
const stableTag = env('RUN196_STABLE_TAG');
const summary = env('RUN196_SUMMARY');
const budget = env('RUN196_BUDGET_JSON');
const liveMobile = env('RUN196_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN196_SMOKE_PASS_COUNT');
const perfRow = env('RUN196_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 196 — Real current-runtime ownership + streaming/input/physics rollback integration preflight (${stamp})
- Session/concurrency: detected that a parallel session had already merged Run195/PR #75, so Run195 was not duplicated. Work started only after re-reading GOVERNANCE, Run195/ADR-0215, QUESTIONS_FOR_OWNER, current source APIs and confirming no Run196 branch/occupancy. Base main: \`81434839…\`.
- Alt görev: added unimported, versioned \`worldReferenceCurrentRuntimeIntegrationShadow.js\`. It inventories every real \`createScene()\` direct current-world root plus every resident ChunkManager terrain mesh and player/real-castle roots. Run180 wind grass is a separate direct scene root and is explicitly borrowed; a final scene-child sweep prevents future non-light world roots from escaping ownership. Only sun/hemisphere lights remain transaction infrastructure.
- Streaming boundary: only the current ChunkManager instance receives a reversible opt-in \`streamTowards\` pause wrapper while canonical mode is active. Existing \`streamAroundOrbitTarget\` is exercised unchanged; its request is blocked with zero resident/cumulative current-world mutation. Rollback restores the exact original method identity and the saved \`lastStreamChunk\`; a later real streaming request generates new chunks again.
- Input/physics boundary: canonical mode returns inert frozen keyboard axes and blocks the preflight current-player update entry point without consuming held input. Rollback preserves KeyboardInput identity/held W+Shift state, reopens player update, restores the current ground-collider object identity and the exact player/camera/controls transform snapshot. ${summary}
- Resource ownership: current resources are instrumented through actual Three.js geometry/material dispose events. Canonical activate→rollback emits zero current-resource disposal events; only canonical-owned resources are disposed. Current scene child identity/order, including Run180 grass identity, is restored exactly.
- Visual oracle correction: two early proof attempts correctly rejected byte-different full-scene frames. Focused isolation proved the difference is expected Run180 wind grass behavior: its \`onBeforeRender\` writes \`performance.now()\` into the wind shader. Therefore full current scene uses exact pre/post draw-call/triangle equality plus screenshots, while the deterministic visual oracle temporarily excludes only the borrowed Run180 grass root and must be byte-exact before/after rollback. The grass contribution is independently pinned at +1 draw call/+24,000 triangles on mobile. Canonical near/far remain below mobile hard budget. Budget: ${budget}.
- Live regression: baseline/after browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Existing live mobile remains ${liveMobile}; Run196 has zero default runtime draw/triangle cost because no live module imports it.
- PWA/cache: one additive GAME3D_SHELL_FILES entry is appended for the new shadow module; existing entries remain intact.
- Memory/technical debt: Run193 adapter remains closed at 562/600; game3d.js remains 547/600. Run194 retained V1 shadow debt remains. Focused Run196 diagnostic tooling remains as regression evidence for the time-varying grass qualification. Run196 owns no borrowed current resources; its instance pause wrapper is restored on rollback/dispose. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0216.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: real-current runtime transaction readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical switch yapma. Run196 transaction boundarysini ayrı, açıkça opt-in bir developer/preflight entry pointinde gerçek game tick ownershipine bağla; player/NPC/animal/dragon/world-event update zincirinin canonical modda durduğunu, rollbackte aynı live state ile yeniden başladığını ve tüm current resourcesın yine korunup pre/post live visual/perf/console eşitliğinin sürdüğünü kanıtla. Bu gerçek-tick kapısından önce varsayılan \`game3d.html\` import graphı değiştirilmez.`);

append('DECISIONS.md', `## ADR-0216 — Canonical opt-in transaction must pause the real current ChunkManager, own every non-light current scene root, and freeze current simulation (run 196)

**Risk Seviyesi:** LOW

**Karar:** Run195 replacement controller yalnız real current-runtime inventory üzerinden bir transaction-preflight tarafından kullanılabilir. Inventory \`createScene()\` state alanlarından, \`ChunkManager.loaded\` resident terrain mapinden ve final direct-scene-child sweep'inden türetilir. Sun/hemisphere dışında hiçbir direct current scene root unmanaged bırakılamaz; Run180 wind grass da ayrı borrowed root'tur. Canonical active iken current ChunkManager instance'ının \`streamTowards\` çağrıları reversible wrapper ile bloklanır; current keyboard input tüketilmez ve current player-update preflight entry pointi çalıştırılmaz. Rollback canonical kaynakları dispose eder, original \`streamTowards\` method identitysini, \`lastStreamChunk\`, camera/controls/player transformlarını, input object identitysini, grass/root identity-orderını ve current ground colliderı geri yükler.

**Neden:** Run195 root/collider rollback şeklini sentetik current rootlarla kanıtladı. Gerçek live adoption öncesinde asıl risk, current terrain streaming'in canonical görüntü sırasında scene'e tekrar mesh eklemesi, ayrı current roots'un transaction dışında kalması veya input/physics güncellemelerinin current state'i rollback yapılamayacak biçimde ilerletmesidir. Run196 diagnostics ayrıca Run180 grass'ın \`performance.now()\` tabanlı \`onBeforeRender\` animasyonuyla full framebuffer'ı doğal olarak frame-to-frame değiştirdiğini ortaya koydu; bu nedenle canlı full-frame byte equality yanlış oracle'dır.

**Ölçüm:** ${summary} Full current scene pre/post draw-call/triangle submission sayıları birebir eşit ve screenshots korunur. Deterministik visual oracle yalnız bilinen time-varying Run180 grass root'unu gizler ve pre/post byte-exact olmak zorundadır; grass'ın mobile katkısı ayrı olarak +1 call/+24,000 tris sabitlenir. Current geometry/material dispose-event sayısı canonical cycle boyunca 0. Existing \`streamAroundOrbitTarget\` paused durumda current coverage değiştirmez, rollbackten sonra yeni chunk üretir. Budget: ${budget}.

**Alternatifler:** (1) \`ChunkManager\` sınıfına şimdi global pause flag eklemek reddedildi; live behaviorı gereksiz yere değiştirirdi. (2) Canonical modda current streaming'e izin vermek reddedildi; detached current terrain scene'e geri sızardı. (3) KeyboardInput/player/grass state'i dispose/recreate etmek reddedildi; hidden runtime state identitysi kaybolurdu. (4) Full animated framebuffer için byte-exact equality dayatmak reddedildi; Run180 shader zamanı render sırasında bilinçli değişir. (5) Run195 controllerı büyütmek reddedildi; Run195 checkpoint kapalı ve additive-only sınırı korunuyor. (6) Default \`game3d.html\` wiring reddedildi; gerçek tick zinciri henüz ayrı opt-in kapıdan geçmedi.

**Sonuç:** Real current scene/chunk/input/physics transaction şekli ve complete direct-root ownership shadow preflight seviyesinde kanıtlandı; current world hâlâ startup source of truth ve default oyuncu runtimeı değişmedi.

**Etkilenen sistemler:** new Run196 shadow integration/checker/diagnostic/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf. Existing sceneManager/chunkManager/game3d/input/physics source lines and live imports unchanged.

**Gelecek Faz Etkisi:** Bir sonraki adım yalnız ayrı developer/preflight entry pointinde gerçek tick update zincirini transaction gate'e bağlayabilir. NPC/animal/dragon/world-event/player updates ve rollback equality orada kanıtlanmadan default activation değerlendirilmez.

**Geri alma planı:** Live consumer yoktur. Run196 contractı yanlışlanırsa yeni versioned shadow transaction module eklenir; Run195/Run194/current runtime byte-unchanged kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 196 real current-runtime transaction preflight (ADR-0216); complete non-light current scene ownership + Run180 grass borrow/restore + instance-scoped ChunkManager pause/resume + input/physics freeze/restore + static byte-exact rollback/full submission equality PASS; live runtime delta 0.`);

console.log('[recordRun196CurrentRuntimeIntegrationShadow] PASS: Run196 governance records appended.');
