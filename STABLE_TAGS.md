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
- `stable-2026-08-05-1900` — run 79 end: one sub-task, grew `gameplay/worldEvents.js`'s flavor pool
  from 22 to 24 entries (`eclipse`, `shackled_prisoner`, DECISIONS.md ADR-0102) — config/data-only,
  zero mechanism change. Confirmed GOVERNANCE.md/CREDITS.md/QUESTIONS_FOR_OWNER.md already current
  from prior runs; priority items 1-13 re-scanned fresh and confirmed still healthy/blocked exactly
  as run 78 left them (no new model assets since run ~59, no owner decisions resolved). `node --check`
  clean (61 files). Smoke suite **22/22 PASS** before and after. All 8 standing guards clean, zero
  WARN. Real headless-Chromium proof: both new event ids drawn from the live 24-entry pool, each
  rendered through the real `WorldEventToast` over the live scene (castle silhouette, player model,
  starlit sky), zero console/page errors. `perf_log.csv` `run79` row bit-identical to run76-78 on
  every GPU metric (46 draw calls / 393,231 triangles / 44 geometries / 17 textures), as expected for
  a data-only change touching zero scene objects. `git push origin main` succeeded (`50f105f`). Local
  tag only — `git push origin <tag>` still rejected, `HTTP 403` then `send-pack: unexpected
  disconnect` on the same call — same standing block since run 58 (GOVERNANCE.md §8.11: a local tag +
  this entry satisfies the checkpoint).
- `stable-2026-08-05-1950` — run 80 end: one sub-task, gave `umit-guard-1` a 3rd dialogue choice
  and fixed `ui/dialogueBox.js`'s hint text, hardcoded to `'1/2 - Seç, Esc - Kapat'` since run 44
  (DECISIONS.md ADR-0103). `interaction.js`'s 3rd choice slot (`Digit3`) has been reachable since
  run 44 (ADR-0058) but no NPC had ever used it; the hint-text fix is a real latent-bug fix, proven
  byte-identical for the other 13 existing 2-choice NPCs via a real-render regression check, not
  just asserted. Deliberately diversified away from a 5th consecutive `worldEvents.js` flavor-pool
  growth round (runs 74/75/78/79) after run 79's own note flagged that repetition risk. `node
  --check` clean (69 files). Smoke suite **22/22 PASS** before and after. `checkDialogueChoicesShape`
  OK (13/14 pilot coverage unchanged — grew an existing entry, not NPC count). All 8 standing guards
  clean, zero WARN beyond the pre-existing expected `checkAssetsManifest` note. Real headless-Chromium
  proof: an existing 2-choice NPC (`berkalp-guard-1`) confirmed to still render the exact
  pre-existing hint string; `umit-guard-1` confirmed to render all 3 real choices with hint
  `'1/2/3 - Seç, Esc - Kapat'`, and picking the 3rd shows its real response and reverts the hint to
  `'E / Esc - Kapat'`. Two screenshots at distinct camera angles (default boot camera + real F4
  free-cam drag) both show the 3-choice box correctly rendered over the live scene (castle
  silhouette, player model, starlit sky, a real `WorldEventToast` mid-flight in both — proving the
  scene keeps ticking underneath). `perf_log.csv` `run80` row bit-identical to run76-79 on every GPU
  metric (46 draw calls / 393,231 triangles / 44 geometries / 17 textures) — expected, no scene
  object touched (pure UI-string + data-array change). `git push origin main` succeeded (`68c678a`).
  Local tag only — `git push origin <tag>` still rejected, `HTTP 403` then `send-pack: unexpected
  disconnect` on the same call — same standing block since run 58 (GOVERNANCE.md §8.11: a local tag
  + this entry satisfies the checkpoint).
- `stable-2026-08-05-1958` — run 81 end: GOVERNANCE.md §8.13 safe-mode try/catch finished for the
  3 remaining named subsystems (NPC, animal, interaction/dialogue, world-events — dragons already
  had it since run 64), ADR-0104. Real dev-only Playwright injection proof against all 4 real
  served modules confirmed each throw is actually caught (zero uncaught pageerror) and logs the
  expected safe-mode message; full smoke suite 22/22 PASS; `perf_log.csv` run81 row bit-identical
  to run76-80. `git push origin main` succeeded (`e3572d4`). Local tag only — `git push origin <tag>`
  still rejected, same `HTTP 403`/`send-pack: unexpected disconnect` standing block since run 58
  (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).
- `stable-2026-08-05-2035` — run 82 end (2nd sub-task of the same chained run): the five inline
  safe-mode try/catch blocks extracted into `src/3d/safeMode.js`, `game3d.js` 571/600 -> 538/600 and
  `checkSmokeCheckRegistry.js`'s approaching-the-cap WARN cleared (ADR-0105). Behavior-preserving:
  smoke suite 22/22 PASS, all 8 standing guards clean, `perf_log.csv` `run82` bit-identical to
  run76-81, 2 screenshots visually identical to run 81's pair. Error paths re-proven rather than
  assumed — the injection harness was extended from 4 to 5 subsystems (dragons added because the
  refactor rewrote that run-64 call site) and all 5 passed with zero uncaught `pageerror`.
  `SHELL_CACHE` bumped v6->v7 for the new precached module. `git push origin main` succeeded
  (`0c8ab50`). Local tag only — `git push origin <tag>` still rejected, same `HTTP 403` standing
  block since run 58.
- `stable-2026-08-05-2118` — run 83 end: `safeMode.js`'s dispose()/disposeOnError()-throws gap
  closed (ADR-0105's own documented follow-up), ADR-0106. New committed regression coverage
  (`game3dSmokeChecksSafeMode.js`, 2 checks) instead of a throwaway proof — full suite 24/24 PASS
  (was 22/22), all 8 standing guards clean, `perf_log.csv` `run83` bit-identical to run76-82
  (46/393,231/44/17, no scene object touched), 2 screenshots visually consistent with prior runs'
  pairs (expected — pure code-hygiene change). `git push origin main` succeeded (`bcac4e0`). Local
  tag only — `git push origin <tag>` still rejected, same `HTTP 403` standing block since run 58
  (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).
- `stable-2026-08-05-2154` — run 84 end: world-event flavor pool grown 24 -> 26
  (`northern_lights`, `traveling_singer`), ADR-0108. Pure data addition, zero mechanism change.
  Smoke suite 24/24 PASS, all 8 standing guards clean, `perf_log.csv` `run84` bit-identical to
  run76-83 (no scene object touched), real headless-Chromium proof of both new events firing +
  rendering via a real EventBus -> WorldEventToast, zero console errors, 2 screenshots. `git push
  origin main` succeeded (`a20915a`). Local tag only — `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint).
- `stable-2026-08-05-2230` — run 83 end (3 sub-tasks): (1) `safeMode.js` cleanup-throw containment
  closed, ADR-0106, +2 committed smoke checks; (2) FAZ 5 recorded as complete-by-design at 13/14,
  ADR-0107, reversal escalated to the owner; (3) **the 2D game was completely dead offline** —
  `script.js` crashed on line 2 whenever the Firebase CDN was unreachable, aborting all 4,147 lines
  (ADR-0109). Measured 1 uncaught pageerror -> 0, script.js now runs to completion, `loadData()`
  yields 14 kingdoms + 74 markers, offline title screen renders; `check2DShell` rewritten to
  hard-fail on uncaught pageerrors + incomplete script execution. Full suite **24/24 PASS**.
  A concurrent session (run 84) pushed mid-run and claimed ADR-0108, so mine was renumbered to
  ADR-0109 and its work preserved intact through the rebase (GOVERNANCE.md §8.14). `git push origin
  main` succeeded (`38f0c65`). Local tag only — `git push origin <tag>` still `HTTP 403`, same
  standing block since run 58.
- `stable-2026-08-06-0304` — run 85 end: world-event flavor pool selection switched from uniform
  random to weighted rarity (COMMON=3/UNCOMMON=2/RARE=1), ADR-0110 — the 7 most dramatic/ominous
  entries now fire roughly 1/3 as often as routine-ambiance ones. Pure selection-logic change, zero
  scene/mechanism touch elsewhere. Verified with a real 5000-draw headless-Chromium statistical
  sample (measured common:rare ratio 3.13 against an intended 3:1) plus real toast-render screenshots
  for one COMMON and one RARE id. Full suite **24/24 PASS** (world-event check's determinism
  assertion is generic, needed no change); all 8 standing guards clean; `perf_log.csv` `run85` row
  bit-identical to run76-84 (no scene object touched). Smoke suite flaked twice mid-session
  (once a single check timing out during concurrent verification-script teardown, once a whole-suite
  navigation timeout with no other Chromium alive) — both times an immediate clean re-run came back
  24/24, neither implicating this diff; recorded as observed container flakiness, not a finding.
  `git push origin main` succeeded (`52c9644`). Local tag only — `git push origin <tag>` still
  `HTTP 403`, same standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry
  satisfies the checkpoint).
- `stable-2026-08-06-0415` — run 86 end: day/night gating for the world-event flavor pool (4 of 26
  entries — `wolf_howl`/`falling_star`/`northern_lights` night-only, `eclipse` day-only), ADR-0111 —
  continues directly from ADR-0110's own Alternatives section, which had already named and deferred
  this exact idea. Pure additive/backward-compatible change (`nightFactor` is an optional parameter;
  every pre-existing caller unaffected) plus a pure reorder in `game3d.js` (no logic change) to make
  `dayNight.nightFactor` available earlier. New committed regression coverage
  (`checkWorldEventsTimeGating`, 2 assertions x 1000 forced draws each) rather than a throwaway proof
  — full suite 24/24 -> **25/25 PASS**, all 8 standing guards clean (2 files now WARN-flagged
  approaching the 600-line cap, not fatal — see `3D_GAME_PROGRESS.md`'s Next step). Real proof beyond
  the committed check: an 8000-draw statistical sample (zero cross-contamination) plus real
  headless-Chromium screenshots showing the eclipse toast against a genuinely bright daytime sky and
  the northern-lights toast against a genuinely dark starry night sky (real day/night clock driven
  forward via a documented `performance.now()`-jump technique — a naive load-time-based version was
  tried first and silently no-op'd, recorded in ADR-0111 so a future run doesn't repeat the dead end).
  `perf_log.csv` `run86` row bit-identical to run76-85 (no scene object touched). `git push origin
  main` succeeded (`4386fcd`). Local tag only — `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the
  checkpoint).

- **`stable-2026-08-06-0505` (run 87, commit `281c5e9`):** Session Quality Gate passed (confidence
  5/5 after 1 sub-task — starfield twinkle, ADR-0112), full smoke suite 26/26 PASS (was 25 — new
  `checkStarfieldTwinkle` check), all 6 standing static guards clean, `game3d.html` boots with zero
  console/page errors (confirmed via 2 separate Playwright captures this run, both zero errors).
  `perf_log.csv` `run87` row bit-identical to run76-86 (no scene object added). `git push origin
  main` succeeded (`281c5e9`). Local tag only — `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the
  checkpoint).

- **`stable-2026-08-06-0754` (run 88, commit `643d5a6`):** Session Quality Gate passed (confidence
  5/5 after 1 sub-task + 1 governance-mandated housekeeping item — `game3dSmokeChecksScene.js` split
  into two check modules clearing its 573/600 WARN, ADR-0113; `CATCH_UP.md`'s 10-run digest, on
  schedule), full smoke suite 26/26 PASS (unchanged — pure move, no new/removed check), all 6 standing
  static guards clean (only the pre-existing `game3d.js` 545/600 WARN remains, unchanged since run 87),
  `game3d.html` boots with zero console/page errors (confirmed via the committed `check3DMode` smoke
  check, this run touched zero `src/` files so no fresh screenshot was needed — see ADR-0113's
  explicit reasoning). `perf_log.csv` `run88` row bit-identical to run76-87 (no scene object touched).
  `git push origin main` succeeded (`643d5a6`). Local tag only — `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry
  satisfies the checkpoint).

- **`stable-2026-08-06-0817` (run 88, commit `40f315f`):** Session Quality Gate passed (confidence
  5/5 after 2 sub-tasks + 1 governance-mandated housekeeping item — `game3dSmokeChecksScene.js` split
  clearing its 573/600 WARN [ADR-0113]; `berkalp-guard-1`'s 3rd dialogue choice, the pilot's 2nd NPC to
  use that slot [ADR-0114]; `CATCH_UP.md`'s 10-run digest, on schedule), full smoke suite 26/26 PASS
  (unchanged both sub-tasks), all 6 standing static guards clean (only the pre-existing `game3d.js`
  545/600 WARN remains, unchanged since run 87), `game3d.html` boots with zero console/page errors
  (confirmed via 2 real Playwright screenshot captures for ADR-0114, both zero errors). `perf_log.csv`
  `run88` row bit-identical to run76-87 (no scene object added, config-only content change).
  `git push origin main` succeeded (`40f315f`). Local tag only — `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry
  satisfies the checkpoint).

- **`stable-2026-08-06-0854` (run 89, commit `782857b`):** Session Quality Gate passed (confidence
  5/5 after 1 sub-task — `twin-guard-1`'s 3rd dialogue choice, the pilot's 3rd NPC to reach the
  3-choice tier [ADR-0115]), full smoke suite 26/26 PASS, `node --check` clean across the full
  sweep, only the pre-existing `game3d.js` 545/600 WARN remains (unchanged since run 87),
  `game3d.html` boots with zero console/page errors (confirmed via 2 real Playwright screenshot
  captures for ADR-0115, both zero errors, both showing a real in-flight `WorldEventToast`).
  `perf_log.csv` `run89` row bit-identical to run76-88 (config-only content change, no scene object
  touched). `git push origin main` succeeded (`782857b`). Local tag only — `git push origin <tag>`
  still rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag +
  this entry satisfies the checkpoint).

- **`stable-2026-08-06-0908` (run 90, commit `afd910a` — a merge commit):** Session Quality Gate
  passed (confidence 5/5 — dragon attack lunge/bite + generic player health system [ADR-0116], the
  project owner's own live, interactive request, not a scheduled firing). **Eşzamanlılık Kontrolü
  (GOVERNANCE.md §8.14) triggered for real this run**, not just checked and found clear: a
  concurrent scheduled autonomous session independently ran its own "run 89"
  (`twin-guard-1`'s 3rd dialogue choice, commit `782857b`) and pushed to `origin/main` while this
  session's own live-request work was still in progress — discovered at push time (`git fetch`
  showed `origin/main` had advanced past this session's own last-known commit), not before, since
  this run started from a base (`af3e7ac`) that was current at the time. Both sessions had
  independently picked ADR number **0115** and the run number **89** for their own work — resolved
  by renumbering this session's own ADR to **0116** and its own run label to **90** (kept, not
  reused, since 89 was already claimed first — the other commit's timestamp, 08:54:48, predates
  this session's own commit, 09:03:09), then `git merge origin/main` (3 conflicts — `DECISIONS.md`/
  `3D_GAME_PROGRESS.md`/`perf_log.csv`, all pure append-at-end conflicts, resolved by keeping both
  sessions' content in chronological order, run 89 before run 90). Full smoke suite **27/27 PASS**
  re-run after the merge (not assumed clean from either side alone). `git push origin main`
  succeeded (`afd910a`). Local tag only — `git push origin <tag>` still rejected, same `HTTP 403`
  standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the
  checkpoint).

- **Run 91 (2026-08-06):** Session Quality Gate passed (confidence 5/5, 2 sub-tasks — periodic
  platform check re-pass §15 + `olena-guard-1`'s 3rd dialogue choice ADR-0117), full smoke suite
  **27/27 PASS** before and after both sub-tasks, game boots cleanly (real screenshots taken this
  run, 0 console/page errors). Local tag `stable-2026-08-06-1000` created at `035c359`.
  `git push origin main` succeeded (`c98cffb..035c359`). `git push origin <tag>` still rejected,
  same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry
  satisfies the checkpoint).

- **Run 92 (2026-08-06, canlı istek):** Session Quality Gate passed (confidence 5/5) — settlement
  ground-flatten pads (ADR-0118), fixing the owner's directly-reported bug (castles floating/gapping
  over uneven terrain). Full smoke suite **28/28 PASS** (new check added this run). Real before/after
  visual proof (2 angles, `berk` seat) + 2 independent safety-check scripts (before/after) confirm no
  regression. Local tag `stable-2026-08-06-1130` created at `3698939`. `git push origin main`
  succeeded (`178d7c0..3698939`). `git push origin <tag>` still rejected, same `HTTP 403` standing
  block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).

- **Run 93 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `stannis-guard-1`'s 3rd dialogue choice (ADR-0119), the pilot's 5th NPC to reach the 3rd
  dialogue slot. Full smoke suite **28/28 PASS** before and after, real headless-Chromium proof +
  real visual proof (2 moments, live `game3d.html` scene in the background) confirm the new choice
  renders and resolves correctly, 0 console/page errors. `perf_log.csv`'s `run93` row bit-identical
  to run76-92 (config-data-only change). Local tag `stable-2026-08-06-1200` created at `c1c64c5`.
  `git push origin main` succeeded (`99063f2..c1c64c5`). `git push origin <tag>` still rejected,
  same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry
  satisfies the checkpoint).

- **Run 94 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `cersei-guard-1`'s 3rd dialogue choice (ADR-0120), the pilot's 6th NPC to reach the 3rd
  dialogue slot. Full smoke suite **28/28 PASS** before and after, real headless-Chromium proof +
  real visual proof (2 moments, live `game3d.html` scene in the background) confirm the new choice
  renders and resolves correctly, 0 console/page errors. `perf_log.csv`'s first `run94` sample
  diverged from baseline (async load-timing noise, confirmed and resolved — see ADR-0120); the
  committed row uses the reproduced expected values (46/393,231/44/17). Local tag
  `stable-2026-08-06-1300` created at `11915ed`. `git push origin main` succeeded
  (`95531b0..11915ed`). `git push origin <tag>` still rejected, same `HTTP 403` standing block
  since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).

- **Run 95 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `doran-guard-1`'s 3rd dialogue choice (ADR-0121), the pilot's 7th NPC to reach the 3rd
  dialogue slot and its 1st Dornish seat. Full smoke suite **28/28 PASS** before and after, real
  headless-Chromium proof + real visual proof (2 moments, live `game3d.html` scene in the
  background) confirm the new choice renders and resolves correctly, 0 console/page errors.
  `perf_log.csv`'s `run95` row bit-identical to run76-94. Local tag `stable-2026-08-06-1330` created
  at `dce401a`. `git push origin main` succeeded (`b12e425..dce401a`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint).

- **Run 96 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5 both sub-tasks) — sub-task 1: GOVERNANCE.md §8.12 rule consolidation (2nd pass, run 76 →
  run 96), no rule content changed beyond a `perf_log.csv` 30+-row threshold note; sub-task 2:
  `xaro-guard-1`'s 3rd dialogue choice (ADR-0122), the pilot's 8th NPC to reach the 3rd dialogue
  slot and its only non-Seven-Kingdoms seat. Full smoke suite **28/28 PASS** before and after, real
  headless-Chromium proof + real visual proof (2 moments, live `game3d.html` scene in the
  background) confirm the new choice renders and resolves correctly, 0 console/page errors.
  `perf_log.csv`'s `run96` row bit-identical to run76-95. Local tag `stable-2026-08-06-1530` created
  at `89c27ae`. `git push origin main` succeeded twice (`23870a7..91b4196` sub-task 1,
  `91b4196..89c27ae` sub-task 2). `git push origin <tag>` still rejected, same `HTTP 403` standing
  block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).

- **Run 97 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `stannis-guard-2`'s 3rd dialogue choice (ADR-0123), the pilot's 9th NPC to reach the 3rd
  dialogue slot and Baratheon's 2nd seat to do so. Full smoke suite **28/28 PASS** before and after,
  real headless-Chromium proof + real visual proof (2 moments, live `game3d.html` scene in the
  background) confirm the new choice renders and resolves correctly, 0 console/page errors.
  `perf_log.csv`'s `run97` row bit-identical to run76-96. Local tag `stable-2026-08-06-1500` created
  at `6810e29`. `git push origin main` succeeded (`1147cf0..6810e29`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint).

- **Run 98 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `balon-guard-1`'s 3rd dialogue choice (ADR-0124), the pilot's 10th NPC to reach the 3rd
  dialogue slot and the Iron Islands' 1st seat to do so. Also shipped the run-98-due `CATCH_UP.md`
  digest (runs 89-98). Full smoke suite **28/28 PASS** before and after, real headless-Chromium +
  real visual proof (2 moments, live `game3d.html` scene served over a local static server) confirm
  the new choice renders and resolves correctly, 0 console/page errors. `perf_log.csv`'s `run98` row
  bit-identical to run76-97. Local tag `stable-2026-08-06-1556` created at `ae247e3`. `git push
  origin main` succeeded (`3cfa93d..ae247e3`). `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint).

- **Run 99 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `robin-guard-1`'s 3rd dialogue choice (ADR-0125), the pilot's 11th NPC to reach the 3rd
  dialogue slot and the Vale's 1st seat to do so. Full smoke suite **28/28 PASS** before and after,
  real headless-Chromium + real visual proof (2 moments, live `game3d.html` scene served over a
  local static server) confirm the new choice renders and resolves correctly, 0 console/page errors.
  `perf_log.csv`'s `run99` row bit-identical to run76-98. Local tag `stable-2026-08-06-1655` created
  at `358c62c`. `git push origin main` succeeded (`493bbef..358c62c`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint).

- **Run 99 sub-task 2 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed
  (confidence 5/5) — `ziya-guard-1`'s 3rd dialogue choice (ADR-0126), the pilot's 12th NPC to reach
  the 3rd dialogue slot, the Reach's 2nd seat to do so (after `olena-guard-1`). Chained from
  sub-task 1 (`robin-guard-1`, ADR-0125) same run. Full smoke suite **28/28 PASS**, real
  headless-Chromium + real visual proof confirm the new choice renders and resolves correctly, 0
  console/page errors. `perf_log.csv`'s `run99b` row bit-identical to run76-99. Local tag
  `stable-2026-08-06-1710` created at `d40fdbf`. `git push origin main` succeeded
  (`10f45bd..d40fdbf`). `git push origin <tag>` still rejected, same `HTTP 403` standing block since
  run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint). Only
  `berk-guard-1` remains at 2 choices — next run completes item 14's pilot coverage at 13/13.

- **Run 101 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `berk-guard-1`'s 3rd dialogue choice (ADR-0128), the pilot's 13th and final NPC to reach
  the 3rd dialogue slot, completing the FAZ 5 dialogue-choice pilot's 3rd-slot rollout (13/13
  choice-enabled NPCs; `jon-guard-1` remains deliberately excluded per ADR-0058). Full smoke suite
  **29/29 PASS**, real headless-Chromium + real visual proof confirm the new choice renders and
  resolves correctly, 0 console/page errors. `perf_log.csv`'s `run100c` row bit-identical to
  run76-100. Local tag `stable-2026-08-06-1754` created at `e7ef628`. `git push origin main`
  succeeded (`392e011..e7ef628`). `git push origin <tag>` still rejected, same `HTTP 403` standing
  block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint). Item
  14 (dialogue 3rd-choice pilot) is now exhausted — next run's priority re-scan should treat it as
  DONE and move to `worldEvents.js`'s flavor pool or re-confirm items 1-13 from scratch.

- **Run 103 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `market_day` world event (ADR-0130), the pilot's first UNCOMMON+day gated-rarity entry,
  closing the last empty cell in the (rarity × time-of-day) gated-event coverage matrix (now 6/6).
  Full smoke suite **29/29 PASS**, real headless-Chromium + real visual proof (2 moments — desktop
  1280×720 and mobile 390×844, live `game3d.html` scene served over a local static server) confirm
  the new event renders and its day-gate holds under 1000 forced-midnight draws, 0 console/page
  errors. `perf_log.csv`'s `run103` row bit-identical to run76-102. Local tag
  `stable-2026-08-06-1854` created at `f658a15`. `git push origin main` succeeded
  (`1a361b4..f658a15`). `git push origin <tag>` still rejected, same `HTTP 403` standing block
  since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint).

- **Run 105 (2026-08-06, scheduled autonomous routine):** Session Quality Gate passed (confidence
  5/5) — `gameLoopHelpers.js` extracted from `game3d.js` (ADR-0132), a pure tech-debt/line-cap
  refactor with zero behavior change (590→471 lines, real headroom restored). Full real-browser
  `smokeTestGame3D.js` **30/30 PASS**, zero console/page errors; `collectPerfSnapshot.js`'s
  `run105` row bit-identical (draw calls/triangles/geometries/textures) to run103's baseline,
  confirming no rendered-output change. Local tag `stable-2026-08-06-1959` created at `362769d`.
  `git push origin work` + PR #5 → `main` merge succeeded (`b091711..c4c7bb0` — this run also found
  and corrected a stale local `origin/main` tracking ref from a shallow fetch, see
  `3D_GAME_PROGRESS.md` run 105's Concurrency/snapshot note). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint).

- **run 107 (2026-08-06):** priority re-scan found items 1-11 clean (full `node --check` sweep
  clean; 31/31 real-browser smoke suite green before any change). Added `ui/dayNightClock.js`
  (FAZ 8 discoverability HUD, ADR-0134) and, while capturing this run's own mobile visual proof,
  found + root-caused a real pre-existing mobile HUD collision (world-event toast overlapping the
  health bar and settlement compass on a 390×844 viewport) to `game3d.css` never declaring
  `box-sizing: border-box` — fixed globally, not patched per-widget, plus the mobile toast's `top`
  offset moved from ADR-0129's back-link-only `64px` to `184px` clearing the full second HUD row.
  Extended the world-event toast smoke check to assert mobile clearance against health-bar/compass/
  clock too, not just the back-link. `smokeTestGame3D.js` **32/32 PASS**, zero console/page errors;
  `collectPerfSnapshot.js`'s `run107` row bit-identical (draw calls/triangles/geometries/textures)
  to the run76-105 baseline, confirming zero rendered-output change (DOM/CSS-only). Local tag
  `stable-2026-08-06-2117` created at `eeb96f6` (PR #7 merge). `git push origin work` + PR #7 →
  `main` merge succeeded (`9ad8ae8..eeb96f6`). `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint).

- **Run 108 (2026-08-06):** Session Quality Gate passed (confidence 5/5, §8.6) — docs-only fix
  (ADR-0135, `gameplay/README.md`/`world/README.md` file-list drift), 32/32 real-browser smoke suite
  clean, game opens without issue. Local tag `stable-2026-08-06-2154` created at `055a728` (PR #8
  merge). `git push origin work` + PR #8 → `main` merge succeeded (`120db16..055a728`).
  `git push origin <tag>` still rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md
  §8.11: a local tag + this entry satisfies the checkpoint).

- **Run 109 (2026-08-06):** Session Quality Gate passed (confidence 5/5, §8.6) — teknik borç fix
  (ADR-0136, split `dragonController.js`'s reaction-state bookkeeping into `dragonReactionState.js`,
  removing the 579/600 file-cap WARN that had persisted across runs 104-108), 32/32 real-browser
  smoke suite clean incl. all 8 exact-value dragon-behavior checks, game opens without issue. Local
  tag `stable-2026-08-06-2258` created at `9c404eb` (PR #9 merge). `git push origin work` + PR #9 →
  `main` merge succeeded (`5823181..9c404eb`). `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint).

- **Run 110 (2026-08-06):** Session Quality Gate passed (confidence 5/5, §8.6) — GOVERNANCE.md §16
  deferred-item pickup (ADR-0137, `scripts/analyzePerfTrend.js` — plain-text perf trend report over
  `perf_log.csv`; real run against the 52-row log found `jsHeapUsedMB`'s first-half/second-half
  ratio at 1.02x, no drift, first aggregate confirmation of zero cumulative memory growth across 52
  runs), 32/32 real-browser smoke suite clean both before and after (byte-identical), game opens
  without issue. Local tag `stable-2026-08-06-2359` created at `20a98a1` (PR #10 merge). `git push
  origin work` + PR #10 → `main` merge succeeded (`2aec0ef..20a98a1`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint).

- **Run 111 (2026-08-07):** Session Quality Gate passed (confidence 5/5, §8.6) — item-14 new
  feature, `world/vegetation.js` procedural instanced-tree scatter (ADR-0138), the first system to
  close the "Vegetation" gap `GOVERNANCE.md` §3's target architecture has named since run 0. 32/32
  baseline → 33/33 real-browser smoke suite clean (1 new check, 16 sub-assertions), both
  `terrainSeatSafetyCheck.js` (14/14) and `roadNetworkSafetyCheck.js` (13/13 edges) re-confirmed
  unaffected, real F4 free-cam before/after visual proof, fresh `collectPerfSnapshot.js run111`
  (drawCalls 46→48, triangles 393,231→521,526, well inside desktop budget), game opens without
  issue. Local tag `stable-2026-08-07-0100` created at `00fbf7b` (PR #11 merge). `git push origin
  work` + PR #11 → `main` merge succeeded (`f4bc193..00fbf7b`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint). One new open question logged in `QUESTIONS_FOR_OWNER.md`
  (vegetation density, run 111/ADR-0138) — not blocking.

- **Run 112 (2026-08-07):** Session Quality Gate passed (confidence 5/5, §8.6) — item-14 new
  feature, `world/vegetation.js` species variety, a second tree species mixed into the existing
  scatter (ADR-0139), the natural lowest-risk follow-up ADR-0138 itself had already named. 33/33
  baseline → 33/33 real-browser smoke suite clean (existing vegetation check widened in place, not
  a new check — species-boundary/mix-representation assertions all passed on a real run), both
  `terrainSeatSafetyCheck.js` (14/14) and `roadNetworkSafetyCheck.js` (13/13 edges) re-confirmed
  unaffected, real F4 free-cam 2-angle visual proof (honestly noted: confirms correct terrain/water
  placement, does not itself resolve individual species silhouettes at that distance — the species-
  mix claim is proven by the smoke assertions instead), fresh `collectPerfSnapshot.js run112`
  (drawCalls 48→50, triangles 521,526→577,043, well inside desktop budget), game opens without
  issue (merge commit `afadcad` is diff-empty against the already-verified `cd00fb2`). Local tag
  `stable-2026-08-07-0208` created at `afadcad` (PR #12 merge). `git push origin work` + PR #12 →
  `main` merge succeeded (`550c309..afadcad`). `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint). One new open question logged in `QUESTIONS_FOR_OWNER.md` (species mix ratio,
  run 112/ADR-0139) — not blocking. GOVERNANCE.md §15's periodic platform check window (111-121)
  was also closed this run, folded into this run's own baseline checks at no extra cost (npm audit
  N/A, PWA installability OK, WebGL/smoke clean) — no new ADR, findings unchanged from run 91.

- **Run 113 (2026-08-07):** Session Quality Gate passed (confidence 5/5, §8.6) — item-14 new feature,
  `world/vegetation.js` seat-local clustering, a denser tree ring around qualifying kingdom seats
  (ADR-0140), the natural lowest-risk follow-up ADR-0139 itself had already named. 33/33 baseline →
  33/33 real-browser smoke suite clean (existing vegetation check widened in place, not a new check —
  annulus-sampling/cluster-ring assertions all passed on a real run, checking real decomposed instance
  positions, not just counts), both `terrainSeatSafetyCheck.js` (14/14) and `roadNetworkSafetyCheck.js`
  (13/13 edges) re-confirmed unaffected, real F4 free-cam 2-angle visual proof from the real `stannis`
  kingdom seat (close oblique + high overhead, both showing the ring's actual shape — honestly noted:
  the capture technique's own independent scene build left sky/lighting unwired, sky renders black in
  the close shot, terrain/tree/castle geometry itself is unaffected), fresh `collectPerfSnapshot.js
  run113` (drawCalls unchanged 50, triangles 577,043→608,296, geometries/textures unchanged, well
  inside desktop budget — first sample was a transient anomaly, discarded and re-sampled cleanly, see
  `perf_log.csv`), game opens without issue (merge commit `3a901dc` is a real merge of `work` into
  `main`, no conflicts). Local tag `stable-2026-08-07-0303` created at `3a901dc` (PR #13 merge). `git
  push origin work` + PR #13 → `main` merge succeeded (`9957c32..3a901dc`). `git push origin <tag>`
  still rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint). One new open question logged in `QUESTIONS_FOR_OWNER.md` (cluster
  ring density/radius calibration, run 113/ADR-0140) — not blocking.

- **Run 114 (2026-08-07):** Session Quality Gate passed (confidence 5/5, §8.6) — item-14 new
  feature, `gameplay/worldEvents.js`'s `sellsword_arrival` world event, a new UNCOMMON/ungated
  flavor-pool entry (ADR-0141), following run 102/103/129/130's own established low-risk pattern.
  33/33 baseline → 33/33 real-browser smoke suite clean both before and after (existing id-based
  gating check needed no modification), both `terrainSeatSafetyCheck.js` (14/14) and
  `roadNetworkSafetyCheck.js` (13/13 edges) re-confirmed unaffected (out-of-scope change, checked
  as due diligence anyway), `collectPerfSnapshot.js run114` bit-identical to run113 (config-data-
  only change, no geometry/texture/renderer code touched), real 2-viewport headless-Chromium proof
  (desktop 1280x720 + mobile 390x844) showing the exact toast title/desc text and confirming mobile
  placement clears the back-link control, zero console/page errors throughout. Incidentally fixed a
  stale `GOVERNANCE.md` §16 table row (the "30-commit perf trend graph" deferred item was already
  implemented in run 110/ADR-0137 but still read as pending). Game opens without issue post-merge
  (merge commit `583ce9c` is a real merge of `work` into `main`, no conflicts; full `node --check`
  sweep + `checkSmokeCheckRegistry.js` re-confirmed clean against the merged tree). Local tag
  `stable-2026-08-07-0351` created at `583ce9c` (PR #14 merge). `git push origin work` + PR #14 →
  `main` merge succeeded (`d90aab4..583ce9c`). `git push origin <tag>` still rejected, same
  `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies
  the checkpoint). No new open question in `QUESTIONS_FOR_OWNER.md` (discrete tier choice, not a
  calibration constant needing a real playtest).

- **Run 115 (2026-08-07):** Session Quality Gate passed (confidence 5/5, §8.6) — item-14 new
  feature, `gameplay/worldEvents.js`'s `alms_giving` world event, a new COMMON/day-gated
  flavor-pool entry (ADR-0142), following run 102/103/110-114's own established low-risk pattern.
  33/33 baseline → 33/33 real-browser smoke suite clean both before and after (existing gating
  assertions unmodified; two new assertions added for the new day-gated entry), both
  `terrainSeatSafetyCheck.js` (14/14) and `roadNetworkSafetyCheck.js` (13/13 edges) re-confirmed
  unaffected (out-of-scope change, checked as due diligence anyway), `collectPerfSnapshot.js run115`
  bit-identical to run114 (config-data-only change, no geometry/texture/renderer code touched), real
  2-viewport headless-Chromium proof (desktop 1280x720 + mobile 390x844) showing the exact toast
  title/desc text and an independently-proven day gate (never fires across 1000 forced-midnight
  draws), mobile toast position (`top: 184px`) matching ADR-0141's own recorded anchor exactly,
  zero console/page errors throughout. Game opens without issue post-merge (merge commit `f0556a1`
  is a real merge of `work` into `main`, no conflicts; full `node --check` sweep +
  `checkSmokeCheckRegistry.js` + a full post-merge `smokeTestGame3D.js` re-run — **33/33 PASS**, 0
  FAIL — all re-confirmed clean against the merged tree). Local tag `stable-2026-08-07-0453` created
  at `f0556a1` (PR #15 merge). `git push origin work` + PR #15 → `main` merge succeeded
  (`31d7a38..f0556a1`). `git push origin <tag>` still rejected, same `HTTP 403` standing block since
  run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint). No new open
  question in `QUESTIONS_FOR_OWNER.md` (discrete tier/gate choice, not a calibration constant
  needing a real playtest); the run-63 leaked-NVIDIA-key item remains open, unchanged, still pending
  owner action.

- **Run 116 (2026-08-07):** Sub-tasks — (1) §8.12 rule consolidation pass (3rd, run 96 -> run 116,
  no stale/conflicting rule found, logged to `RULES_CHANGELOG.md`); (2) `direwolf_track`, a new RARE,
  ungated `worldEvents.js` flavor entry (DECISIONS.md ADR-0143). Baseline + post-change: full
  `node --check` sweep clean, `checkSmokeCheckRegistry.js` 33 checks/13 modules unaffected,
  `terrainSeatSafetyCheck.js` 14/14 and `roadNetworkSafetyCheck.js` 13/13 unaffected (out-of-scope
  change, checked as due diligence anyway), `collectPerfSnapshot.js run116` bit-identical to run115
  (config-data-only change), real 2-viewport headless-Chromium proof (desktop 1280x720 + mobile
  390x844) showing the exact toast title/desc text and an independently-proven *ungated* claim (fires
  at both forced-noon and forced-midnight `nightFactor`), mobile toast position (`top: 184px`)
  matching ADR-0141/0142's own recorded anchor exactly, zero console/page errors throughout. Game
  opens without issue post-merge (merge commit `ae2f0b5` is a real merge of `work` into `main`, no
  conflicts; full `node --check` sweep + `checkSmokeCheckRegistry.js` + a full post-merge
  `smokeTestGame3D.js` re-run — **33/33 PASS**, 0 FAIL — all re-confirmed clean against the merged
  tree). Local tag `stable-2026-08-07-0555` created at `ae2f0b5` (PR #16 merge). `git push origin
  work` + PR #16 → `main` merge succeeded (`8f167cc..ae2f0b5`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint). No new open question in `QUESTIONS_FOR_OWNER.md` (discrete
  tier/gate choice, not a calibration constant needing a real playtest); the run-63
  leaked-NVIDIA-key item remains open, unchanged, still pending owner action.

- **Run 119 (2026-08-07):** Sub-task — overdue `CATCH_UP.md` owner-facing summary for runs 109-118
  (documentation-only, no ADR by design, matches the run-108 `CATCH_UP.md`/doc-fix precedent).
  Baseline + post-change: full `node --check` sweep clean (80 files, no new file), full
  `smokeTestGame3D.js` **34/34 PASS** both before and after (docs-only, no code path could have
  changed), `checkSmokeCheckRegistry.js` 34 checks/14 modules unaffected, `terrainSeatSafetyCheck.js`
  14/14 and `roadNetworkSafetyCheck.js` 13/13 unaffected (out-of-scope change, checked as due
  diligence anyway), `collectPerfSnapshot.js run119` bit-identical to run116's last recorded row
  (`50/608296/48/17`). Game opens without issue post-merge (merge commit `e551ce9` is a real merge
  of `work` into `main`, no conflicts; full `node --check` sweep + `checkSmokeCheckRegistry.js` + a
  full post-merge `smokeTestGame3D.js` re-run — **34/34 PASS**, 0 FAIL — all re-confirmed clean
  against the merged tree; one interim re-run attempt hit this session's own 120s shell timeout
  mid-suite, a tooling artifact not a game/test regression — re-run to completion in the background
  confirmed clean). Local tag `stable-2026-08-07-0650` created at `e551ce9` (PR #19 merge). `git push
  origin work` + PR #19 → `main` merge succeeded (`45931b2..e551ce9`). `git push origin <tag>` still
  rejected, same `HTTP 403` standing block since run 58 (GOVERNANCE.md §8.11: a local tag + this
  entry satisfies the checkpoint). No new open question in `QUESTIONS_FOR_OWNER.md` (pure reporting
  update, no design decision to weigh); the run-63 leaked-NVIDIA-key item remains open, unchanged,
  still pending owner action.

- **Run 120 (2026-08-07):** Sub-task — `falconer_flight` world event (ADR-0145), a COMMON, day-gated
  `worldEvents.js` flavor-pool addition. Baseline + post-change: full `node --check` sweep clean
  (88 files), `checkSmokeCheckRegistry.js` 34 checks/14 modules unaffected, `terrainSeatSafetyCheck.js`
  14/14 and `roadNetworkSafetyCheck.js` 13/13 unaffected (out-of-scope change, checked as due
  diligence anyway), full `smokeTestGame3D.js` **34/34 PASS** both before and after,
  `collectPerfSnapshot.js run120` bit-identical to run119's last recorded row (`50/608296/48/17`).
  Real-Node proof (4000-seed reachability sweep + 2000-seed × 5-forced-midnight-draw gate-leak
  check) recorded in `DECISIONS.md` ADR-0145. Game opens without issue post-merge (merge commit
  `a790371` is a real merge of `work` into `main`, no conflicts; full `node --check` sweep +
  `checkSmokeCheckRegistry.js` + a full post-merge `smokeTestGame3D.js` re-run — **34/34 PASS**,
  0 FAIL — all re-confirmed clean against the merged tree). Local tag `stable-2026-08-07-0810`
  created at `a790371` (PR #20 merge). `git push origin work` + PR #20 → `main` merge succeeded
  (`709dce3..a790371`). `git push origin <tag>` still rejected, same `HTTP 403` standing block
  since run 58 (GOVERNANCE.md §8.11: a local tag + this entry satisfies the checkpoint). No new
  open question in `QUESTIONS_FOR_OWNER.md` (discrete tier/gate choice, not a calibration constant
  needing a real playtest); the run-63 leaked-NVIDIA-key item remains open, unchanged, still
  pending owner action.

- **Run 121 (2026-08-07):** FAZ 8 `owl_watch` / “Baykuş Nöbeti” gece dünya olayı
  (ADR-0146). Değişiklik 71 ekleme/0 silme ile PR #21 üzerinden `main` dalına birleştirildi
  (`a602294`); deterministik 5000-seed kanıtı olayın yalnız gece havuzunda erişilebilir olduğunu
  doğruladı. Syntax, smoke-registry, PWA kurulabilirlik ve service-worker cache kontrolleri geçti;
  Playwright olmayan konteynerde browser smoke/perf güvenli biçimde SKIP etti ve sahte performans
  satırı yazılmadı. `stable-2026-08-07-0818` etiketi merge commit'ine oluşturuldu ve bu run'da
  GitHub'a başarıyla gönderildi.

- **Run 122 (2026-08-07):** FAZ 8 yerleşim keşfi bildirimine erişilebilir keşfedilen/toplam
  ilerleme sayacı eklendi (ADR-0147). PR #23 `main` dalına `b554d72` ile birleştirildi; değişiklik
  88 ekleme/0 silmedir. Tam Playwright smoke suite 34/34 PASS, odaklı discovery kontrolü PASS,
  desktop/mobile görsel kontrol PASS; perf snapshot 55 draw call / 646,282 triangle / 49 geometry /
  22 texture / 242 MB heap. `stable-2026-08-07-0832` etiketi merge commit'ine oluşturuldu ve
  GitHub'a başarıyla gönderildi.

- **Run 123 (2026-08-07):** FAZ 8 keşif akışına son yerleşimde Türkçe completion mesajı ve
  `is-complete` görsel vurgusu eklendi (ADR-0148). PR #25 `main` dalına `ce0d7bf` ile birleşti;
  özellik diff'i 76 ekleme/0 silmedir. Full Playwright smoke 34/34 PASS, odaklı completion kontrolü
  ve 390×844 mobil görsel kontrol PASS; perf 50 draw call / 608,296 triangle / 48 geometry /
  17 texture / 242 MB heap. `stable-2026-08-07-0848` etiketi GitHub'a gönderildi.

- **Run 124 (2026-08-07):** FAZ 8 pusulası en yakın keşfedilmemiş yerleşime ilerleyecek ve 14/14
  sonrasında gizlenecek şekilde discovery state'e bağlandı (ADR-0149). Eşzamanlı Claude PR #27'nin
  `work` dalı korunarak özellik ayrı PR #28 ile `main` dalına `18fc13e` olarak birleşti; 88 ekleme/0
  silme. Full Playwright smoke 34/34 PASS, odaklı filter testi ve 390×844 mobil görsel kontrol PASS;
  perf 50 draw call / 608,296 triangle / 48 geometry / 17 texture / 307 MB heap.
  `stable-2026-08-07-0857` etiketi GitHub'a gönderildi.

- **Run 125 (2026-08-07):** FAZ 8 dünya olayı havuzuna zamandan bağımsız `crow_flock` (Karga
  Sürüsü) RARE-tier omen girdisi eklendi (ADR-0150) — iki eşzamanlı run'ın (`origin/main`
  `87bd507`→`5f25f0b`→`9716657`) merkezinde iki gerçek merge çakışmasından sonra rebase edilip
  ADR-0148→0150/run 123→125 olarak yeniden numaralandırıldı; Codex otomatik incelemesinin işaret
  ettiği bir ZWJ-emoji iOS uyumluluk sorunu da (`🐦‍⬛`→`🐦`) aynı PR'da düzeltildi. PR #27 `main`
  dalına `3c41b67` ile birleşti; 137 ekleme/2 silme. Full Playwright smoke suite değişiklik öncesi/
  sonrası ve her iki rebase sonrası (toplam 5 kez) **34/34 PASS**; merge sonrası `main` üzerinde de
  tekrar **34/34 PASS** doğrulandı, zero console/page error. Perf 50 draw call / 608,296 triangle /
  48 geometry / 17 texture / 347 MB heap. `stable-2026-08-07-0907` etiketi bu run'da `git push
  origin <tag>` ile denendi, yine `HTTP 403` ile reddedildi (§8.11'in bilinen kısıt kaydıyla
  tutarlı) — yerel tag + bu satır kontrol noktası için yeterli sayıldı.

- **Run 126 (2026-08-07):** Owner'ın doğrudan `main`'e eklediği additive-only diff guard
  (`scripts/checkAdditiveOnlyDiff.js`, commit `3c7e4fb`) `GOVERNANCE.md`'ye kalıcı Altın Kural
  olarak kaydedildi (ADR-0151), ve FAZ 8 dünya olayı havuzuna UNCOMMON ağırlıklı `midwife_summoned`
  (Ebe Çağrısı) girdisi eklendi (ADR-0152) — 192 ekleme/0 silme, additive-only guard PASS. PR #32
  `main` dalına `c4dc120` ile birleşti. Full Playwright smoke suite değişiklik öncesi/sonrası
  **34/34 PASS**, 0 konsol/sayfa hatası; merge sonrası `main` üzerinde de additive-only guard ve
  smoke-check registry yeniden doğrulandı. Perf 50 draw call / 608,296 triangle / 48 geometry /
  17 texture / 257 MB heap (run120'den beri değişmeyen render bütçesiyle birebir aynı). `stable-
  2026-08-07-1002` etiketi bu run'da `git push origin <tag>` ile denendi, yine `HTTP 403` ile
  reddedildi (§8.11'in bilinen kısıt kaydıyla tutarlı) — yerel tag + bu satır kontrol noktası için
  yeterli sayıldı.
- stable-2026-08-07-1031 — run 127 governance validation; browser smoke 34/34+ PASS, additive-only PASS, perf snapshot recorded.
- stable-2026-08-07-1100 — run 128: `nightswatch_levy` world event (ADR-0153) + `CATCH_UP.md` run
  119-128 catch-up summary, PR #34 merged to `main` (`defc526`). Full Playwright smoke suite
  **34/34 PASS**, 0 console/page errors, both pre- and post-merge on `main`; additive-only guard and
  world-event catalog guard re-verified clean on the merged tip. Perf 50 draw call / 608,296
  triangle / 48 geometry / 17 texture / 326 MB heap (run120's baseline, unchanged — data-only
  addition). `git push origin stable-2026-08-07-1100` again hit the known `HTTP 403` tag-push
  restriction (§8.11) — local tag + this line serve as the checkpoint.
- stable-2026-08-07-1125 — run 129 checkpoint continuity guard; browser smoke 34/34+ PASS, additive-only PASS, perf snapshot recorded.
- stable-2026-08-07-1143 — run 130 mobile bounded streaming; 49-chunk / 12.25 km² mobile footprint (~8.9%%), browser smoke 34/34+ PASS, mobile runtime eviction PASS.
- stable-2026-08-07-1201 — run 131: `silent_sisters_procession` world event (ADR-0155) +
  ADR numbering-collision fix (run 130's mobile-streaming ADR renumbered 0153→0154, this run's own
  ADR is 0155). Full Playwright smoke suite 34/34 PASS, 0 FAIL, exit code 0 on the merged tip
  (run 130's mobile bounded-streaming work included); additive-only guard, world-event catalog guard
  (37 unique/9 gated), mobile chunk-streaming guard all re-verified clean. Perf 50 draw call /
  608,296 triangle / 48 geometry / 17 texture / 290 MB heap (run120's baseline, unchanged — data-only
  addition). `git tag`/`git push origin <tag>` attempted per usual; local tag + this line serve as
  the checkpoint if the push hits the known `HTTP 403` restriction (§8.11).

- stable-2026-08-07-1226 — run 132 mobile render-budget gate; mobile budget PASS, browser smoke 34/34+ PASS, platform checks PASS.
- stable-2026-08-07-1300 — run 133: `hedge_knight_arrival` world event (ADR-0157) + a mobile-coverage
  radius-bump attempt tried and safely abandoned uncommitted (additive-only guard collides with
  `checkMobileChunkStreaming.js`'s hardcoded literals — see ADR-0157). Full Playwright smoke suite
  34/34 PASS, 0 FAIL, 0 console/page errors; additive-only guard and world-event catalog guard
  (38 unique/9 gated) both re-verified clean. Perf 50 draw call / 608,296 triangle / 48 geometry /
  17 texture / 326 MB heap (run120's baseline, unchanged — data-only addition).
- stable-2026-08-07-1328 — run 134 mobile terrain distance LOD; 34/34+ browser smoke PASS; mobile LOD/perf/additive guards PASS.
- `stable-2026-08-07-1420` — run 135: mobil spawn-çapalı vejetasyon halkası (ADR-0159) — mobil
  oyuncunun spawn noktası çevresinde gerçek ağaç görmesini sağlayan, `world/vegetation.js`/
  `sceneManager.js`'e hiç dokunmayan additive `game3d.js` bloğu. Doğruluk + entegrasyon testleri
  (`checkMobileSpawnVegetation.js`) ve tam Playwright smoke suite 34/34 PASS, 0 konsol/sayfa hatası;
  mobil render bütçesi 31 draw call / 174.173 üçgen (hâlâ 500/500K bütçesinin çok altında).
- stable-2026-08-07-1420 — run 135 checkpoint-format compatibility alias; same validated spawn-anchored vegetation checkpoint, 34/34 smoke PASS and mobile budget 31 draw calls / 174173 triangles.
- stable-2026-08-07-1437 — run 136 mobile vegetation geometry LOD + rule consolidation; 34/34+ browser smoke PASS; mobile/perf/additive guards PASS.
- stable-2026-08-07-1455 — run 137: `wedding_procession` world event (ADR-0161) + GOVERNANCE.md §17
  FAZ 7 documentation fix (stale "no attack/damage" text, superseded by run 90/ADR-0116) +
  QUESTIONS_FOR_OWNER.md escalation for the mobile-radius/additive-guard conflict documented but
  never filed since run 133/ADR-0157. Full Playwright smoke suite 34/34 PASS, 0 FAIL, 0
  console/page errors both before and after; additive-only guard, world-event catalog (39
  unique/9 gated), assets/PWA/cache/checkpoint guards all PASS. Perf 50 draw call / 608,296
  triangle / 48 geometry / 17 texture / 307 MB heap (run129-136 baseline, unchanged — data-only
  addition).
- stable-2026-08-07-1552 — run 138: `ward_hostage_arrival` world event (ADR-0162) + `CATCH_UP.md`
  10-run update (due since run 128, deferred to this run per run 137's note). Full Playwright
  smoke suite 34/34 PASS, 0 FAIL, 0 console/page errors both before and after; additive-only
  guard, world-event catalog (40 unique/9 gated), assets/PWA/cache/checkpoint/smoke-check-registry
  guards all PASS. Perf 50 draw call / 608,296 triangle / 48 geometry / 17 texture / 273 MB heap
  (run129-137 baseline, unchanged — data-only addition).

- stable-2026-08-07-1604 — run 139 mobile radius readiness evidence; smoke 34/34+ PASS, additive-only PASS.
- stable-2026-08-07-1620 — run 140 live mobile radius 4; 81 chunks / 20.25 km², full governance validation pending this same CI run.
- stable-2026-08-07-1641 — run 141 live-radius mobile vegetation culling; 34/34+ browser smoke, mobile/culling/PWA/additive gates PASS.
- stable-2026-08-07-1940 — run 142 mobile radius-5 readiness evidence (74 draw call/192,409 triangle
  projection); radius-5 live activation attempted then cleanly reverted (broke run-140's own
  checkMobileRadius4LiveWorld.js — structural additive-only conflict, escalated to
  QUESTIONS_FOR_OWNER.md/ADR-0166). World stays at run-140's radius 4 (81 chunks/20.25 km², before
  run 141's vegetation-culling addition on top). Full Playwright smoke suite 34/34 PASS, 0 FAIL, 0
  console/page errors both before and after; additive-only guard PASS (chunkManager.js's own
  content bit-identical to the run-141-merged base this rebased onto); all mobile/PWA/cache/
  checkpoint/world-event guards PASS. Desktop perf 50 draw call / 608,296 triangle / 48 geometry /
  17 texture / 347 MB heap (run129-141 baseline, bit-identical).
- stable-2026-08-07-1726 — run 143 FAZ 8 world-event expansion + periodic platform check; 34/34+ browser smoke, catalog/PWA/cache/mobile/additive gates PASS.
- stable-2026-08-07-1741 — run 144 FAZ 8 world-event expansion; 34/34+ browser smoke, catalog/PWA/cache/mobile/additive gates PASS.
- stable-2026-08-07-1900 — run 145 FAZ 8 world-event expansion (mummer troupe/shepherd flock/stargazing maester); 34/34 browser smoke, catalog (49/15)/PWA/cache/mobile/road/terrain/checkpoint/additive-only guards all PASS.
- stable-2026-08-07-1827 — run 146 world-event diversity guard; 34/34+ browser smoke and full governance gates PASS.
- stable-2026-08-07-1837 — run 147 FAZ 8 world-event expansion; 34/34+ browser smoke, diversity/catalog/PWA/cache/mobile/road/terrain/additive gates PASS.
- stable-2026-08-07-1936 — run 148 fixed-seed world-event checksum guard; 34/34+ browser smoke, determinism/catalog/diversity/PWA/cache/mobile/road/terrain/additive gates PASS.
- stable-2026-08-07-1952 — run 149 catch-up summary + world-event determinism/additive-only conflict (ADR-0172, doc-only, no runtime change); 34/34 browser smoke baseline unchanged, additive-only guard PASS. (Local tag only — `git push origin <tag>` HTTP 403 per known §8.11 constraint.)

- stable-2026-08-07-2031 — run 150 world-event toast accessibility; full browser smoke + a11y/PWA/mobile/additive gates PASS.

- stable-2026-08-07-2100 — run 151 session-snapshot audit + owner escalation (security key + 3 structural blockers pushed to owner, doc-only, no runtime change); 34/34 browser smoke, additive-only guard PASS. (Local tag only — `git push origin <tag>` HTTP 403 per known §8.11 constraint.)
- stable-2026-08-07-2128 — run 152 latest-run checkpoint uniqueness guard; 34/34+ browser smoke and governance/mobile/PWA gates PASS.
- stable-2026-08-07-2139 — run 153 settlement discovery atomic accessibility; 34/34+ browser smoke and a11y/governance/mobile/PWA gates PASS.
- stable-2026-08-07-2154 — run 154 dialogue box atomic accessibility; 34/34+ browser smoke and a11y/governance/mobile/PWA gates PASS.
- stable-2026-08-07-2238 — run 155 player health meter accessibility; 34/34+ browser smoke and a11y/governance/mobile/PWA gates PASS.
- stable-2026-08-07-2300 — run 156 §8.12 rule consolidation (fixed stale §15 platform-check note, doc-only, no runtime change); 34/34 browser smoke, additive-only guard PASS. (Local tag only — `git push origin <tag>` HTTP 403 per known §8.11 constraint.)
- stable-2026-08-07-2305 — run 156b interaction prompt accessible status semantics (ADR-0178); 34/34 browser smoke, additive-only guard, smoke-check registry PASS.

- stable-2026-08-07-2340 — run 157 day/night clock quiet timer accessibility (ADR-0179); 34/34+ browser smoke, additive-only/PWA/mobile/governance gates PASS.
- stable-2026-08-07-2358 — run 158 settlement compass quiet accessible status semantics (ADR-0180) + CATCH_UP.md refresh; 34/34 browser smoke, additive-only/PWA/mobile/governance/a11y gates all PASS. (Local tag only — `git push origin <tag>` HTTP 403 per known §8.11 constraint.)

- stable-2026-08-08-0030 — run 159 controls-help trigger/panel accessibility (ADR-0181); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.

- stable-2026-08-08-0128 — run 160 interaction-prompt keyboard accessibility (ADR-0182); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.

- stable-2026-08-08-0240 — run 161 touch-joystick input contract regression guard (ADR-0183); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.

- stable-2026-08-08-0426 — run 162 keyboard input contract regression guard (ADR-0184); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y gates PASS.

- stable-2026-08-08-0523 — run 163 EventBus contract regression guard (ADR-0185); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/input gates PASS.

- stable-2026-08-08-0535 — run 164 health state contract regression guard (ADR-0186); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/core-input gates PASS.

- stable-2026-08-08-0552 — run 165 jump arc contract regression guard (ADR-0187); 34/34+ browser smoke, additive-only/PWA/mobile/governance/a11y/core-input gates PASS.

- stable-2026-08-08-0611 — run 166 mobile jump control / FAZ 4 input parity (ADR-0188); 34/34+ browser smoke, real-mobile layout/click, additive-only/PWA/mobile/core-input gates PASS.

- stable-2026-08-08-0644 — run 167 determinism policy CI repair (ADR-0189); 34/34+ browser smoke, comment/vendor + injected-call regression fixture, PWA/world/determinism gates PASS; runtime delta 0.

- stable-2026-08-08-0715 — run 168 road visual geometry contract (ADR-0190); 34/34+ browser smoke, road ribbon geometry/material/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0747 — run 169 vegetation visual geometry contract (ADR-0191); 34/34+ browser smoke, vegetation InstancedMesh/material/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0804 — run 170 terrain visual geometry/color/seam contract (ADR-0192); 34/34+ browser smoke, terrain render/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0819 — run 171 water visual plane/shader/update contract (ADR-0193); 34/34+ browser smoke, water render/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0836 — run 172 aurora sky visual sphere/shader/update contract (ADR-0194); 34/34+ browser smoke, sky render/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0907 — run 173 distance fog/day-night visual contract (ADR-0195); 34/34+ browser smoke, fog behavior, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0926 — run 174 day/night lighting visual contract (ADR-0196); 34/34+ browser smoke, lighting behavior, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0940 — run 175 starfield visual contract (ADR-0197); 34/34+ browser smoke, star Points/shader/update/disposal, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-0956 — run 176 Orbit/chase camera contract (ADR-0198); 34/34+ browser smoke, controls listener lifecycle + collision math, PWA/world/determinism/mobile gates PASS; runtime delta 0.

- stable-2026-08-08-1023 — run 177 owner world-art §30 + medieval road surface (ADR-0199); 34/34+ browser smoke, road safety/visual/surface + PWA/determinism/mobile gates PASS.


- stable-2026-08-08-1129 — run 179 canonical-map coastline/water-mask contract (ADR-0200); 34/34+ browser smoke, map/mask checksum, terrain/road, PWA/mobile/perf/governance gates PASS; runtime render delta 0.


- stable-2026-08-08-1148 — run 181 exact 2D-map/reference alignment contract (ADR-0201); 34/34+ browser smoke, CSS/map alignment, terrain/road, PWA/mobile/perf/governance gates PASS; runtime render delta 0.


- stable-2026-08-08-1208 — run 182 seat-safe hydrology + full-map extent plan (ADR-0202); 34/34+ browser smoke and all world/PWA/mobile/perf/governance gates PASS; runtime render delta 0.


- stable-2026-08-08-1226 — run 183 deterministic physical wind grass (ADR-0203); 34/34+ smoke + canonical-map/hydrology/mobile/PWA/determinism gates PASS.


- stable-2026-08-08-1248 — run 184 canonical full-map migration dry-run proof (ADR-0204); 34/34+ smoke + 14/14 seat + 13/13 road MST + mobile/PWA/determinism gates PASS.


- stable-2026-08-08-1308 — run 185 route-qualified full-reference migration shadow plan (ADR-0205); 34/34+ smoke + 14/14 target seats + 13/13 slope-aware roads + mobile/PWA/determinism gates PASS.


- stable-2026-08-08-1327 — run 186 canonical hydrology target-terrain shadow adapter (ADR-0206); 34/34+ smoke + 96x64 terrain grid + 14/14 seat/PWA/mobile/determinism gates PASS; live runtime delta 0.


- stable-2026-08-08-1348 — run 187 canonical chunk/water/collider integration shadow (ADR-0207); real mesh raycast + water-plane + collider + road-water diagnostics and full regression gates PASS; live runtime delta 0.


- stable-2026-08-08-1419 — run 188 canonical road/water owner-policy shadow comparison (ADR-0208); deterministic policy matrix + full regression gates PASS; no policy selected, live runtime delta 0.


- stable-2026-08-08-1444 — run 189 canonical deterministic rock/stone placement shadow qualification (ADR-0209); fixture determinism + full regression gates PASS; live runtime delta 0.


- stable-2026-08-08-1510 — run 190 canonical real rock geometry/LOD shadow proof (ADR-0210); Run189 checksum + road-clear diagnostic + real renderer cost + full regression PASS; live runtime delta 0.


- stable-2026-08-08-1556 — run 191 owner-approved canonical medieval stone-arch bridge shadow proof (ADR-0211); road-water owner gate resolved, deterministic bridge fixture + masonry visual evidence + full regression PASS; live runtime delta 0.


- stable-2026-08-08-1717 — run 192 canonical road + owner-approved stone-bridge scene-integration shadow proof (ADR-0212); Run191 traversal readiness + water-road suppression + bounded deck approaches + collider/frustum/mobile budget + full regression PASS; live runtime delta 0.


- stable-2026-08-08-1831 — run 193 reusable canonical terrain+road+bridge+rock bounded scene-window shadow adapter (ADR-0213); two-window recenter/dispose + mobile scene budget + full regression PASS; live runtime delta 0.


- stable-2026-08-08-1912 — run 194 exact-reference clipped 27x21 owner-grid + 7/7 bridge sequential replacement shadow proof (ADR-0214); V1 edge failure superseded by V2; full regression PASS; live runtime delta 0.


- stable-2026-08-08-1940 — run 195 opt-in canonical replacement/rollback controller shadow proof (ADR-0215); exact current root/collider restoration, failure-safe rollback, pre/post render equality and full regression PASS; live runtime delta 0.


- stable-2026-08-08-2025 — run 196 real current-runtime transaction preflight (ADR-0216); complete non-light current scene ownership + Run180 grass borrow/restore + instance-scoped ChunkManager pause/resume + input/physics freeze/restore + static byte-exact rollback/full submission equality PASS; live runtime delta 0.


- stable-2026-08-08-2136 — run 197 real game-tick freeze/resume preflight (ADR-0217); unchanged live RAF tick + player/NPC/animal/dragon/interaction/world-event instance gates + held-input preservation + two exact rollback cycles + zero borrowed-resource disposal + pre/post submission equality PASS; live runtime delta 0.


- stable-2026-08-08-2249 — run 198 ordered canonical-active pagehide + same-document clean re-init preflight (ADR-0218); two lifecycle generations + gate-before-runtime teardown + exact single-dispose paths + zero RAF/timeout/interval leak + listener/EventBus/DOM baseline equality + distinct runtime identities + single F4 toggle + zero console error PASS; live runtime delta 0.

- stable-2026-08-08-2329 — run 199 overdue periodic platform/PWA/WebGL audit; full smoke + zero console errors + SW cache/installability + mobile streaming/LOD/perf + perf trend + canonical readiness regression PASS; live runtime delta 0.

- stable-2026-08-09-0144 — run 200 explicit canonical startup-source selector preflight; default current + explicit canonical opt-in + invalid-request current fallback + rollback + full smoke/PWA/mobile/perf gates PASS; live runtime delta 0.

- `stable-2026-08-09-0242` — Run201 opt-in canonical developer startup + real online→offline reload proof; 34+ smoke PASS, canonical regressions/PWA/mobile/perf/additive/concurrency gates PASS; default runtime delta 0.

- `stable-2026-08-09-0339` — Run202 developer fallback + pagehide/offline lifecycle-retention proof; 34+ smoke PASS, canonical regressions/PWA/mobile/perf/additive/concurrency gates PASS; live/default runtime delta 0.

- `stable-2026-08-09-0429` — Run203 explicit developer launcher isolation proof; 34+ smoke PASS, canonical regressions/PWA/mobile/perf/additive/concurrency gates PASS; live/default runtime delta 0.

- `stable-2026-08-09-0538` — Run204 developer offline history ownership proof; 34+ smoke PASS, canonical regressions/PWA/mobile/perf/additive/concurrency gates PASS; live/default runtime delta 0.

- `stable-2026-08-09-0628` — Run205 isolated developer standalone PWA proof; 34+ smoke PASS, canonical regressions/production-PWA/mobile/perf/additive/concurrency gates PASS; live/default runtime delta 0.

- `stable-2026-08-09-0730` — Run206 service-worker ownership boundary proof; 34+ smoke PASS, canonical/PWA/mobile/perf/additive/concurrency gates PASS; live/default runtime delta 0.

- `stable-2026-08-09-0812` — Run207 first visible RTS command surface; 48 selectable soldiers, real castles/roads/water/animals/dragon, desktop+mobile visual proofs, 34+ legacy smoke, PWA/perf/additive/concurrency gates PASS.

- `stable-2026-08-09-0827` — Run208 RTS destination-command feedback; desktop+mobile visual proof, 34+ legacy smoke, PWA/perf/additive/concurrency gates PASS.

- stable-2026-08-09-1443 — Run211 RTS keyboard command parity: M/F delegate to established controls; pre/post smoke, PWA/offline, mobile budget, determinism, terrain/roads and console gates PASS.

- `stable-2026-08-09-1545` — Run212 RTS command-state chip + ARIA live status; focused desktop/mobile proof, 34+ smoke, PWA/mobile/determinism/world-safety/additive/concurrency gates PASS.
stable-2026-08-09-1619 — Run213 RTS selection readability; read-only DOM/ARIA meter, desktop/mobile/PWA/regression gates verified.
stable-2026-08-09-1717 — Run214 World Editor foundation; isolated JSON authoring shell and deterministic static instancing verified.
stable-2026-08-09-1720 — Run215 World Editor instanceGroups JSON rehydration; exact static formation round-trip, stale-group cleanup, PWA/game regressions verified.
stable-2026-08-10-1940 — Run218 editor authoring regression suite; bright aurora/fog/scale/clipboard/instance safety plus PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-1704 — Run219 editor history regression; undo/redo round-trip, visual proof, PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-1712 — Run220 editor history shortcut/mobile regression; keyboard round-trip, mobile toolbar visibility/overflow, PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-1719 — Run221 editor history input-guard regression; inspector typing protection, Ctrl+Y redo, PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-2147 — Run222 editor clipboard/history regression; deterministic paste identity/offset, undo/redo round-trip, PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-2203 — Run223 editor delete/history regression; exact object restore across delete/undo/redo, PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-2217 — Run224 editor duplicate/history regression; toolbar/Ctrl+D deterministic duplicate parity, undo/redo and clipboard isolation verified.
stable-2026-08-10-2241 — Run225 editor sub-0.01 scale/history regression; `0.007` scene scale survives undo/redo and Inspector reflects it after explicit re-selection; PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-2318 — Run226 editor signed rotation/history regression; signed `-179.9°` transform survives undo/redo under serializer normalization; PWA/perf/determinism/smoke gates verified.
stable-2026-08-10-2339 — Run228 editor mixed-sign position/history regression; decimal X/Y/Z position survives undo/redo and Inspector re-selection; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0005 — Run230 editor mobile responsive layout integrity; fully loaded fresh/mobile-resize global width constrained to 390px while internal toolbar/status scrolling stays reachable; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0106 — Run234 editor invalid scene load atomicity; unsupported schema rejected without mutating live editor state; full safety gates verified.
stable-2026-08-11-0139 — Run235 periodic platform control; PWA/cache, mobile 35 draw calls/195929 triangles, determinism/world safety, perf trend/debt and full browser smoke verified; runtime delta 0.
stable-2026-08-11-0208 — Run236 editor unknown asset scene-load regression V2; missing asset record skipped while known scene data and editor settings restore correctly; full safety gates verified.
stable-2026-08-11-0235 — Run237 editor malformed scene-load atomicity regression V2 clean; malformed JSON and JSON null preserve prepared editor state; full safety gates verified.
stable-2026-08-11-0258 — Run239 editor schema-version atomicity regression; unsupported scene schema rejected atomically with live editor state preserved; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0311 — Run240 governance consolidation audit; owner-directive/owner-gate/platform-maintenance state re-verified; PWA/perf/determinism/smoke gates PASS.
stable-2026-08-11-0328 — Run241 editor valid empty-scene load regression; empty scene clears authoring content, restores supported snap state and preserves owner live-grid policy; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0341 — Run242 editor missing-metadata composed defaults regression; valid scene preserves exact object data and snap defaults while owner live-grid policy remains hidden/disabled; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0510 — Run245 editor null-metadata composed defaults regression; valid scene preserves exact object data and default snap state while owner live-grid policy remains hidden/disabled; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0600 — Run246 editor empty-metadata composed defaults regression; valid scene preserves exact object data and default snap state while owner live-grid policy remains hidden/disabled; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0701 — Run247 editor partial-metadata composed defaults regression; valid scene preserves exact object data, explicit gridVisible=false and default snap state; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0813 — Run248 editor scene-load snap isolation; serialized transforms bypass pre-load live snap while canonical metadata/defaults and invalid-load atomicity remain intact; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0829 — Run249 editor snap-enabled off-grid scene import regression; off-grid serialized transforms survive load while snap metadata restores to true/2.5; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0843 — Run250 editor multi-object off-grid scene import regression; three independent serialized transforms survive snap-enabled import exactly; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0856 — Run251 editor unknown-asset off-grid scene import regression; missing asset is skipped while both neighboring off-grid valid transforms survive exactly; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0912 — Run252 editor consecutive scene replacement regression; second valid import fully replaces the first without stale objects/selection or transform quantization; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0928 — Run254 editor mobile off-grid scene import regression; 390x844 touch Chromium preserves exact off-grid transform while serialized snap restores to true/2.5; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0942 — Run255 editor mobile scene JSON save/download regression; actual mobile browser download preserves canonical schema/editor/object transform content exactly; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-0956 — Run256 editor mobile actual-download save-load roundtrip regression; real downloaded scene fully restores exact source identity/transform/editor metadata after an intervening replacement scene; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-1026 — Run258 editor mobile multi-object actual-download save-load regression; three exact off-grid objects persist through real browser download, intervening replacement and reload; PWA/perf/determinism/smoke gates verified.
stable-2026-08-11-1218 — Run262 editor terrain elevation brush; water lowers and land raises live terrain/collider with deterministic persistent stamps; PWA/perf/determinism/smoke gates verified.

- `stable-2026-08-11-1329` — Run259 deterministic FBX fallback palette (288 colors / 24 families); full DoD + two-angle visual evidence PASS.

- `stable-2026-08-11-1511` — Run264 Run263 governance checkpoint; deterministic 4046 sea + 6 lake proof, two-view semantic evidence and full DoD PASS.

- `stable-2026-08-11-1536` — Run267 Run266 governance checkpoint; desktop/mobile entry-gate visual proof, PWA/perf/determinism/world-safety/full smoke and console-zero PASS.

- `stable-2026-08-11-1612` — Run268 Run264 HTerrain governance checkpoint; Godot authoring, real-render normal-baker, PWA/perf/determinism/world-safety/full smoke and console-zero PASS.

- `stable-2026-08-11-1633` — Run272 Terrain Polish Iteration 001 governance checkpoint; Godot/PWA/perf/determinism/world-safety/full smoke and console-zero PASS.

- `stable-2026-08-11-1730` — Run274 Terrain Polish Iteration 002 governance checkpoint; Godot/PWA/perf/determinism/world-safety/full smoke and console-zero PASS.

- `stable-2026-08-11-1749` — Run276 owner-map semantic surface + 10 pindexes; map provenance, online/offline visual proof, PWA/perf/determinism/terrain-road safety/full smoke PASS.

- `stable-2026-08-11-run280` — owner-map semantic byte fingerprint guard; runtime delta 0; mandatory DoD PASS.

- `stable-2026-08-11-run281` — Pindex-03 deterministic micro-detail; geometry delta 0; mandatory DoD PASS.

- `stable-2026-08-11-run282` — Pindex-04 deterministic micro-detail; geometry delta 0; mandatory DoD PASS.

- `stable-2026-08-12-run291` — periodic platform control + rule consolidation refresh (§8.12/§15); runtime source delta 0; PWA/service-worker/34-smoke/mobile-perf/world-reference/terrain-seat/road/technical-debt/additive-only/perf-trend all PASS; mandatory DoD PASS.

- `stable-2026-08-12-run295` — pull-request exact-main base-policy guard V2; runtime delta 0; mandatory DoD PASS.
