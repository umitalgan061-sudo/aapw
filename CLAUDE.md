# Claude Code — Westeros Repository Instructions

Before starting or publishing any work in this repository, read and obey:

1. `GOVERNANCE.md`
2. `GOVERNANCE_CONTINUATION_OVERRIDE.md`
3. `GOVERNANCE_CONTINUOUS_OWNER_DIRECTIVE.md`
4. the latest `3D_GAME_PROGRESS.md`, recent commits/ADRs, and `QUESTIONS_FOR_OWNER.md`

The two continuation/owner-directive files are active owner decisions. Where they conflict with old duration/run-stop clauses in `GOVERNANCE.md` §8.7 or §19, the newer owner directive wins.

There is no arbitrary per-file, per-run, 6–8 hour, task-count, or total-work-duration ceiling. Keep changes small, atomic, reviewable and fully validated, but do not stop merely because a historical time/task budget has been reached.

When an atomic subtask completes, is safely rolled back, or is blocked, do not wait for the owner to type `Devam et`. Recheck remote `main` and concurrency state immediately, reread the current progress/owner gates, choose the next safe meaningful subtask, and continue automatically.

A blocked subtask does not stop the whole project when another safe owner-independent task exists. Only real owner decisions, safety/data-loss risk, unresolved DoD/concurrency gates, unresolved repeated-error RCA, technical termination of the execution environment, or genuinely having no safe meaningful work left may stop the current chain.

All other governance remains unchanged: preserve the existing 2D/3D/RTS architecture, desktop/mobile/PWA behavior and determinism; never guess owner-gated decisions; never claim DONE before the full Definition of Done passes; and recheck remote `main` immediately before every publication because another autonomous session may be working concurrently.
