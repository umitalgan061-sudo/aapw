#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const append = (file, text) => fs.appendFileSync(path.join(ROOT, file), `\n\n${text.trim()}\n`);
const stamp = env('RUN197_STAMP');
const stableTag = env('RUN197_STABLE_TAG');
const summary = env('RUN197_SUMMARY');
const budget = env('RUN197_BUDGET_JSON');
const liveMobile = env('RUN197_LIVE_MOBILE_JSON');
const smokePassCount = env('RUN197_SMOKE_PASS_COUNT');
const perfRow = env('RUN197_PERF_ROW');

append('3D_GAME_PROGRESS.md', `## Run 197 — Reversible real game-tick subsystem freeze preflight (${stamp})
- Session/concurrency: started from main \`b3037e47…\` after re-reading GOVERNANCE, Run196/ADR-0216, recent commits and QUESTIONS_FOR_OWNER; no Run197 branch/ADR occupancy existed. Owner-blocked radius-5, game3d.js split and world-event checksum decisions remain untouched.
- Alt görev: added unimported \`worldReferenceGameplayTickFreezeShadow.js\`, composed strictly on top of Run196. It installs reversible instance-level update pauses for the exact gameplay object shapes called by the game tick: player, NPCs, animals, dragons, interaction and world events. Existing source methods are not edited; canonical activation swaps only each live object instance's \`update\` property and rollback restores the exact original function identity/descriptor.
- Tick proof: focused Chromium preflight executes the same \`updateEntitiesSafely\` / \`updateSystemSafely\` call shapes used by \`game3d.js\`. Two canonical tick slices produce blocked-call telemetry with zero underlying gameplay side effects/state movement; rollback restores scene/runtime state and exact method identities, then one real current tick advances all six targets exactly once. A second activate→rollback cycle proves repeatability. ${summary}
- Runtime scope: default \`game3d.js\` import graph and tick loop remain byte-unchanged. This is still opt-in shadow/preflight only; canonical world is NOT default and no player-facing behavior changes.
- PWA/cache: one additive GAME3D_SHELL_FILES line precaches the new shadow module. Existing PWA/cache/installability gates pass.
- Validation: baseline and post-change full browser smoke ${smokePassCount}+ PASS with zero 3D console/page errors; Run196 transaction/canonical ownership, world visual/determinism, accessibility/input/physics, mobile streaming/LOD/perf and governance gates pass. Focused budget: ${budget}. Live mobile: ${liveMobile}.
- Memory/technical debt: pause wrappers are instance-scoped, descriptor-restoring and cleared on rollback/dispose; no listener/timer/DOM/geometry/material ownership added. game3d.js remains 547/600 and Run193 adapter remains 562/600; both unchanged. New live runtime debt 0. Risk LOW. Güven 5/5. ADR: ADR-0217.
- Perf snapshot: ${perfRow}
- World Coverage live values unchanged: desktop %96.2; mobile radius-4 81 chunks / 20.25 km² (~%14.7). World Evolution Report: canonical gameplay-tick rollback readiness +1; live world delta 0. Oyuncu farkı: HAYIR.
- Sıradaki güvenli adım: default canonical activation yapma. Bir sonraki preflight, gerçek visual/runtime tickte time-based non-gameplay state (day/night, sky/stars/water/free-camera/perf HUD) için hangi sistemlerin canonical ownership sırasında ilerlemeye devam etmesi gerektiğini explicit policy olarak ayırmalı; owner kararı gerektiren gameplay tasarımını tahmin etmeden sadece rollback/determinism güvenliğini kanıtlamalı.`);

append('DECISIONS.md', `## ADR-0217 — Canonical opt-in ownership must freeze real gameplay update methods by reversible instance wrappers before default tick integration (run 197)

**Risk Seviyesi:** LOW

**Karar:** Run196 current-runtime transaction aktif canonical moda geçmeden önce live state üzerindeki player, NPC, animal, dragon, interaction ve world-event \`update()\` methodları yalnız ilgili instance üzerinde reversible wrapper ile durdurulur. Wrapper blocked-call telemetry tutar ancak original methodu çağırmaz. Rollbackte original own-property descriptor/function identity birebir geri yüklenir; inherited method ise temporary own property silinerek prototype identity geri açılır. Default runtime bu modülü import etmez.

**Neden:** Run196 current scene/streaming/input/physics ownershipini kanıtladı fakat \`game3d.js\` tick'i gameplay update methodlarını doğrudan çağırmaya devam ettiği bir gelecek opt-in wiring'de detached current-world simulation arka planda ilerleyebilirdi. Bu, rollback sonrasında NPC/animal/dragon/world-event state'inin canonical görüntü süresince gizlice ilerlemesine yol açardı.

**Ölçüm:** ${summary} Focused Chromium proof aynı safeMode call shapes ile iki canonical tick uygular; original gameplay counters ve transforms değişmez, blocked telemetry her hedefte beklenen sayıyı görür. Rollback exact update identity/state equality sağlar; ilk current tick bütün altı hedefi bir kez ilerletir; ikinci transaction cycle da eşitliği korur. Budget: ${budget}. Live mobile: ${liveMobile}.

**Alternatifler:** (1) \`game3d.js\` tick satırlarına şimdi koşul eklemek reddedildi; default runtime import graphını ve owner-blocked 547/600 dosyayı gereksiz büyütürdü. (2) Global class/prototype patch reddedildi; başka instance/testleri etkileyebilir. (3) Gameplay objelerini dispose/recreate etmek reddedildi; identity ve hidden animation/AI state kaybı yaratır. (4) Sadece player'ı durdurmak reddedildi; NPC/animal/dragon/world-event simulation rollbackten sapardı. (5) World-event timerını özel snapshotlamaya çalışmak reddedildi; method-entry freeze daha küçük ve internal-state-agnostic.

**Sonuç:** Canonical opt-in sırasında current gameplay simulationın güvenli durdurulup exact method identity ile yeniden başlatılabildiği preflight seviyesinde kanıtlandı; live tick/default startup source of truth değişmedi.

**Etkilenen sistemler:** new Run197 shadow module/checker/PWA applicator/CI/recorder; additive service-worker entry; append-only progress/ADR/stable/perf. Existing game3d/safeMode/gameplay/runtime source lines unchanged.

**Gelecek Faz Etkisi:** Default canonical adoptiondan önce non-gameplay time-based tick sistemlerinin (lighting/sky/stars/water/free-camera/debug HUD) canonical modda advance/freeze politikasının ayrı preflightta açıkça tanımlanması gerekir. Owner kararı bekleyen gameplay/radius/refactor maddeleri bu ADR ile çözülmüş sayılmaz.

**Geri alma planı:** Live consumer yoktur. Contract yanlışlanırsa yeni versioned shadow module eklenir; Run197/Run196/current runtime değiştirilmeden bırakılır.`);

append('STABLE_TAGS.md', `- ${stableTag} — run 197 reversible gameplay-tick freeze preflight (ADR-0217); player/NPC/animal/dragon/interaction/world-event instance update pause + exact identity/state rollback + second-cycle repeatability PASS; live runtime delta 0.`);
console.log('[recordRun197GameplayTickFreezeShadow] PASS: Run197 governance records appended.');
