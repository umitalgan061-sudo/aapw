# RCA — Run 375 (2026-09-10): confirmed root cause for the 371l/373 player-combat timeout family — this environment's headless Chromium renders at ~0.2-0.3 FPS, not a gameplay bug

## Summary

Run 371l flagged four `checkPlayer*Runtime.mjs` checks (`checkPlayerGuardImpactExhaustionRuntime.mjs`,
`checkPlayerMeleeComboRuntime.mjs`, `checkPlayerStaminaDodgeRuntime.mjs`,
`checkPlayerDodgeIFrameRuntime.mjs`) intermittently timing out on short in-game state transitions
while producing plausible telemetry. Run 373 traced the mechanism by code-reading alone (not proven
at runtime) to `player.js`'s `MAX_FRAME_DELTA_SECONDS` clamp (0.1s, `player.js:66`) having no
catch-up/reconciliation step, and proposed a concrete next step: capture real per-frame `rawDelta`
values from `game3d.js`'s `tick()` to confirm or refute the clamp-vs-real-frame-time correlation with
real numbers before touching either the clamp or any check's timeout budget.

This run did exactly that. **Confirmed, with real numbers, and the magnitude is far worse than Run
373's own numeric example assumed.**

## Method

Added a temporary, opt-in diagnostic to `game3d.js`'s `tick()` (one line: push `rawDelta` into
`window.__frameDeltaDiag` if that array exists, capped at 400 entries — no behavior change when the
array is absent, i.e. in every normal path including every existing check). Ran a standalone
Playwright script against this session's own headless Chromium: loaded `game3d.html`, waited for the
loading screen to hide, reset the diagnostic array, held `KeyW` (walk) for a real 4000ms wall-clock
window, then read the captured deltas back out. **The diagnostic line was reverted immediately after
capturing the data below — nothing was committed with it in place** (`GOVERNANCE.md` §8.8, Geçici
Çözüm Yok: this was a one-off instrument for this run's own measurement, not shipped code, so there is
nothing to leave a TEMP/HACK marker or removal-condition ADR for).

## Findings

- **Loading itself took 90.4 real seconds** (`game3d-loading` didn't hide until 90420ms after
  `page.goto`) — within a hair of the 90000ms budget every one of these checks' own
  `page.waitForFunction(..., { timeout: 90000 })` call already uses (see e.g.
  `checkPlayerStaminaDodgeRuntime.mjs:122`), meaning loading alone is already at real risk of timing
  those checks out before any combat assertion runs, independent of the clamp issue below.
- Over the subsequent 4000ms wall-clock window (player actively walking), only **4** real
  `requestAnimationFrame` ticks occurred. Their real elapsed-time (`rawDelta`) values: min ≈3.5s,
  p50 ≈3.5s, p95/max ≈8.6s, mean ≈4.7s. **All 4 of 4 frames exceeded the 0.1s clamp threshold** —
  not an occasional spike, every single frame.
- That works out to an effective simulated/real time ratio of roughly **1:35 to 1:85** (0.1s
  simulated per 3.5-8.6s real) in this environment for this scene, once terrain/water/vegetation/
  NPCs/animals/day-night/weather are all live and being rendered — dramatically past the "6+ real
  frames, plausibly a few real seconds" estimate Run 373 derived from a *hypothesized* frame cost;
  the real cost is roughly 35-85x worse per frame than that estimate assumed, meaning the same 0.6
  simulated-second dodge→sprint transition Run 373 analyzed can require **14-34 real seconds**, not
  "a few," before the clamped simulation even reaches it — comfortably explaining timeouts on budgets
  in the 3000-7000ms range and putting some of the check family's own already-generous 12000-25000ms
  budgets at real risk too.

## Root cause

This session's headless Chromium instance has no GPU acceleration available (consistent with
`RCA_RUN370`/`RCA_RUN344`'s unrelated proxy-auth finding: an infrastructure/environment
characteristic, not a code defect) and falls back to software rendering for this scene's real
geometry/lighting/shadow load. Confirmed net effect: real frame times of several seconds each,
i.e. sustained ~0.2-0.3 FPS, not the 30-60 FPS this game's own perf budgets
(`GOVERNANCE.md` §4) target and that the check family's timeout budgets implicitly assume. Run 373's
mechanism (the clamp has no catch-up accumulator, so simulated time falls permanently behind wall
time on slow frames) was correct; this run adds the missing real-world magnitude.

## Why this is not being fixed as gameplay code this run

- **The clamp itself should not change.** `MAX_FRAME_DELTA_SECONDS` exists to stop a single slow
  frame from teleporting/tunnelling the player through geometry — appropriate and necessary for real
  play at real (30-60 FPS) frame rates. Nothing in this data suggests real end-user hardware sees
  frame times anywhere near these — this is specific to this constrained session's absent GPU.
- **Bumping the four checks' timeout budgets is not a safe narrow fix either.** At the measured
  ~1:35-1:85 ratio, reliably clearing even the check family's *existing* larger waits (12000-25000ms)
  would need budgets in the many-minutes range per check — consistent with Run 371m's independently
  observed 8.4-minute real-time gamepad check. Multiplied across the whole player-combat check
  family, a full run would take on the order of an hour or more of wall time per check-suite pass,
  which is its own real cost/practicality trade-off (`GOVERNANCE.md`'s Çalışma Süresi Sınırları exists
  for exactly this kind of runaway-duration concern) — an owner call about acceptable check-suite
  duration in this specific environment, not a call any single run should make unilaterally by
  quietly 10x-ing timeout constants.
- No source file remains changed by this run (diagnostic reverted, confirmed via `git status` and
  `grep` for the diagnostic symbol returning nothing).

## Suggested paths forward (owner decision, not guessed)

1. Accept the four checks' timeouts as environment-limited in this specific session type and either
   (a) raise their budgets to real-measured-safe values (likely several minutes each) and accept the
   wall-clock cost when this check family runs here, or (b) soft-skip/mark-inconclusive this specific
   check family when running in a session confirmed to lack GPU acceleration (a new, narrow
   environment probe — e.g. a one-time headless frame-rate sample at suite start — deciding whether to
   run them at all), mirroring the existing LFS-asset-gap soft-filter precedent
   (`checkPlayerStaminaDodgeRuntime.mjs`'s own `KNOWN_ASSET_GAP_PATTERN` handling).
2. If a GPU-accelerated variant of this session type is available, prefer running this specific check
   family there instead of headless-software-rendering sessions.
3. Independent of (1)/(2): the 90s loading-screen budget already shared by all these checks is worth
   revisiting on its own — 90.4s observed against a 90000ms ceiling is not comfortable margin even
   before any combat assertion begins.

None of these were applied this run — each changes shared test infrastructure and/or accepts a large
wall-clock cost trade-off, both outside a single run's safe blast radius per `GOVERNANCE.md`'s
Değişiklik Etki Analizi. This closes out Run 373's own "next safe step" with real, confirmed numbers;
the four checks (`GuardImpactExhaustion`/`MeleeCombo`/`StaminaDodge`/`DodgeIFrame`) remain unfixed,
now with a settled (not hypothesized) root cause.

## Risk

LOW / documentation-only. One line was added to `game3d.js` for measurement and reverted before this
commit (`git status` clean, verified). No gameplay, terrain, or test-infrastructure file is changed by
this run.
