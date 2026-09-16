# Next-Generation Runtime Resilience Platform

## Purpose

AAPW's 3D mode now has many independently evolved systems: terrain streaming, real asset hydration,
characters and creatures, day/night visuals, water, roads, settlements, editor tooling, PWA caching and
responsive input. The next scaling problem is not another isolated feature. It is cross-system coordination.

This platform defines a common policy layer for that coordination without replacing any existing gameplay
or world owner.

## Architecture

```text
                         +-----------------------+
                         |  Browser capabilities |
                         | WebGL / DPR / input   |
                         | memory / network / a11y
                         +-----------+-----------+
                                     |
                                     v
                         +-----------------------+
                         | deviceCapabilities.js |
                         +-----------+-----------+
                                     |
                                     v
                         +-----------------------+
                         | runtimeFeatureMatrix  |
                         | hard limits + flags   |
                         +----+----+----+---------+
                              |    |    |
             +----------------+    |    +----------------+
             v                     v                     v
   +----------------+   +----------------------+  +------------------+
   | performance    |   | asset admission      |  | accessibility / |
   | budget policy  |   | queue + concurrency  |  | input matrix     |
   +-------+--------+   +----------+-----------+  +--------+---------+
           |                       |                       |
           +-----------+-----------+-----------------------+
                       v
             +-----------------------+
             | adaptiveRuntimeGovernor|
             +-----------+-----------+
                         |
                         v
             +-----------------------+
             | quality applicator     |
             | caller-owned boundary  |
             +-----------+-----------+
                         |
            existing renderer/world owners

     +-------------------+------------------+
     |                                      |
     v                                      v
offlineResilience.js                runtimeTelemetry.js
     |                                      |
     +------------------+-------------------+
                        v
             runtimeHealthCoordinator
                        |
                        v
              supportSnapshotSerializer
```

## Design rules

### 1. Existing authorities remain authorities

The platform does not create a second terrain generator, renderer, camera controller, physics layer,
asset loader, input listener, NPC brain, settlement manager or editor runtime. It calculates policy and
returns immutable snapshots. The existing owner applies those snapshots.

### 2. Device detection is conservative

Unavailable APIs resolve to lower-confidence values instead of manufacturing optimistic capabilities.
WebGL version, logical cores, device memory, DPR, viewport, pointer class, reduced-motion preference and
network hints are normalized into one profile.

### 3. Mobile constraints are invariants

Coarse-pointer hardware does not receive desktop shadow budgets just because a manual setting requests a
higher tier. Save-Data suppresses heavy texture upgrades and reduces asset concurrency. Reduced motion
suppresses camera shake and high-frequency visual animation. These are hard safety/presentation rules.

### 4. Performance uses a window, not a single frame

The budget evaluator uses bounded frame history and p50/p90/p95/p99 statistics. A single long frame
cannot cause visible quality oscillation. The governor requires repeated pressure before degrading and
sustained headroom before recovering.

### 5. Work is explicitly budgeted

The asset admission queue separates critical/player/world/ambient/prefetch priorities. The session ledger
tracks terrain, assets, animation, effects, UI and diagnostics work. No platform module starts a Promise
or network request merely to measure or decide policy.

### 6. Diagnostics are privacy-safe

RuntimeTelemetry is an in-memory bounded journal. Arbitrary objects are dropped, strings are truncated,
and there is no network upload. Support snapshots retain status, budgets, small event names and stable
digests rather than player-entered or URL-bearing data.

### 7. Offline is a first-class state

OfflineResilience distinguishes network state, service-worker controller state, update state and storage
pressure. It never clears caches automatically. It reports whether heavy prefetch should be deferred and
whether cache mutation should be avoided.

### 8. EventBus integration is optional and reversible

RuntimeEventHealthBridge can translate public lifecycle signals into telemetry without replaying or
rewriting those events. It always returns an explicit disconnect function, allowing tests and future
boot lifecycle owners to control subscription lifetime.

## Production adoption boundary

The platform lives under `src/3d/platform/` as a policy toolkit with an executable contract. It is safe to
adopt from existing runtime owners in small slices instead of adding a monolithic controller to
`game3d.js` or `sceneManager.js`.

The intended adoption sequence is:

1. Read capabilities once during boot.
2. Build a feature matrix and initial asset/session budgets.
3. Create the governor and health coordinator.
4. Feed already-measured frame timings from the existing tick loop.
5. Apply quality snapshots through the caller-owned adapter.
6. Connect EventBus lifecycle events only where a concrete owner needs diagnostics.
7. Expose the support snapshot through an existing debug surface rather than adding a second debug UI.

This keeps the project's current 600-line-per-file discipline intact and avoids overlap with the current
player/combat, fauna and terrain feature swarms.

## Acceptance matrix

| Area | Contract | Failure behavior |
|---|---|---|
| Capabilities | bounded normalized profile | conservative fallback |
| Quality | tier + numeric budgets | clamp to known levels |
| Performance | robust rolling window | hold/stabilize |
| Adaptation | confirmation + cooldown | no oscillation |
| Accessibility | reduced-motion / contrast | hard presentation caps |
| Input | capability vocabulary | explicit primary method |
| Assets | admission + priority | defer/reject rather than overload |
| Offline | network/storage/update state | defer heavy work |
| Telemetry | bounded safe journal | drop unsupported values |
| Health | combined status | degraded/critical evidence |
| Support | deterministic serializer | bounded JSON-safe output |

## Verification

The focused executable contract is `scripts/checkRuntimeResiliencePlatform.mjs`. It imports the actual
production modules and exercises capability classification, hard mobile constraints, reduced motion,
feature matrices, percentile performance pressure, governor hysteresis, telemetry sanitization,
offline state, asset admission, session budgets and health aggregation.

The deeper cross-system matrix is `scripts/checkRuntimeResilienceDeepMatrix.mjs`. It intentionally tests
interactions such as mobile + Save-Data, mobile + reduced motion, offline + storage pressure and strong
desktop hardware under sustained stalls.

`checkRuntimeSourceBoundaries.mjs` enforces the ownership boundary. Platform modules may not own timers,
random world state, direct network requests, persistent writes, editor runtime, scene attachment or
contested world owners.

The GitHub Actions workflow `runtime-resilience-platform.yml` runs the focused contract, source
boundaries, syntax, whitespace and source-surface gates on Node 22.

## Why this is a platform rather than a feature

AAPW has repeatedly gained new specialized contracts as the 3D world grew. Without a common policy layer,
every new subsystem risks implementing its own device test, frame budget, offline decision or debug record.
That creates hidden coupling and contradictory behavior.

The runtime resilience platform makes those concerns reusable. A future foliage culling pass, texture
streamer, combat animation budget or terrain LOD system can consume the same feature matrix and work ledger
instead of creating another one-off scheduler or device detector.
