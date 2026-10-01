# Next-generation World Intelligence

This module introduces a deterministic, bounded intelligence layer for the existing AAPW runtime. It is deliberately additive: it does not replace the renderer, physics, player state machine, asset pipeline, or legacy gameplay owners.

## Architecture

`types.ts` defines branded identifiers, actor snapshots, stimuli, memories, goals, intents, interests, world events, quests, encounters, metrics, and immutable snapshot contracts.

`blackboard.ts` supplies per-actor state with revision tracking, expiry, bounded memories, deterministic queries, decay, goal ledgers, relationship helpers, and conflict-aware snapshot merging.

`perception.ts` converts world stimuli into confidence-weighted observations. Visual, acoustic, damage, resource, weather, and faction signals share one bounded policy. Occlusion is injectable, so the same simulation path works with a real visibility system, a headless server, or deterministic tests.

`utility.ts` implements utility-AI scoring with reusable curves, weighted terms, faction preference, goal ranking, and intent projection. The result is stable under repeated evaluation and has explicit gates rather than hidden side effects.

`decision.ts` adds bounded decision arbitration, danger estimation, action projection, cooldown memory, interruption rules, and a commit gate. The commit gate prevents stale or lower-value intent churn from oscillating the caller-owned controller.

`interest.ts` provides deterministic world-interest ranking, subscriptions, event heatmaps, and bounded candidate scans. This is useful for NPCs, streaming hints, contextual audio, quest discovery, and encounter placement without making the intelligence module the renderer owner.

`events.ts` provides an append-only, deduplicated, retention-bounded world-event journal with filtered subscriptions, delivery tracking, event coalescing, and stable digests for replay/CI verification.

`quests.ts` adds data-driven quest graphs, objective progression, bounded quest storage, snapshot/restore, and event-driven progress updates.

`encounters.ts` scores and spawns deterministic encounter candidates with biome/faction/danger/level context, cooldowns, population limits, and bounded participant selection.

`director.ts` composes the complete pipeline into one fixed-cost tick boundary. All expensive collections are capped, every subsystem fails closed after disposal, and the runtime can emit a compact deterministic snapshot for diagnostics or replay.

`catalog.ts` contains a starter library of faction-aware actor archetypes, world profiles, and tuning combinations. These are data-only and can be replaced by project-specific content later.

`adversarialMatrix.ts` defines hostile-input scenarios around invalid numbers, duplicate identifiers, saturated queues, stale snapshots, disposal paths, extreme positions, event floods, and boundary timing.

`validation.ts` provides release-style acceptance gates for input boundaries, perception, decision, event, interest, determinism, and adversarial coverage.

## Determinism

All ranking operations use stable secondary keys. Memory and event queries are sorted. Encounter selection uses the existing deterministic RNG implementation. Snapshot output is sorted by identifier so byte-level comparisons can be used in CI.

## Performance model

Every major collection has an explicit bound. The runtime applies actor, stimulus, memory, goal, event, interest, quest, and encounter caps. This keeps worst-case work predictable and makes the module suitable for a browser/mobile runtime as well as headless verification.

## Integration boundary

The intelligence layer consumes immutable actor/stimulus snapshots and returns immutable decisions, interests, events, and snapshots. Callers remain responsible for movement, animation, combat mutation, hit detection, scene objects, asset loading, physics, persistence transport, and actual device APIs.

## Recommended runtime flow

1. Collect the current actor and world snapshots.
2. Append external world events to the journal.
3. Run `WorldIntelligenceRuntime.tick` at the simulation boundary.
4. Apply only the returned intent/interest receipts in existing gameplay owners.
5. Record the returned metrics and snapshot digest for telemetry/replay.
6. Run validation in headless CI before a release cut.

## Safety properties

The module rejects stale writes, deduplicates events, caps queue sizes, bounds numeric inputs, expires old memories, clamps utility scores, keeps all public snapshots immutable, and becomes inert after disposal.

## Extension points

The policy interfaces allow a future navmesh adapter, learned utility scorer, GPU visibility probe, server-side authority layer, or Web Worker transport without changing the public gameplay contract.
