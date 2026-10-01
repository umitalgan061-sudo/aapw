# R35 Intelligent Gameplay Stack

R35 extends the deterministic TypeScript runtime with player-facing systems.
The package is renderer-agnostic and can run in headless tests, workers, or
browser presentation adapters.

## Systems

World simulation provides bounded NPC needs, deterministic decisions, memory,
level-of-detail selection, spatial indexing, and stable state digests.

Quest runtime provides ordered objectives driven by counters, collection,
flags, and events. Quest state is revisioned and snapshot-safe.

Inventory validates item definitions, stack limits, capacity, weight, and
equipment references before state crosses the save boundary.

Dialogue uses a graph of nodes and gated choices. Conditions can reference
flags, counters, and owned items. Effects operate on copied profiles.

Save runtime provides deterministic envelopes, digest validation, bounded
imports, one-step schema migrations, and explicit slot management.

Replay runtime records ordered inputs plus checkpoint snapshots. It can seek
from the most recent checkpoint and reject corrupted or out-of-order data.

Accessibility centralizes reduced-motion, contrast, text scale, subtitle,
color-vision, repeat, input remapping, and haptics state.

Content registry enforces unique versioned identifiers and acyclic dependency
graphs. Streaming adds dependency-first residency plans and byte-aware
eviction decisions.

Weather models deterministic days, hours, seasons, climate zones,
precipitation, visibility, pressure, wind, and gameplay modifiers.

Economy models supply, demand, bounded volatility, balances and a transaction
journal. Crafting validates recipes, skills, stations, ingredients,
byproducts, and deterministic output quality.

Combat provides typed damage, defense, resistance, stamina, cooldowns,
range checks, status effects, and death events. Friendly fire is explicitly
blocked by the authority layer.

Navigation provides bounded A* path search, node blocking, hazards, tags,
penalties, deterministic tie-breaking, and path digests.

Interaction runtime creates contextual candidates from range, priority,
flags and cooldowns instead of allowing each feature to create a different
target-selection algorithm.

Animation manages layered clips, parameters, transitions, looping, speed,
weights, and deterministic snapshots without coupling to Three.js.

Localization provides locale packs, fallback lookup, plural forms,
argument formatting, batch translation, and coverage diagnostics.

Photo mode provides bounded cinematic camera editing, including orbit, dolly,
focus distance, exposure, aperture, field of view, vignette, grain, and UI
visibility.

Streaming keeps asset residency bounded by bytes and tracks access history
for deterministic eviction.

Feature hub composes these systems into one authoritative tick and produces
cross-system snapshots, health data, telemetry and a digest.

## Determinism and safety

R35 does not use ambient random sources for decisions. Time is represented by
integer ticks in authoritative systems. Public state is copied or frozen.
Collections that affect digests are sorted. Population, events, path
expansions, input records, content entries and asset residency all have
explicit limits.

The source guard rejects Math.random, Date.now, eval, and new Function in the
R35 implementation. It also enforces a source/test line floor so a feature
round cannot be declared complete without a substantial implementation.

## CI

The R35 workflow runs a source-of-truth guard, a focused TypeScript 7 compile,
and a focused Vitest suite on Node 24.

The R35 package is isolated in tsconfig.modern-r35.json so its contracts can
be checked independently even while the rest of the repository continues its
legacy-to-modern migration.

## Integration

FeatureHubRuntimeR35 is the intended composition boundary. Existing scene
systems can adopt one subsystem at a time through adapters. Renderer-specific
objects remain outside the deterministic core.

This preserves the existing game while making new gameplay features available
on the modern TypeScript runtime immediately.
