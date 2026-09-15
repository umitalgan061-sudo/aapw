# Groundwater Render Runbook

## Purpose

Use this runbook when extending or reviewing the groundwater surface layer.

## Before coding

1. Read `terrainGroundwaterRegime.js` and its policy object.
2. Confirm the current `main` SHA.
3. Check that the new work stays render-only.
4. Prefer extending deterministic pure functions before adding new state.
5. Add a focused acceptance script for every new integration surface.

## During coding

Keep environmental inputs explicit. Avoid hidden globals. Do not introduce random sources. Keep continuous outputs bounded. Freeze public catalog and state payloads when the surrounding API expects immutable data.

When adding a shader hook, prefer an existing material include point. Do not change vertex position, terrain height, collision, navigation, coastline, or vegetation placement.

When adding cache behavior, cache presentation frames rather than terrain authority. Include policy version in the key.

## Test order

Run focused checks in this order so failures are easier to localize:

```text
boundaries
regime
seasonality
materials
integration
metamorphic
quality guards
presets
fixture coverage
render cache
invariants
acceptance
```

## Failure triage

A syntax or import failure is fixed before any performance discussion. A non-finite value is treated as a logic defect. A canonical invariant failure is treated as a scope violation. A shader replacement failure is treated as a material integration defect. A deterministic signature change receives explicit review.

## Merge gate

Do not stop a development turn while the repository-side diff remains below the configured 4,000 meaningful-line threshold. The threshold must be reached with production logic, real QA coverage, or useful documentation; artificial repeated text or padding is not acceptable.

Before merge, compare the branch against current `main`, verify there is no unexpected drift, inspect the final diff for unrelated deletions, and run the focused groundwater checks available in the repository.

## Regression discipline

Fixture values are allowed to evolve when the intended environmental model changes. In that case update the acceptance expectation in the same conceptual change and record the policy revision. Do not silently regenerate expected signatures only to make a failing test pass.

## Scope reminder

This feature is a surface presentation layer. A future physical groundwater simulation must remain a separate authority and must not be smuggled into this render module through mutable caches or hidden global state.
