# Terrain climate, wind and weathering surface stack

## Scope

This round adds a deterministic, render-only surface response layer on top of the existing terrain sediment stack.
The implementation is deliberately a material treatment, not a terrain simulation rewrite.

## New response families

### Climate exposure

`terrainSurfaceClimateExposure.js` models broad and meso-scale proxies for frost exposure, snow-band response, solar drying, thermal range, cold-air pooling, rime and ice-lens cues.
The CPU response is deterministic for a world-space coordinate and bounded to `[0, 1]` for every derived scalar.

### Aeolian dust

`terrainSurfaceAeolianDust.js` adds a render-only proxy for windward transport, lee accumulation, dust veil, exposed substrate and fine surface film.
Its wind bearing is fixed by policy, which makes cache keys and regression snapshots stable.

### Rock weathering

`terrainSurfaceWeathering.js` adds frost cracking, joint structure, oxidation, salt scaling, wet rims, friable rims, exfoliation and micro-crack responses.
The layer modifies only material color, roughness and normal strength.

### Micro-wind exposure

`terrainSurfaceWindExposure.js` separates local windward exposure from shelter and calm pockets.
It is useful for breaking up uniform mountain-side shading without inventing new geometry.

### Thermal microclimate

`terrainSurfaceThermalMicroclimate.js` adds insolation, cold-pool, radiative-cooling, freeze-risk, heat-load and dew-retention proxies.
The response is visual and intentionally independent from gameplay temperature systems.

## Composition order

The production installer is owned by `terrainSurfaceSediment.js` so every lowland material receives the same program-cache contract.
The stack order is: sediment, biogenic, runoff, soil structure, seasonality, climate exposure, aeolian dust, weathering, micro-wind, thermal microclimate.

Each installer is idempotent and contributes a stable material cache-key suffix.
Each installer also writes a policy identifier to `material.userData` for runtime inspection and QA.

## Non-goals

The stack does not alter canonical height fields.
It does not create or remove rivers, lakes or coastlines.
It does not alter colliders or navigation geometry.
It does not place vegetation or gameplay assets.
It does not claim physical hydrology, atmospheric simulation or sediment mass conservation.

## Determinism

All procedural fields use integer-hash/value-noise style functions with fixed seeds and fixed world-space scales.
The QA suite runs repeat calls and compares full returned objects where practical.
Performance checks use fixed catalogs rather than randomized sampling.

## Material limits

All color channels remain bounded.
Roughness is clamped before reaching the final material.
Normal perturbation is deliberately small compared with terrain-scale shading.
The strongest cues are reserved for exposed or high-relief surfaces so lowland materials remain readable.

## QA entry points

- `scripts/checkTerrainSurfaceClimateExposure.mjs`
- `scripts/checkTerrainSurfaceAeolianDust.mjs`
- `scripts/checkTerrainSurfaceWeathering.mjs`
- `scripts/checkTerrainSurfaceMicroclimateStack.mjs`
- `scripts/checkTerrainSurfaceClimateWeatheringPerformance.mjs`

The exact-head workflow additionally validates ancestry against current `main`, syntax, deterministic repeat output and ownership boundaries.

## Calibration

`terrainSurfaceClimateCalibration.js` contains bounded climate response bands that are available for future profile-specific tuning without changing the canonical terrain data model.

## Visual intent

At low elevation the result should read as moist, depositional and sheltered.
As relief increases, wind exposure, weathering and thermal contrast should progressively reveal more mineral character.
Cold and wet combinations should introduce subtle rime/dew cues rather than a blanket blue overlay.
Dry, exposed rock should gain slightly stronger roughness and micro-normal activity without becoming noise-dominated.

## Regression principle

The large spatial probe catalogs intentionally span negative elevation, lowland transitions, frost-band thresholds, steep slopes, high mountain zones, dry corners and wet corners.
They are designed to catch accidental discontinuities at material-policy boundaries before a merge.
