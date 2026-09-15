# Autonomous Turn Completion Rule

**Effective:** 2026-09-15
**Authority:** Project-owner directive. This rule supersedes any older run-level diff quota, minimum/maximum changed-line target, or "stop when the line target is reached" instruction for autonomous AAPW development turns.

## Turn completion

Normal koşullarda bir otonom geliştirme turu **4000 anlamlı değişiklik satırına ulaşmadan kapatılamaz**.

The turn's change count is measured from the run-start base commit/branch to the latest head reached during the same continuous work chain, using meaningful Git diff additions + deletions. The target is **more than 4000 meaningful changed lines** when the repository contains sufficient real work in the agent's ownership area.

### What counts as meaningful

A change is meaningful when it implements, fixes, integrates, validates, or materially improves real repository behavior, quality, performance, determinism, visual fidelity, UX, tooling, or architecture within the agent's authorized scope.

The following are explicitly **not** acceptable for inflating the count:

- boilerplate or placeholder code with no substantive behavior;
- copy-pasted/repeated code or duplicated modules that add no real capability;
- artificial refactors whose sole purpose is to increase the diff;
- repeated or redundant tests/comments/fixtures that do not add coverage or correctness;
- formatting-only churn or other behaviorless line inflation.

## Reaching 4000 does not end the turn

**4000 is not a stop condition.** Reaching 4000 meaningful changed lines must never trigger automatic termination when real high-priority work remains in the agent's ownership area.

After reaching 4000, the agent must continue the same work package when safe and useful: re-read the live repository state, verify concurrency/freshness, and select the next highest-priority substantive task. Continue until the work package is actually complete.

## When a turn may end

A turn may close before the 4000-line target only when at least one of the following is true and the reason is reported:

1. the ownership area's current work package is genuinely complete;
2. a real safety, data-loss, owner-approval, concurrency, or Definition-of-Done gate cannot be resolved safely;
3. the execution environment technically ends or prevents further work;
4. no safe and meaningful high-priority work remains in scope.

A transient CI wait, a routine research/summary pass, or simply reaching an arbitrary diff quota is **not** sufficient reason to close a turn when another safe substantive action exists.

## Interaction with older rules

Any repository document or automation prompt containing an older per-turn rule such as `<=1000`, `<=3000`, `2850–3000`, `minimumAddedLines`, `maximumAddedLines`, or an instruction to stop automatically at a changed-line threshold is superseded by this rule for normal autonomous development turns.

Other safety, quality, architecture, ownership, concurrency, determinism, performance, visual acceptance, testing, and Definition-of-Done requirements remain in force. A diff-size target never overrides those requirements.

## Reporting requirement

At the end of each autonomous turn, report:

- run-start base and final head;
- meaningful additions + deletions for the continuous chain;
- substantive work completed;
- tests/CI/visual/performance evidence actually obtained;
- any blocker that prevented reaching or exceeding 4000;
- the next highest-priority in-scope task when the work package is not yet complete.

Do not claim `PASS`, `DONE`, or "work package complete" without evidence.
