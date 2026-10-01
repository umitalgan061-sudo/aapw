# Buzul Muhafızı — Photorealism Director

## Purpose

This slice adds a deterministic, typed environment decision layer for the shipped world. It targets the actual visual debts called out by the environment owner: flat single-tone terrain, weak macro/micro breakup, toy-like vegetation rules, cyan shoreline blocks, visible water repetition, and black/flat atmospheric falloff.

The director is intentionally not a second terrain engine. It consumes a sample from the existing world authorities and returns a bounded immutable frame for renderer, material, placement, telemetry, and acceptance consumers.

## Authorities preserved

- Canonical map/world terrain remains the geographic source.
- Rendered geometry and colliders remain owned by the existing terrain/collider path.
- Water mesh/depth remains owned by the water runtime.
- Asset loading and transform grounding remain owned by `WorldAssetPlacementPipeline.js`.
- Material validation/recipes remain owned by `MaterialAssignmentCore.js`.
- `EditorMaterialStudio.js` is not imported into runtime code.

## Production decisions

### PBR and anti-tiling

The frame derives roughness, normal strength, AO, clearcoat, transmission, and a macro/micro phase pair from slope, moisture, rock/snow authority, water proximity, and deterministic world-space hashing. No GeoCell/Pindex/grid term participates in the result. The phase values are world-space and can therefore be shared across chunk boundaries without visible square seams.

### Water and shore

The water response separates dry, wet-edge, shallow, and deep states. Shoreline fade, foam, roughness, normal scale, and caustic gain are continuous bounded values. This is a decision contract; it does not invent a new polygon or paint cyan blocks over land.

### Vegetation and placement

The frame emits canopy, understory, shrub, grass/reed/moss bands with slope, road, settlement, and water exclusions. Tree placement is rejected for deep water, exposed rock, steep slopes, near-road corridors, and settlement envelopes. The result is a query for the shared placement pipeline, not a clone/spawn loop.

### Atmosphere

Fog density, aerial perspective, sun/moon energy, sky luminance, and exposure are tied to altitude, coldness, and biome. This prevents the shipped sky from collapsing into a black background while keeping snow and ocean exposure distinct.

### Performance

Each frame carries a target frame time, draw-call budget, triangle budget, texture budget, LOD bias, and instance batch size. The values are conservative and can be consumed by the existing adaptive render policies rather than bypassing them.

## Acceptance surface

The dedicated workflow proves:

1. TypeScript source ownership is present and the JS file is only a compatibility boundary.
2. Shared placement/material authorities are named and preserved.
3. Runtime does not import editor material UI.
4. Water safety, anti-tiling, PBR, atmosphere, and provenance surfaces exist.
5. Deterministic Vitest coverage passes for land, shoreline, cliff, and cold-snow samples.
6. All frames carry canonical source, placement authority, material authority, and stable deterministic keys.

## Next integration step

The next production vertical slice should consume `frameToMaterialRecipe()` from the live terrain material/material-placement adoption point and expose the frame's `performance` budget to the existing adaptive render orchestrator. That follow-up must use the same exact-main freshness and visual acceptance matrix; it must not duplicate the placement or material systems.
