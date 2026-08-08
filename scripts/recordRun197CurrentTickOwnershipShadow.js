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

const stamp = env('RUN197_STAMP');
const stableTag = env('RUN197_STABLE_TAG');
const summary = env('RUN197_SUMMARY');
const budget = env('RUN197_BUDGET_JSON');
const liveMobile = env('RUN197_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN197_SMOKE_PASS_COUNT');
const perfRow = env('RUN197_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 197 — Real game-tick simulation freeze/resume transaction preflight (${stamp})
- Session/concurrency: started from Run196 main \`b3037e47…\` only after re-reading GOVERNANCE, Run196/ADR-0216, Run195/ADR-0215, latest commits and QUESTIONS_FOR_OWNER; no Run197/ADR-0217 occupancy existed. Remote main is rechecked both before branch publication and immediately before validated checkpoint publication.
- Alt görev: added unimported, versioned \`worldReferenceCurrentTickOwnershipShadow.js\`, composing Run196 without modifying \`game3d.js\` or the default \`game3d.html\` import graph. It instance-pauses the exact update methods already called by the live tick: keyboard/touch input reads, player, every NPC/animal/dragon, interaction, and world-event updates. No prototype is changed.
- Real-tick proof: the focused browser harness serves the repository's exact \`game3d.js\` with one in-memory test-only state-observation line injected after \`createScene(canvas)\`; the repository source file itself remains byte-unchanged. The actual requestAnimationFrame tick continues running during canonical ownership. ${summary}
- Rollback/resume: two activate→rollback cycles pass. Every paused method restores exact original function identity; held keyboard state is not consumed while frozen; the real tick then consumes the preserved jump edge and calls player/NPC/animal/dragon/interaction/world-event paths again through temporary pass-through observers that are themselves removed with exact identity restoration.
- State/resource safety: player/NPC/animal/dragon transforms and entity identities remain exact throughout each frozen interval. Run196 still owns scene/chunk/camera/physics rollback; current geometry/material dispose-event count remains 0. Pre/post current render submission counts are equal and canonical submission stays inside the hard mobile budget. Budget: ${budget}.
- Live regression: baseline/after browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors. Existing live mobile remains ${liveMobile}; Run197 has zero default runtime draw/triangle cost because no live module imports it.
- PWA/cache: one additive GAME3D_SHELL_FILES entry is appended for the new shadow module; service-worker/installability/cache guards pass.
- Memory/technical debt: \`game3d.js\` remains 547/600 and Run193 adapter remains 562/600; neither is grown. Run197 module is isolated below the 600-line cap, owns no timers/listeners/GPU resources, and restores every instance wrapper. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0217.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: real game-tick replacement-boundary readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical switch hâlâ yapma. Ayrı opt-in developer lifecycle preflightinde canonical transactionı gerçek pagehide/dispose ve yeniden-init sınırında test et; wrapper/RAF/input listener/scene resource leak olmadığını ve ikinci init'in temiz current state ile başladığını kanıtla. Bu lifecycle kapısı geçmeden default startup source-of-truth değiştirilmez.`);

append('DECISIONS.md', `## ADR-0217 — Canonical transaction may freeze the unchanged real game tick only through reversible instance method gates (run 197)

**Risk Seviyesi:** LOW

**Karar:** Run196 current-runtime transaction, default runtime import graphına bağlanmadan önce ayrı opt-in Run197 tick gate ile compose edilir. Canonical active iken gerçek \`game3d.js\` requestAnimationFrame döngüsü çalışmaya devam eder fakat o döngünün mevcut instance'lardan çağırdığı keyboard/touch input read, player, NPC, animal, dragon, interaction ve world-event \`update\` girişleri deterministic inert wrapperlarla bloklanır. Wrapperlar prototype'a değil yalnız mevcut instance'a yazılır; rollbackte varsa original own property descriptor, yoksa prototype lookup semantiği geri getirilir ve exact function identity doğrulanır.

**Neden:** Run196 \`shouldRunCurrentSimulation()\` ve \`runCurrentPlayerUpdate()\` preflight API'leri transaction niyetini kanıtladı ama live tick bu API'leri çağırmıyordu. Default \`game3d.js\` wiringini şimdi değiştirmek additive-only sınırını ve bir sonraki migration kapısını gereksiz yere birleştirirdi. Instance gate, gerçek tick'in unchanged call graphını doğrudan gözlemleyip durdurur; aynı zamanda başarısız/rollback yolunda mevcut canlı subsystem nesnelerini recreate etmeden exact identity ile geri bırakır.

**Ölçüm:** ${summary} İki canonical cycle boyunca player/NPC/animal/dragon transformları byte-equivalent JSON snapshot seviyesinde değişmez; her pause target gerçek RAF tick tarafından en az bir kez çağrılıp bloklanır. Rollback sonrası pass-through observers gerçek tick'in altı temsilî update yolunu yeniden çağırdığını kanıtlar ve observerlar exact method identity ile temizlenir. Current geometry/material dispose-event count 0. Current pre/post submission countları eşit; budget ${budget}.

**Alternatifler:** (1) \`game3d.js\` içine şimdi canonical if-branch eklemek reddedildi; default import graphını gerçek-tick kapısı kanıtlanmadan değiştirirdi. (2) RAF'ı tamamen durdurmak reddedildi; renderer/UI/lifecycle davranışını da dondurup hangi subsystemin gerçekten gated olduğunu gizlerdi. (3) Prototype monkey-patch reddedildi; başka instance/testleri etkileyebilir. (4) Entityleri dispose/recreate etmek reddedildi; animation/AI hidden state identitysi kaybolur. (5) Synthetic tick kopyası reddedildi; gerçek \`game3d.js\` call graphını kanıtlamaz. Bu nedenle checker yalnız HTTP response içinde state referansını gözlem için ekler; repo \`game3d.js\` değişmez.

**Sonuç:** Player/NPC/animal/dragon/interaction/world-event current simulation zinciri gerçek live tick altında reversible biçimde freeze/resume edilebiliyor. Run197 default oyuncu runtimeını değiştirmez ve canonical source-of-truth hâlâ opt-in shadow düzeyindedir.

**Etkilenen sistemler:** new Run197 shadow gate/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf. Existing \`game3d.js\`, gameplay modules, Run196/Run195 modules and default HTML imports unchanged.

**Gelecek Faz Etkisi:** Sıradaki migration preflight gerçek lifecycle teardown/re-init sınırını kapsamalı. Default canonical startup ancak current tick freeze/resume ile birlikte pagehide/dispose sonrası listener/RAF/resource temizliği de kanıtlandıktan sonra değerlendirilebilir.

**Geri alma planı:** Live consumer yoktur. Run197 contractı yanlışlanırsa yeni versioned shadow gate eklenir; Run196/Run195/current runtime byte-unchanged kalır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 197 real game-tick freeze/resume preflight (ADR-0217); unchanged live RAF tick + player/NPC/animal/dragon/interaction/world-event instance gates + held-input preservation + two exact rollback cycles + zero borrowed-resource disposal + pre/post submission equality PASS; live runtime delta 0.`);

console.log('[recordRun197CurrentTickOwnershipShadow] PASS: Run197 governance records appended.');
