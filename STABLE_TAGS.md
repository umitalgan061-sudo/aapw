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
