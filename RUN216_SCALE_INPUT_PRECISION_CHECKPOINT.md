# Run216 Scale Input Precision Checkpoint

This stacked branch preserves the owner-visible large-object scaling fix without modifying the concurrently active Run216 branch.

- Runtime: Inspector X/Y/Z scale metadata is overridden to the existing `0.001` minimum policy and `0.001` step.
- Regression: `scripts/checkRun216ScaleInputPrecision.js` verifies the Inspector precision contract.
- Regression: `scripts/checkRun216LargeAssetScalePolicy.js` verifies deterministic oversized import normalization for the black dragon and human assets and confirms they remain shrinkable below normalized import size.
- Contract: `scripts/checkRun216ScaleInputPrecisionBranchContract.js` binds the runtime and both proofs into one atomic stacked unit.
- Additive-only: branch comparison against merge base `7a71085098fc5be856106fa5943d36bc5d04872f` contains additions only.
- DoD status: not DONE; hosted GitHub Actions remain blocked at account billing/spending gate before runner steps start, so browser/PWA/perf/console proof remains pending.
- Concurrency: active `agent/run216-world-editor-transform-controls` continues independently; do not merge this stacked unit without rechecking its current head and the full Run216 validation chain.
