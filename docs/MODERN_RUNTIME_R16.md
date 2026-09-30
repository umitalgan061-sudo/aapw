# AAPW Modern Runtime R16

R16 is a bounded, deterministic TypeScript platform layer below the existing Three.js presentation layer and beside existing gameplay owners.

## Core

The fixed-step clock converts wall-clock deltas into bounded simulation steps. Input enters through a normalized action runtime. Commands are prioritized and applied at explicit ticks. State changes are transactional and source-tagged, producing immutable revisioned patches.

## Scheduling

Frame phases are input, simulation, world, streaming, network, render, save and telemetry. Each phase has explicit work caps. Simulation, render, streaming, network, save and worker queues have independent budgets and rolling pressure signals.

Asset residency, cache residency and worker lanes are deterministic and bounded. The performance governor uses hysteresis before quality upgrades, reducing oscillation under unstable frame pressure.

## Networking and recovery

Network envelopes carry version, peer, sequence, tick, expiry and checksum fields. The security boundary rejects malformed, expired, future, replayed, oversized or over-rate messages. Replication uses monotonic revisions and checksum-protected deltas.

Recovery is phase driven: diagnose, quiesce, reset, replay and resume. Cooldowns and attempt caps prevent recovery storms.

## Persistence and replay

Snapshots are immutable plain-data records. The codec enforces depth, object-key, array, string and byte limits. The persistence journal is bounded and append-only. Replay entries are deterministic and can be compared by digest.

Save migrations require explicit adjacent version steps. A migration surface must first show parity and cannot be promoted after a failed parity result.

## World

World interest bands classify entities as near, mid, far or sleeping, with importance sorting and per-band caps. World streaming plans loads and unloads under byte and operation budgets.

## Integration

`R16RuntimeFacade` is the composition root. Existing renderer and gameplay ownership is preserved; new systems are introduced incrementally through typed boundaries.

## Verification

Run:

`npm run verify:modern:r16`
`npm run typecheck:modern:r16`
`npm run test:modern:r16`

The dedicated GitHub Actions gate checks the exact PR head and runs on Node 24 LTS. Repository-wide historical workflows remain separate from this scope.

## Ownership matrix

| Area | R16 boundary | Existing owner |
| --- | --- | --- |
| Input | normalized action envelopes | browser/UI input |
| Simulation | fixed-step commands and state transactions | gameplay systems |
| Rendering | phase budgets and adapter contract | Three.js/WebGPU renderer |
| Audio | typed scene/runtime events | immersive audio platform |
| Streaming | bounded load plans | resource systems |
| World | interest and sleeping policy | world/NPC/creature systems |
| Network | envelope validation and replication | transport/session layer |
| Save | snapshots, journal and migrations | persistence layer |
| Recovery | coordinated lifecycle | subsystem reset hooks |
| Telemetry | bounded metrics and digests | diagnostics layer |
