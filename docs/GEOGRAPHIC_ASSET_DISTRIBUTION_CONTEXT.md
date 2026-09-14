# Geographic Asset Distribution Context

## Purpose

The geographic asset distribution slice turns an already-resolved world surface sample into a deterministic, bounded decision object for downstream asset producers. It is intentionally downstream of canonical geography. It never creates or edits terrain, hydrology, coastline, road topology, settlement seats or colliders.

The decision chain is:

`canonical world surface -> geographicAssetContext -> cluster planner -> distribution adapter -> existing shared placement/material authority -> asset`

The separation is important. A tree, rock, ruin, waystone or shoreline prop can consume the same geographic vocabulary without becoming a new owner of the world.

## Context dimensions

A context contains biome, moisture, slope, elevation, water depth, shoreline distance, road distance, settlement distance and local relief. Where already available, cryosphere and season evidence are attached as bounded subcontexts. These values are descriptive inputs; the module does not sample hidden terrain state or invent missing geography.

The family matrix contains authored distribution characteristics such as preferred/tolerated/forbidden biomes, moisture and elevation envelopes, slope limits, road and settlement buffers, shoreline affinity, density, clustering, scale and weathering biases. The matrix is explicit so a review can understand why an asset family won a site.

## Selection

Family selection ranks candidates using weighted suitability terms. Hard policy conflicts return a zero score. Near-ties within a bounded score window may be broken by a world-space deterministic hash. This gives organic variation without letting a random draw change canonical placement decisions.

Variant selection is derived from the same world X/Z, family id and seed. The output is an asset-family variant label plus a conservative weathering band such as `wet`, `cold`, `dry` or `standard`.

## Cluster placement

`geographicAssetClusterPlanner.js` uses jittered radial candidates and pairwise minimum spacing rather than a regular grid. The planner records both accepted and rejected candidates. Rejections are explainable: hard policy, unsafe surface, low suitability, context buffer, minimum spacing or producer-mode mismatch.

The planner is budgeted separately for desktop and mobile so a producer can preserve geographic character while retaining predictable workload limits.

## Shared runtime boundary

The distribution adapter is a decision layer, not a new rendering system. Accepted assets are expected to continue through the repository's existing `WorldAssetPlacementPipeline` and `MaterialAssignmentCore` contracts. Material application, footprint grounding, generated texture validation, authored PBR retention and final scene attachment remain owned by those shared systems.

No runtime import of editor-only material tooling is permitted.

## Determinism contract

For the same world X/Z, family set, canonical surface sample and seed, the following must remain stable:

- selected family;
- selected variant;
- candidate positions;
- accepted/rejected classification;
- scale and rotation bias;
- decision digest.

Any change that intentionally alters this contract must advance the policy id/version and update the exact-head acceptance proof rather than weakening a threshold.

## Geographic examples

Temperate lowland favors broadleaf, meadow and understory families, while remaining sensitive to moisture and settlement/road clearance. Cold highland context raises pine, snowpine and froststone families while permanent-ice safety remains a hard ecological boundary. Arid basins favor sandstone, desertgrass and dry shrub language. Wet lowland and river-edge context can admit reeds, wet boulders and driftwood. Volcanic/Valyria context elevates basalt and ash-rock families without altering the canonical Valyria terrain surface.

## Acceptance

The exact-head workflow runs syntax, deterministic replay, family/profile bounds, no-grid architecture checks, authority-boundary checks and diff validation. This proof is intentionally package-light and does not require large authored LFS payloads merely to qualify the decision layer.
