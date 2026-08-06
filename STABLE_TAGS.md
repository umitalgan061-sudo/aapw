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
