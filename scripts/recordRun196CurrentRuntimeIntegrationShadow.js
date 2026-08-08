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
- Alt görev: added unimported, versioned \`worldReferenceCurrentRuntimeIntegrationShadow.js\`. It inventories the real \`createScene()\` world-root shape (named current roots + every resident ChunkManager terrain mesh + optional real-castle/player roots), feeds those borrowed roots into Run195, and leaves renderer/camera/controls/lights as infrastructure.
- Streaming boundary: only the current ChunkManager instance receives a reversible opt-in \`streamTowards\` pause wrapper while canonical mode is active. Existing \`streamAroundOrbitTarget\` is exercised unchanged; its request is blocked with zero resident/cumulative current-world mutation. Rollback restores the exact original method identity and the saved \`lastStreamChunk\`; a later real streaming request generates new chunks again.
- Input/physics boundary: canonical mode returns inert frozen keyboard axes and blocks the preflight current-player update entry point without consuming held input. Rollback preserves KeyboardInput identity/held W+Shift state, reopens player update, restores the current ground-collider object identity and the exact player/camera/controls transform snapshot. ${summary}
- Resource ownership: current resources are instrumented through actual Three.js geometry/material dispose events. Canonical activate→rollback emits zero current-resource disposal events; only canonical-owned resources are disposed. Current scene child identity/order is restored exactly.
- Visual/performance: real mobile-class \`createScene()\` fixture is rendered before activation, canonical near+far, and after rollback. Current before/after calls, triangles and sampled framebuffer digest are exactly equal. Canonical near/far remain below mobile hard budget. Budget: ${budget}.
- Live regression: baseline/after browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Existing live mobile remains ${liveMobile}; Run196 has zero default runtime draw/triangle cost because no live module imports it.
- PWA/cache: one additive GAME3D_SHELL_FILES entry is appended for the new shadow module; existing entries remain intact.
- Memory/technical debt: Run193 adapter remains closed at 562/600; game3d.js remains 547/600. Run194 retained V1 shadow debt remains. Run196 owns no borrowed current resources; its instance pause wrapper is restored on rollback/dispose. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0216.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: real-current runtime transaction readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical switch yapma. Run196 transaction boundarysini ayrı, açıkça opt-in bir developer/preflight entry pointinde gerçek game tick ownershipine bağla; player/NPC/animal/dragon/world-event update zincirinin canonical modda durduğunu, rollbackte aynı live state ile yeniden başladığını ve tüm current resourcesın yine korunup pre/post live visual/perf/console eşitliğinin sürdüğünü kanıtla. Bu gerçek-tick kapısından önce varsayılan \`game3d.html\` import graphı değiştirilmez.`);

append('DECISIONS.md', `## ADR-0216 — Canonical opt-in transaction must pause the real current ChunkManager and freeze current simulation without disposing borrowed resources (run 196)

**Risk Seviyesi:** LOW

**Karar:** Run195 replacement controller yalnız real current-runtime inventory üzerinden bir transaction-preflight tarafından kullanılabilir. Inventory \`createScene()\` state alanlarından ve \`ChunkManager.loaded\` resident terrain mapinden türetilir. Canonical active iken current ChunkManager instance'ının \`streamTowards\` çağrıları reversible wrapper ile bloklanır; current keyboard input tüketilmez ve current player-update preflight entry pointi çalıştırılmaz. Rollback canonical kaynakları dispose eder, original \`streamTowards\` method identitysini, \`lastStreamChunk\`, camera/controls/player transformlarını, input object identitysini ve current ground colliderı geri yükler.

**Neden:** Run195 root/collider rollback şeklini sentetik current rootlarla kanıtladı. Gerçek live adoption öncesinde asıl risk, current terrain streaming'in canonical görüntü sırasında scene'e tekrar mesh eklemesi veya input/physics güncellemelerinin current state'i rollback yapılamayacak biçimde ilerletmesidir. Instance-scoped pause, mevcut ChunkManager sınıfını veya live import graphını değiştirmeden bu yarış sınırını ölçülebilir kılar.

**Ölçüm:** ${summary} Real \`createScene()\` mobile-class current before/after framebuffer digest + draw-call/triangle sayıları birebir eşit; canonical near/far mobile limitin altında. Current geometry/material dispose-event sayısı canonical cycle boyunca 0. Existing \`streamAroundOrbitTarget\` paused durumda current coverage değiştirmez, rollbackten sonra yeni chunk üretir. Budget: ${budget}.

**Alternatifler:** (1) \`ChunkManager\` sınıfına şimdi global pause flag eklemek reddedildi; live behaviorı gereksiz yere değiştirirdi. (2) Canonical modda current streaming'e izin vermek reddedildi; detached current terrain scene'e geri sızardı. (3) KeyboardInput/player state'i dispose/recreate etmek reddedildi; held-key/hidden runtime state identitysi kaybolurdu. (4) Run195 controllerı büyütmek reddedildi; Run195 checkpoint kapalı ve additive-only sınırı korunuyor. (5) Default \`game3d.html\` wiring reddedildi; gerçek tick zinciri henüz ayrı opt-in kapıdan geçmedi.

**Sonuç:** Real current scene/chunk/input/physics transaction şekli shadow preflight seviyesinde kanıtlandı; current world hâlâ startup source of truth ve default oyuncu runtimeı değişmedi.

**Etkilenen sistemler:** new Run196 shadow integration/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf. Existing sceneManager/chunkManager/game3d/input/physics source lines and live imports unchanged.

**Gelecek Faz Etkisi:** Bir sonraki adım yalnız ayrı developer/preflight entry pointinde gerçek tick update zincirini transaction gate'e bağlayabilir. NPC/animal/dragon/world-event/player updates ve rollback equality orada kanıtlanmadan default activation değerlendirilmez.

**Geri alma planı:** Live consumer yoktur. Run196 contractı yanlışlanırsa yeni versioned shadow transaction module eklenir; Run195/Run194/current runtime byte-unchanged kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 196 real current-runtime transaction preflight (ADR-0216); current scene inventory + instance-scoped ChunkManager pause/resume + input/physics freeze/restore + exact pre/post render equality PASS; live runtime delta 0.`);

console.log('[recordRun196CurrentRuntimeIntegrationShadow] PASS: Run196 governance records appended.');
