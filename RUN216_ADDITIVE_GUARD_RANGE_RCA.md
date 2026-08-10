# Run216 Additive Guard Range RCA

**Date:** 2026-08-10
**Scope:** PR #103 governance CI only; no runtime/gameplay behavior changed.

## Root Cause
Several Run216 workflows invoke `scripts/checkAdditiveOnlyDiff.js` with a single already-composed range such as `origin/main...HEAD`. The guard historically interprets argv[2] as a base ref and independently appends `...HEAD`, so the effective rev expression becomes invalid (`origin/main...HEAD...HEAD` / an equivalent unresolved ref). Separately, some shallow-checkout workflows call `git diff --check origin/main...HEAD` before the remote base ref exists. In both cases the functional Node contract tests can pass while the governance wrapper fails before completing its diff hygiene gate.

## Prevention
Keep the canonical guard backwards-compatible with both documented two-ref invocation (`baseRef`, `headRef`) and legacy single-range invocation (`baseRef...headRef`). A single-range argument is normalized into its base/head components before the existing validation/diff logic runs. This avoids editing many otherwise-valid workflows and preserves the strict additive-only semantics.

## Regression Test / Verification
After the compatibility addition, rerun PR #103 workflows and require the instance-editing foundation guard plus the existing normal invocation paths to PASS. Functional tests remain independently required. Shallow-checkout workflows that directly invoke raw `git diff --check` may still need an additive fetch-base step; this RCA does not treat those as fixed until their own reruns pass.

## Risk
LOW. Parsing compatibility is limited to the case where argv[2] contains exactly one `...` range and argv[3] is absent. Existing normal invocations remain unchanged. No source deletions or replacements are permitted.
