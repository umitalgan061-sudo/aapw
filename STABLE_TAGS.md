# STABLE_TAGS.md

Per `GOVERNANCE.md` §8.11: a one-line note each time a run passes the Session Quality Gate
and the game boots with zero console/page errors. Newest entry at the bottom.

- `stable-2026-07-31-0915` — run 56 end: terrain macro-relief (ADR-0075) + slope-aware road
  network (ADR-0076) landed, both with real headless-boot verification (zero console/page
  errors) and 14/14 smoke suite passing.
- `stable-2026-08-05-0400` — run 65 end: service-worker offline app-shell cache drift fixed
  (ADR-0083, 10 JS modules + 3 asset groups added to the precache list) + regression check added,
  17/17 smoke suite passing, zero console errors, real offline-mode reload verified. Local tag only
  — `git push origin <tag>` still rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0454` — run 66 end: F2 debug panel PWA offline storage-quota monitoring
  (ADR-0084) landed, 17/17 smoke suite passing (assertions extended), zero console errors, real
  headless-Chromium screenshot proof. GOVERNANCE.md §15's PWA section now fully closed (cache-
  completeness run 65 + quota monitoring this run). Local tag only — `git push origin <tag>` still
  rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0550` — run 66 end (3 sub-tasks): F2 storage-quota monitoring (ADR-0084),
  stale doc-comment fix, and FAZ 7 continuous chase (ADR-0085 — the dragon now leaves its castle to
  hunt the player, time-boxed at 18s). 18/18 smoke suite, zero console errors, two-angle visual +
  real-terrain trajectory evidence. Local tag only — `git push origin <tag>` still rejected with
  `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0606` — run 67 end: 8th real castle model for the `twin` kingdom seat
  (ADR-0086, reusing a previously-mislabeled/unused asset — real-castle coverage 7/14 -> 8/14),
  merged cleanly on top of a concurrent session's FAZ 7 dragon continuous-chase work (ADR-0085,
  caught via the pre-commit `git fetch` and resolved per GOVERNANCE.md §8.14, no work lost). 18/18
  smoke suite passing, zero console errors, standalone two-angle visual proof of the new model.
  Local tag only — `git push origin <tag>` still rejected with `HTTP 403` (same known issue since
  run 58).
- `stable-2026-08-05-0639` — run 68 end: the standing 614-line Altın Kural 7 violation in
  `scripts/game3dSmokeChecksMovement.js` finally cleared at its source (ADR-0087) — its 3 dragon
  checks moved verbatim into a new `game3dSmokeChecksDragonFlight.js`, leaving 328/329-line halves —
  plus a new permanent guard (`scripts/checkSmokeCheckRegistry.js`) that machine-enforces the
  600-line cap repo-wide and cross-checks the smoke registry both ways, so a future run cannot
  silently drop a check and still print a green suite. **Every JS file in the repo is now under the
  cap, machine-verified.** 18/18 smoke suite passing before AND after, with the full suite stdout
  diffed before/after (identical once `check2DShell`'s sandbox-network error counter is normalized)
  and the moved code proven byte-identical — not merely "18/18 still passes". Zero console/page
  errors on a real headless boot, 2 camera angles. No `src/` code touched; perf bit-identical to run
  67. `git push origin main` succeeded (`95bb9ae`). Local tag only — `git push origin <tag>` still
  rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0651` — run 69 end: new standing guard `scripts/checkDialogueChoicesShape.js`
  (ADR-0088) closes the last of run 68's three named smoke-coverage gaps — cross-checks
  `dialogueChoices.js`'s `CHOICES_BY_NPC_ID` against real NPC ids, the keybinding slot count, and
  content shape (non-empty label/response, `{name}` placeholder), negative-controlled 4 ways. 18/18
  smoke suite passing before and after, zero console/page errors on real headless boot. No `src/`
  code touched; perf bit-identical to run 68 on every GPU-submission metric. `git push origin main`
  succeeded (`21addd5`). Local tag only — `git push origin <tag>` still rejected with `HTTP 403`
  (same known issue since run 58).
- `stable-2026-08-05-0715` — run 70 end: dragon wing-flap agitation telegraph (ADR-0089) — the `Fly`
  clip's own playback speed now eases up with however agitated the dragon currently is (reactive/dive/
  pursuit, whichever blend is strongest), a purely cosmetic polish pass with no new radius/trigger/
  damage. New regression check isolates all three triggers independently (19/19 smoke suite passing).
  Zero console/page errors on real headless boot, perf bit-identical to run 69 on every GPU-submission
  metric. `git push origin main` succeeded (`147aeed`). Local tag only — `git push origin <tag>` still
  rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0745` — run 70 end (2nd sub-task): new standing guard
  `scripts/checkPwaInstallability.js` (ADR-0090) closes GOVERNANCE.md §15's "Periyodik Platform
  Kontrolü" rule, unenforced for 14 runs — `npm audit` confirmed N/A (no npm dependency in this
  repo), PWA installability now machine-checked, WebGL already covered by the existing smoke suite.
  19/19 smoke suite passing, zero console/page errors, perf bit-identical to sub-task 1. `git push
  origin main` succeeded (`868d427`). Local tag only — `git push origin <tag>` still rejected with
  `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0905` — run 71 end: dragon pursuit give-up cue (ADR-0091) — a new `giveUpBlend`
  tracks the existing `pursuitExhausted` state (run 66/ADR-0085) and steepens the bank angle on a
  timeout-driven give-up, distinct from an ordinary distance-triggered disengage (which never
  triggers the cue at all), layered independently from ADR-0089's wing-flap blend. New 4-scenario
  regression check `checkDragonGiveUpCue` isolates explicit-multiplier/default-multiplier give-up,
  ordinary disengage, and re-arm (20/20 smoke suite passing). Zero console/page errors on real
  headless boot, perf bit-identical to run70b on every GPU-submission metric. `dragons.js` grew
  531->598 lines (crossed the 540 WARN threshold, still under the 600 cap — flagged as next run's
  real forcing signal to split). `git push origin main` succeeded (`a0d5b83`). Local tag only —
  `git push origin <tag>` still rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-0940` — run 71 sub-task 2 end: `gameplay/dragons.js` split by subsystem block
  (ADR-0092) — 598/600 lines became four files (`dragonController.js` 414, `dragonFlightMath.js` 146,
  `dragonSpawns.js` 89, `dragons.js` 84 as the re-exporting entry point). Public API and import path
  unchanged, so no caller and no test was edited: `game3d.js` and all six dragon smoke checks still
  import from `src/3d/gameplay/dragons.js`. Smoke suite 20/20 PASS before and after with **byte-
  identical stdout** except the 2D shell's known non-blocking sandbox-network counter; perf
  bit-identical (46 draw calls / 393,231 triangles / 44 geometries / 17 textures); zero console/page
  errors on real headless boot; all 6 standing guards clean and the `dragons.js` 598/600 WARN is
  gone. `service-worker.js` precaches the three new modules (`SHELL_CACHE` v3->v4). `git push origin
  main` succeeded (`8376b68`). Local tag only — `git push origin <tag>` still rejected with
  `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-1004` — run 72 sub-task 1 end: dragon dive telegraph (ADR-0093) — a wing-flap
  warning beat before the swoop starts, decoupled from the dive's own position blend via a new
  `diveTelegraphBlend` and a plain elapsed-time gate on `diveBlend`'s own target. New regression
  check `checkDragonDiveTelegraph` isolates the cue-fires-while-position-holds property, the
  eventually-reaches-the-same-dived-position property, and the retreat-cancels-the-dive property
  (21/21 smoke suite passing). Zero console/page errors on real headless boot; perf bit-identical to
  run71b on every GPU-submission metric (46 draw calls / 393,231 triangles / 44 geometries / 17
  textures). `scripts/game3dSmokeChecksDragonDive.js` now 598/600 (fresh WARN, flagged as next run's
  real forcing signal to split). `git push origin main` succeeded (`cffd49c`). Local tag only —
  `git push origin <tag>` still rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-1012` — run 72 sub-task 2 end: `game3dSmokeChecksDragonDive.js` split by theme
  (ADR-0094) — 598/600 lines became `game3dSmokeChecksDragonDive.js` (301, dive-only) +
  `game3dSmokeChecksDragonPursuit.js` (318, new, pursuit-only). No production code touched; only
  `smokeTestGame3D.js`'s wiring changed. Smoke suite 21/21 PASS before and after with byte-identical
  detail text on every dragon check; perf bit-identical (46 draw calls / 393,231 triangles / 44
  geometries / 17 textures); `checkServiceWorkerCache.js` confirms scripts/ dev tooling stays outside
  the precache scope (still 46 JS files); `game3dSmokeChecksDragonDive.js`'s 598/600 WARN is gone,
  only `gameplayConfig.js`'s 579/600 remains. `git push origin main` succeeded (`da097ed`). Local tag
  only — `git push origin <tag>` still rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-1202` — run 73 end: FAZ 11 "asker" archetype, real combat-stance reaction for
  every guard NPC (ADR-0096) — player proximity now turns a guard to face them and freezes any
  in-progress patrol in place (resuming the same lap on retreat), idle clip eases to a faster
  time-scale as the tension cue (no dedicated clip needed, same trick as the dragon wing-flap
  telegraph, ADR-0089). New regression check `checkNpcCombatStance` (22/22 smoke suite passing, was
  21/21). Zero console/page errors on real headless boot; perf bit-identical to run72b on every
  GPU-submission metric (46 draw calls / 393,231 triangles / 44 geometries / 17 textures).
  `gameplayConfig.js` now 597/600 (fresh WARN, next run's real forcing signal to split if touched
  again). `git push origin main` succeeded (`c1ba8d6`). Local tag only — `git push origin <tag>`
  still rejected with `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-1255` — run 74 end: `WORLD_EVENTS` flavor pool grown 16 -> 18 entries
  (`white_raven`, `iron_bank`, ADR-0097) — config-only, zero mechanism change. Real headless-Chromium
  proof: both new ids observed from the live pool via `createWorldEventSystem`, real payloads
  verified, `WorldEventToast` rendered over the live scene, zero console/page errors. Smoke suite
  22/22 PASS (byte-identical on every other check), all 7 standing guards clean, perf bit-identical to
  run73 (46 draw calls / 393,231 triangles / 44 geometries / 17 textures — expected, no new scene
  objects). `gameplayConfig.js` still 597/600 (untouched this run, same watch-item as ever). `git push
  origin main` succeeded (`29b99f6`). Local tag only — `git push origin <tag>` still rejected with
  `HTTP 403` (same known issue since run 58).
- `stable-2026-08-05-1357` — run 75 end: `WORLD_EVENTS` flavor pool grown 18 -> 20 entries
  (`wildling_rumor`, `mourning_bells`, ADR-0098) — config-only, zero mechanism change; `mourning_bells`
  is the pool's first openly somber/grief-toned entry. Real headless-Chromium proof: both new ids
  observed from the live pool via `createWorldEventSystem`, real payloads verified, `WorldEventToast`
  rendered `mourning_bells` over the live scene, zero console/page errors. Smoke suite 22/22 PASS
  (byte-identical on every other check), all 7 standing guards clean, perf bit-identical to run74 (46
  draw calls / 393,231 triangles / 44 geometries / 17 textures — expected, no new scene objects).
  `gameplayConfig.js` still 597/600 (untouched this run, same watch-item as ever). `git push origin
  main` succeeded (`452ff57`). Local tag only — `git push origin <tag>` still rejected with `HTTP 403`
  (same known issue since run 58).
- `stable-2026-08-05-1506` — run 76 end: two sub-tasks. (1) First governance rule-consolidation pass
  (§8.12, overdue since ~run 56) — reviewed §16 deferred-rule activation conditions (none trigger:
  no `SaveSystem`, `perf_log.csv` under 30 rows) and §15's platform check (done run 70, not due);
  recorded the tag-push block in §8.11 as a known permanent constraint instead of a per-run
  discovery; added `RULES_CHANGELOG.md`. (2) Fixed the recurring `check2DShell`
  `page.goto: Timeout 15000ms exceeded` flake at its measured root cause (ADR-0099) — `index.html`'s
  5 unreachable external resources each hang ~12.6-13.4s before the sandbox resets them, leaving
  only ~1.6-2.4s under the 15s timeout; the page-boot checks are now hermetic (all non-same-origin
  requests aborted), taking `check2DShell` from ~13,000ms to 104-445ms. `check3DMode` now also
  asserts zero external requests, making the offline-PWA rule (Altın Kural 4) suite-enforced rather
  than review-only. Smoke suite 22/22 PASS before and after, all 8 standing guards clean, before/
  after screenshots at two viewports render identically, 3D boot shows no penalty from route
  interception. `perf_log.csv` `run76` is a real sample, bit-identical to run75 on every GPU metric
  (46 draw calls / 393,231 triangles / 44 geometries / 17 textures) — expected, no `src/` file was
  touched. `gameplayConfig.js` still 597/600 (untouched). `git push origin main` succeeded
  (`cde8a38`). Local tag only — `git push origin <tag>` still rejected, this time failing as
  `send-pack: unexpected disconnect while reading sideband packet` rather than the `HTTP 403` seen
  since run 58; different surface error, same standing block, so no change to §8.11's conclusion.
- `stable-2026-08-05-1600` — run 77 end: one sub-task, split `gameplay/gameplayConfig.js` by domain
  (597/600 -> `playerConfig.js`/`npcConfig.js`/`animalConfig.js`/`dragonConfig.js`/
  `interactionConfig.js` + a 31-line re-export barrel, DECISIONS.md ADR-0100) — same precedent
  `dragons.js` (run 71, ADR-0092) and `dialogueChoices.js` (run 50, ADR-0066) already set. All 13
  existing importers unchanged (named imports through the barrel). Fixed
  `checkDialogueChoicesShape.js`, which had text-parsed `gameplayConfig.js` between
  `NPC_CONFIG`/`ANIMAL_CONFIG` markers and broke the instant the split moved `ANIMAL_CONFIG` out —
  caught by actually running the guard, not assumed safe. `service-worker.js`'s `GAME3D_SHELL_FILES`
  got the 5 new files, `SHELL_CACHE` bumped v5->v6. Smoke suite 22/22 PASS before and after, all 8
  standing guards clean after the fix (zero WARN now — the 597/600 line that forced this is gone).
  `perf_log.csv` `run77` bit-identical to run75/76 on every GPU metric (46 draw calls / 393,231
  triangles / 44 geometries / 17 textures), as expected for a config-only, zero-scene-object change.
  `git push origin main` succeeded (`119d76b`). Local tag only — `git push origin <tag>` still
  rejected, `HTTP 403` then `send-pack: unexpected disconnect` on the same call — same standing
  block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).
- `stable-2026-08-05-1830` — run 78 end: one sub-task, grew `gameplay/worldEvents.js`'s flavor pool
  from 20 to 22 entries (`red_comet`, `hunting_party`, DECISIONS.md ADR-0101) — config/data-only,
  zero mechanism change. Confirmed GOVERNANCE.md/CREDITS.md/assets_manifest.json `dateAdded`
  coverage (all asked for again by this run's incoming instruction as a "first" bootstrap step)
  were already complete from an earlier run; added the run-68-due `CATCH_UP.md` 10-run human-catchup
  entry (GOVERNANCE.md §13). `node --check` clean (62 files). Smoke suite **22/22 PASS** before and
  after. All 8 standing guards clean, zero WARN. Real headless-Chromium proof: both new event ids
  drawn from the live 22-entry pool, each rendered through the real `WorldEventToast` over the live
  scene (castle silhouette, player model, starlit sky), zero console/page errors. `perf_log.csv`
  `run78` row bit-identical to run75-77 on every GPU metric (46 draw calls / 393,231 triangles / 44
  geometries / 17 textures), as expected for a data-only change touching zero scene objects.
  `git push origin main` succeeded (`9702a49`). Local tag only — `git push origin <tag>` still
  rejected, `HTTP 403` then `send-pack: unexpected disconnect` on the same call — same standing
  block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).
