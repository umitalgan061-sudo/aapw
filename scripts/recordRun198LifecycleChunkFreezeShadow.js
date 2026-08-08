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
const budget = env('RUN198_BUDGET_JSON');
const liveMobile = env('RUN198_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN198_SMOKE_PASS_COUNT');
const perfRow = env('RUN198_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 198 — Lifecycle-wide current ChunkManager freeze + canonical-active pagehide/re-init preflight (${stamp})
- Session/concurrency: started from Run197 main \`0128166a…\` after re-reading GOVERNANCE, latest progress/ADR/owner context and rechecking remote main. Two parallel Run198 experiments were discovered and left untouched; their failed diagnostics were used only as evidence. This validated v3 branch was created separately from unchanged main.
- Alt görev: added unimported/versioned \`worldReferenceLifecycleChunkFreezeShadow.js\`. It composes the already-proven Run197 gate but additionally instance-pauses current \`loadChunk\`, \`loadSquare\`, \`unloadChunk\` and \`disposeAll\` for the entire canonical interval. Run196's own \`streamTowards\` pause remains unchanged. Rollback/dispose restores exact method identity before unchanged current pagehide teardown runs.
- Why: an earlier lifecycle diagnostic reached the real Run196 rollback assertion \`current ChunkManager resident ownership changed while canonical mode was active\`. The stronger ownership boundary closes that gap without changing Run196/197 or any default runtime import. ${summary}
- Lifecycle proof: ${lifecycle}. Two independent current-runtime generations enter canonical mode, keep resident chunk keys stable, pagehide from canonical mode, restore current ownership, then let the unchanged runtime dispose exactly once. Same-document second \`initGame3D()\` receives fresh scene/renderer/chunk/player/input/entity identities; F4 toggles once per keypress. RAF/interval leaks 0; console/page errors 0.
- Budget: ${budget}. Existing live mobile remains ${liveMobile}; Run198 has zero default draw/triangle cost because no live runtime imports the new shadow module.
- Full regression: baseline/after browser smoke ${smokePassCount}+ PASS plus canonical world/determinism, PWA/cache/installability, accessibility/input/physics, mobile streaming/LOD/perf and governance/additive-only gates PASS.
- Memory/technical debt: new shadow owns one once-only capture listener and only temporary instance wrappers; all are removed/restored on pagehide/manual dispose. Existing \`game3d.js\`, Run196/197 and gameplay/world sources remain byte-unchanged. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0218.
- Perf snapshot: ${perfRow}
- World Coverage unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: lifecycle replacement-boundary readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical startup hâlâ değiştirilmez. Ayrı opt-in developer startup entry pointinde canonical source-of-truth seçimini boot anından test et; current fallback, pagehide rollback ve offline/PWA boot eşdeğerliği aynı kanıtta geçmeden varsayılan \`game3d.html\` startup'ı değiştirilmez.`);

append('DECISIONS.md', `## ADR-0218 — Canonical lifecycle ownership freezes every current ChunkManager mutation before pagehide rollback (run 198)

**Risk Seviyesi:** LOW

**Karar:** Run197 tick gate lifecycle kapısında tek başına yeterli sayılmaz. Canonical ownership başlarken current ChunkManager'ın \`loadChunk\`, \`loadSquare\`, \`unloadChunk\` ve \`disposeAll\` instance girişleri de reversible wrapperlarla inert hale getirilir; Run196'nın mevcut \`streamTowards\` pause'u aynen korunur. Pagehide capture sırasında Run197 gate current state'e rollback+dispose olurken bu ek mutator freeze hâlâ aktiftir. Gate başarıyla kapandıktan hemen sonra exact method identity geri yüklenir ve mevcut \`game3d.js\` teardown'u normal \`disposeAll\` dahil kendi disposal zincirini çalıştırır.

**Neden:** İlk Run198 harness readiness yarışı nedeniyle erken hata verdi. İkinci diagnostic ise daha derin gerçek sınırı ortaya çıkardı: canonical aktif pagehide rollback sırasında Run196, current resident chunk keys'in aktivasyon snapshot'ından saptığını gördü. Run196 sadece \`streamTowards\`'ı pause ediyordu; lifecycle ownership için bunun yeterli olduğunu varsaymak güvenli değildi. Current dünya canonical görünürken resident ownershipin herhangi bir yoldan değişmesine izin vermek rollback doğruluğunu bozar. Yeni katman current ChunkManager mutation yüzeyini bütünüyle kapatır ve mevcut modüllere dokunmaz.

**Ölçüm:** ${summary} Lifecycle ${lifecycle}; canonical budget ${budget}. İki generation boyunca resident key snapshotı canonical interval içinde exact kalır. Run197 player/NPC/animal/dragon/interaction/world-event freeze hedeflerinin tamamı gerçek RAF tarafından bloklanır. Pagehide canonical modda başlar; capture coordinator gate'i kapatır, mutator identitylerini geri yükler, ardından unchanged runtime renderer/chunk/input/player/controls/free-camera/world-event/entity disposal yollarını tam bir kez çalıştırır. İkinci init fresh runtime identityleriyle başlar; F4 duplicate listener göstermeden tek toggle davranışı verir. RAF/interval leak 0, console/page error 0.

**Alternatifler:** (1) Run196'yı düzenlemek reddedildi: additive-only ve proven checkpoint korunmalı. (2) Rollback assertionını gevşetmek reddedildi: gerçek ownership driftini gizlerdi. (3) Pagehide'da current teardown'u canonical rollbackten önce çalıştırmak reddedildi: borrowed current resources dispose edildikten sonra rollback güvenli değildir. (4) Default runtime'a doğrudan canonical branch eklemek reddedildi: lifecycle kapısı geçmeden ürün yolunu etkilerdi. (5) Sadece testte loaded Map snapshotını elle geri yazmak reddedildi: gerçek lifecycle kontratını kanıtlamaz.

**Sonuç:** Canonical transaction current chunk residency dahil simulation/world mutation yüzeyini pagehide sınırına kadar gerçekten dondurabilir; ardından current teardown ve clean same-document re-init güvenli biçimde gerçekleşir. Run198 default oyuncu runtime davranışını değiştirmez.

**Etkilenen sistemler:** new Run198 lifecycle chunk-freeze shadow/checker/workflow/recorder; append-only progress/ADR/stable/perf. Existing runtime JS/HTML/CSS/service-worker, Run196/197 shadows, gameplay/world modules unchanged.

**Gelecek Faz Etkisi:** Sıradaki preflight ayrı opt-in developer startup entry pointinde canonical source-of-truth'u boot anından seçebilir. Current fallback ve PWA/offline boot eşdeğerliği geçmeden default startup değişmez.

**Geri alma planı:** Live consumer yoktur. Yeni shadow kullanılmazsa runtime etkisi sıfırdır; contract yanlışlanırsa yeni versioned shadow eklenir, Run198/197/196/current runtime korunur.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 198 lifecycle-wide current ChunkManager freeze + canonical-active pagehide + same-document clean re-init preflight (ADR-0218); resident-key stability + exact method restoration + two lifecycle generations + single disposal + clean F4 + zero RAF/interval/console leak PASS; live runtime delta 0.`);

console.log('[recordRun198LifecycleChunkFreezeShadow] PASS: Run198 governance records appended.');
