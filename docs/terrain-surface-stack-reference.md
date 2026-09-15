# Terrain surface stack: sediment, runoff, soil and seasonality

## Scope

This turn extends the production terrain material stack without introducing geography.

The canonical `map.png` owner-map remains authoritative for terrain height and water classification.

The canonical mesh remains authoritative for colliders and vertex topology.

Vegetation placement remains owned by the existing vegetation system.

The new layers only alter material appearance.

## Layer order

The lowland fabric establishes world-space lowland domains.

The sediment layer adds depositional and rainwash response.

The biogenic layer adds organic litter and humus pockets.

The runoff layer adds directional washed shoulders and fine streaks.

The soil layer adds pore, aggregate and crack-rim response.

The seasonal layer adds explicit seasonal appearance.

Each installer preserves the previous `onBeforeCompile` hook.

Each installer appends an explicit material-program cache suffix.

Each installer records render-only invariants in `material.userData`.

Repeated installation is idempotent.

## Sediment model

The sediment field uses broad, meso, basin, rill, aggregate, pore and film scales.

The broad field prevents the world from reading as one homogeneous soil type.

The meso field establishes basin-scale variation.

The basin signal favors gentle low terrain.

The rainwash signal favors stronger slopes.

The rainfall direction is deterministic and world-space.

The aggregate signal introduces mineral grain breakup.

The film signal introduces restrained transient wetness.

The crust signal favors exposed and drier higher surfaces.

The pore signal drives bounded roughness variation.

All signals are clamped to `[0,1]` before material conversion.

The color response is intentionally subtle.

The roughness response is intentionally stronger than albedo response.

The normal response is intentionally weaker than the authored relief.

## Regional profile system

The profile table contains 64 authored response presets.

Profiles include lowland, floodplain, terrace, coastal, clay, loam, gravel, heath and dry-ground families.

Profiles are selected from a deterministic world-space scalar.

Profile blending is performed between adjacent entries.

The spatial field is independent of UV seams.

Chunk boundaries therefore do not restart sediment identity.

## Calibration system

The calibration table contains 512 deterministic calibration rows.

Rows encode deposit, wash, film, crust and cool multipliers.

The sediment profile index maps into the calibration range.

Calibration is applied before the bounded material response.

The calibration table is validated row-by-row in CI.

The calibration lookup is clamped.

Out-of-range requests resolve to the first or last valid row.

## Biogenic response

The biogenic layer distinguishes litter, humus, moss/biocrust, dry crust and mineral exposure.

Vegetation color is used only as a visual cue.

No vegetation object is moved or created.

Moisture increases humus persistence.

Moisture increases biocrust response.

Steep surfaces reduce litter accumulation.

Organic response is masked from obvious snow colors.

Normal energy remains below the configured maximum.

## Runoff response

The runoff layer is a visual weathering proxy, not hydrology.

It cannot create channels.

It cannot change water masks.

It uses a fixed rainfall bearing for deterministic directionality.

Primary paths use broad directional noise.

Branch paths use ridge noise.

Fine stains use smaller-scale ridge noise.

Dry lanes suppress transient-film response.

Aggregate exposure increases with stronger runoff.

## Soil structure response

The soil layer adds aggregate, pore, crack-rim and compaction fields.

Aggregate breakup increases surface roughness.

Pore response reduces roughness locally.

Crack rims slightly warm the material response.

Compaction remains visual only.

Mineral surface exposure is bounded.

Soil skin is strongest in authored lowland and organic regimes.

The layer never edits vertex positions.

## Seasonality

Seasonality is explicit material input.

The default phase is documented in the policy.

Spring increases wet-film response.

Summer increases dry-crust response.

Autumn increases litter response.

Winter increases cold response.

Phase wrapping is circular.

Material appearance therefore remains continuous across the year boundary.

The system can be extended with a runtime uniform without changing canonical terrain ownership.

## QA matrix

Unit-style contract tests validate deterministic state.

Performance tests validate sample budgets.

Regional fixtures cover north, south and coastal envelopes.

Coverage contains 768 explicit world-space test points.

Boundary tests probe chunk seams and extreme coordinates.

Stack integration tests validate material installer composition.

Cache-key tests protect shader-program identity.

Canonical invariant tests protect terrain ownership boundaries.

## Performance intent

All CPU resolvers are deterministic pure functions.

No per-frame allocation is required by the shader path.

Texture generation remains shared and cached by the existing terrain system.

The new CPU diagnostics are used only by QA.

The production render path remains GPU-side for visual variation.

## Visual intent

Lowland basins should look slightly more depositional.

Rain-exposed shoulders should read slightly lighter and rougher.

Wet pockets should read slightly smoother.

Organic ground should read darker and more heterogeneous.

Aggregates should break up uniform soil.

Seasonal changes should remain believable rather than saturated.

The final response should never overpower the authored map colors.

The authored world geography remains the primary visual signal.

## Ownership invariants

`canonicalHeightUnchanged` remains true.

`canonicalHydrologyUnchanged` remains true.

`canonicalCoastlineUnchanged` remains true.

`canonicalColliderUnchanged` remains true.

`canonicalVegetationPlacementUnchanged` remains true.

`newGeographyIntroduced` remains false.

Those invariants are repeated in code and checked by regression scripts.
