# Terrain sediment/rainwash realism

This round adds a deterministic render-only sediment system to the terrain material chain. It models catchment accumulation, directional rainwash, aggregate exposure, temporary shallow film, and dry mineral crust. The system is explicitly prohibited from changing canonical owner-map height, hydrology, coastline, vegetation placement, colliders, or geometry.

The regional profile table deliberately separates material response from spatial signal. World-space profile blending avoids UV/chunk boundaries and gives plains, floodplains, terraces, benches, coastal margins, cool ground and dry uplands subtly different sediment behavior.

## QA contract

`checkTerrainSurfaceSediment.mjs` validates deterministic state, bounded signals, material installation idempotence, canonical invariants, shader markers, and characteristic responses. `checkTerrainSurfaceSedimentPerformance.mjs` performs a 16,000-sample deterministic sweep and enforces a per-sample budget.

The generated coverage fixture is intentionally broad: it samples the complete owner-map-sized world-space envelope at multiple heights and slopes so regressions are not hidden in a small hand-picked set. The fixture contains inputs only; expected behavior remains in executable contracts rather than frozen screenshots.
