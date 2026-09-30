# R16 Production Release Checklist

## Determinism
- Use the fixed-step clock for simulation-facing work.
- Keep command ordering stable by priority, tick and id.
- Archive runtime digests with the build identifier.
- Run repeated replay verification before release.

## State
- Mutate shared state only through R16 transactions.
- Reject invalid depth, breadth and non-finite values at the boundary.
- Capture checkpoints before risky migrations.
- Verify snapshot and save digests during restore.

## Scheduling
- Give simulation, render, network, streaming, save and worker work explicit budgets.
- Keep phase queues bounded.
- Prefer deterministic deferral over unbounded backlog growth.
- Watch p95 pressure signals instead of single-frame spikes.

## Rendering and assets
- Feed frame pressure into the performance governor.
- Keep texture and asset residency within byte budgets.
- Do not evict pinned resources unless the policy explicitly permits it.
- Keep presentation adapters renderer-neutral.

## Network
- Validate schema, sequence, tick skew, expiry, payload size and checksums.
- Apply per-peer message and byte limits.
- Reject stale revisions.
- Keep recovery rate limited.

## World and workers
- Classify distant entities into sleeping or low-frequency bands.
- Cap per-band work.
- Bound worker concurrency and queue length.
- Use migration parity evidence before promoting typed ownership.

## CI
- Run the R16 contract.
- Run the strict R16 TypeScript compiler.
- Run all R16 tests.
- Check the exact pull-request head and diff hygiene.
- Treat unrelated historical workflows independently rather than masking failures.

The R16 layer is production hardening infrastructure. It is designed to make future renderer, gameplay, audio, world and network upgrades safer without replacing their existing owners in one uncontrolled migration.

## Evidence to archive
- CI run identifiers for contract, compiler and test jobs.
- Final head SHA and merge-base SHA.
- Runtime digest and snapshot digest from the release candidate.
- Replay verification result and determinism mismatch count.
- Network security rejection counters and health report.
- Asset manifest digest and cache residency plan.
