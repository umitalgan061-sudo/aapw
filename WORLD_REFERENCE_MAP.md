# Canonical 2D → 3D World Reference Map

Owner directive, 2026-08-08: the supplied 2D world map is now the canonical macro-geography reference for the 3D world. The 3D implementation must progressively reproduce the visible geography rather than inventing unrelated terrain.

This means coast/seas, mountain chains, cold/snow zones, marshes, grasslands/steppe, forests/jungle, deserts/arid zones and the road network are placed and tuned with this map as the visual source of truth. Existing settlement coordinates, deterministic generation, 2D behavior, mobile/PWA budgets and all safety checks remain hard constraints; the map reference guides macro shape and biome identity but does not authorize silently moving canonical settlements or breaking routes.

The first additive foundation is `src/3d/world/worldReferenceMap.js`, which records normalized image-space biome/water/relief controls and a deterministic map-to-world projection helper. The source image is identified by SHA-256 `20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1`; the normalized vector controls are the repo-persisted implementation contract. Follow-up tasks consume this contract incrementally: coastline/water mask → macro relief/mountain chains → biome materials (snow/marsh/grass/steppe/desert/jungle) → roads aligned to terrain and settlements → localized rock/vegetation/detail passes.

No single giant terrain rewrite is allowed. Each visual layer remains a separately measurable additive change with pre/post terrain-seat safety, road safety, deterministic checksum, browser smoke, console, performance, mobile and PWA/cache verification.

## Coastline / water mask — run 179

`src/3d/world/worldReferenceWaterMask.js` adds the first deterministic raster-derived macro layer: a 96x64 one-bit coastline/water mask (4052 water / 2092 land cells), persisted as compact hex rows with SHA-256 `2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27`. The mask is data-only in run 179: it does not yet alter terrain height or the water plane. Runtime adoption is intentionally deferred until the existing 2D kingdom-marker/world coordinate system is proven to align with this normalized image space; a naive direct full-extent mapping is not an acceptable substitute because terrain-seat and road safety remain hard constraints.
