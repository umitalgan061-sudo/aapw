# Terrain seasonal erosion and freeze-thaw surface layer

## Purpose

This round adds a deterministic render-only aging layer to the authored terrain material stack. The feature is designed to make the same canonical world feel different according to season, moisture history, freeze-thaw exposure, snowmelt, runoff concentration, drying and substrate response without changing the underlying world geometry.

The layer answers a visual question rather than a simulation question: given an existing terrain cell at a known world position and seasonal state, what small material changes should communicate recent environmental history?

The implementation therefore keeps the canonical terrain authoritative. Height, hydrology, coastline, colliders and vegetation placement are inputs or invariants; they are never rewritten by the seasonal erosion resolver.

## Layer order

The existing terrain surface chain already contains biogenic, runoff, soil, seasonal, climate, aeolian, weathering, wind-exposure and thermal-microclimate stages. Seasonal erosion sits as an additional render-response composition stage rather than replacing those systems.

The practical order is:

1. authored terrain material and canonical geometry,
2. existing sediment/rainwash response,
3. existing soil and moisture response,
4. existing climate/wind/thermal responses,
5. seasonal erosion state,
6. seasonal erosion material composition,
7. render-only shader modulation.

The new adapter intentionally consumes the sediment response instead of duplicating it. This prevents two independent algorithms from producing contradictory basin, wash and film cues.

## Environmental signals

The seasonal forcing model is deterministic over a 360-day authored year. Spring, summer, autumn and winter each occupy 90 days. The forcing function emits warmth, rain pressure, drying pressure, frost pressure and snowmelt pressure.

Temperature is derived from mean temperature plus a sinusoidal seasonal term. This is not intended as a meteorological forecast; it is a stable artistic forcing signal that gives neighboring samples a continuous response.

Snowpack is separated into four visual signals: accumulated pack, frozen fraction, melt fraction and runoff pulse. Snowmelt only changes the material response; it does not create new water geometry.

Freeze-thaw response detects near-freezing conditions and combines temperature, humidity and substrate family. Brittle substrates such as schist, shale, mudstone, tuff and talus amplify the visible crack/wear term.

Moisture uses a one-step exponential memory. This avoids an abrupt transition between wet and dry states when a scene advances by a single frame or day. Drought and drying signals use longer time constants so a brief rain event cannot instantly erase a visually dry surface history.

## Spatial scales

The resolver deliberately mixes several scales. Broad 1.2 km structure controls regional exposure, a 280 m scale introduces catchment variation, a 46 m scale creates rill-like concentration and a 31 m scale creates freeze-thaw pockets. This makes the output visible at both world scale and close range without adding geometry.

The spatial functions use integer-hash based value noise and fixed octave transforms. There is no time-seeded random number generator, no frame-indexed randomness and no dependency on object allocation order for the resulting scalar fields.

## Material response

The seasonal response changes only small material properties:

- albedo receives restrained wet, frost, erosion and crust tinting;
- roughness responds to wetness, crust, frost wear and exposed erosion;
- normal strength increases slightly where rills or frost suggest micro-relief;
- specular response is damped where wet fines or frost dominate.

The final values are clamped to [0, 1] wherever the consuming material contract expects normalized values. The adapter retains the original base material as the starting point so the feature cannot turn the terrain into an unrelated material family.

## Climate and substrate calibration

The profile book covers ten climate families: subarctic, cold-oceanic, temperate, mild-oceanic, wet-temperate, dry-temperate, mediterranean, highland, alpine and volcanic.

Each climate has multiple substrate profiles. Profiles provide rainfall, snowfall, freeze-cycle, saturation, drainage, exposure, erosion, frost-wear, crust, mud, moss-retention and dust-retention scalars. These are calibration values, not physical constants.

A profile may also contain qualitative flags such as snowmelt, salt mist, waterlogged, summer-dry, freeze-thaw, porous-rock or channel-margin. Flags are available for future material adapters and do not change the canonical terrain.

## Event planner

The event planner ranks twelve visual event types: snowmelt, freeze-thaw, storm-runoff, saturation, drying, dust-deposition, crust-formation, channel-wash, surface-recovery, salt-wetness, thermal-spall and fines-settlement.

Each event has a bounded score. The planner is useful to debug why two nearby cells differ: a cell can expose the dominant event and its top three alternatives without exposing internal implementation details.

Event timelines are sampled on a fixed cadence and can be compared between two parameter sets. This provides a human-readable way to inspect whether a tuning change moves a region from, for example, saturation to drying without scanning raw material values.

## Runtime and caching

Runtime keys contain quantized world coordinates, day, hour, climate and substrate. Material cache keys also retain the existing surface-stack cache identity. The cache contracts avoid using raw object identity or insertion order as part of a key.

The deterministic probe resolves the same input twice and compares both material output and cache key. The stress suite repeats this over many world-space points and parameter combinations.

## Shader strategy

The shader implementation is a small deterministic GLSL helper set. It uses the same conceptual signals as the CPU resolver but keeps the GPU expression intentionally lightweight: one compact hash, value-noise interpolation, five-octave FBM, ridge conversion and three final masks.

Color, roughness and normal functions are inserted into the existing Three.js material include points. The shader hook marks userData with the same canonical-boundary invariants as the CPU side.

No shader function writes vertex position. The code also does not modify collision meshes or terrain height buffers.

## Regression strategy

Regression is split into several layers:

### Profile integrity

The profile test verifies the expected profile count, climate coverage, substrate coverage and normalized response fields.

### Forcing bounds

Annual forcing, snowpack, freeze-thaw, runoff and wind-drying helpers are swept over their input ranges. Values must remain finite and normalized.

### Spatial determinism

The same world coordinate and seasonal input must produce the same state and material output across repeated evaluations.

### Continuity

Consecutive days are sampled to make sure seasonal age and erosion do not jump outside the configured continuity envelope.

### Stress matrix

The stress fixture combines climates, substrates, temperatures, slopes, moisture and wind exposure. It includes steep slopes, wet basins, dry ridges, alpine snowpack, highland frost fronts and exposed volcanic surfaces.

### Long world-space grid

A larger grid samples distant world coordinates to detect accidental coordinate collapse. The regression checks that world-space signatures do not become identical merely because the input climate is identical.

### Performance guard

A 512-sample stress pass has a bounded wall-clock budget. The guard is intentionally conservative for CI while still catching accidental exponential loops or repeated expensive allocations.

## Canonical invariants

Every public seasonal-erosion state carries `canonicalTerrainUntouched: true`.

The policy also exposes the following explicit invariants:

- `canonicalHeightUnchanged`
- `canonicalHydrologyUnchanged`
- `canonicalCoastlineUnchanged`
- `canonicalColliderUnchanged`
- `canonicalVegetationPlacementUnchanged`
- `newGeographyIntroduced:false`

These are not comments-only promises. Regression code checks the state payload and runtime output for the boundary marker.

## Tuning guidance

Prefer changing profile values or response weights over changing spatial scales. Spatial scale edits can alter regional continuity and make prior probes difficult to compare.

When changing frost weights, inspect schist/shale/talus first because brittle-substrate amplification is intentional. When changing runoff weights, inspect both low-slope wetland samples and 50+ degree rill samples so the same change does not flatten their contrast.

When changing drying, inspect dry-temperate and mediterranean samples across both sheltered and exposed wind cases. The desired result is gradual surface aging rather than a binary wet/dry switch.

When changing cache identity, update the material key and rerun the deterministic probe suite. Do not silently remove dimensions from the runtime key.

## Future extension points

The current event planner leaves space for later additions without requiring terrain geometry changes. Candidate additions include: salt crystallization on exposed coastal rock, freeze-thaw debris tone around talus, leaf-litter retention under sheltered canopies, wildfire-blackening as a render-only historical signal and seasonal dust source/sink balance.

Such additions should continue to consume authored world state and should not introduce new persistent geography unless the task explicitly changes the canonical world-authoring contract.

## Acceptance criteria

A completed round should satisfy all of the following:

1. the feature remains deterministic;
2. CPU and shader responses remain bounded;
3. canonical terrain geometry remains unchanged;
4. climate and substrate families retain distinct visual behavior;
5. seasonal transitions stay continuous enough for normal frame-to-frame rendering;
6. repeated samples return identical material values;
7. cache keys are stable and parameter-sensitive;
8. focused regression tests are green before merge;
9. the pull request diff is substantial enough to represent a real feature round, not padding;
10. failed repository-global infrastructure checks are reported separately from feature-specific results.
