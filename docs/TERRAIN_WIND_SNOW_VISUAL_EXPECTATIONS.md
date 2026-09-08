# Shipped Snow Visual Expectations

This is the compact reviewer sheet for the current Buzul Muhafızı snow-relief production slice. It is
intended to be read next to the real `createScene()` screenshots and CI report, not as a substitute for
those artifacts.

## Full-world expectations

At 1536×1024 orthographic full-world framing, the northern snow field should retain large-scale
geographic continuity while no longer reading as a uniform white rectangle.

Expected:

- broad snow coverage follows the existing canonical cryosphere;
- windward mountain shoulders are subtly more exposed;
- lee pockets are subtly fuller;
- the visual response remains tied to relief and does not become a screen-space diagonal;
- the coastline and water polygons remain unchanged;
- distant mountains remain visible through the existing atmosphere;
- no new black-sky failure appears.

Reject:

- a rectangular or tile-shaped snow field;
- a repeating diagonal stripe across plains;
- a hard square boundary aligned with a chunk or texture tile;
- a global cyan/white wash unrelated to biome or relief;
- snow visibly crossing canonical water.

## Far mountain expectations

The far view is primarily a silhouette and distribution test.

Expected:

- the existing ridge and valley silhouette is preserved;
- snow coverage follows broad topographic mass instead of a flat altitude mask;
- exposed ridges read thinner than sheltered shoulders;
- steep faces do not become uniformly white walls;
- fold response remains spatially continuous as the camera moves;
- atmospheric perspective remains consistent with the rest of the world.

Reject:

- a newly invented ridge, valley or plateau;
- abrupt snow steps at apparently arbitrary coordinates;
- one mountain reading as a smooth gray or white slab with no landform variation;
- a new horizon line or fog band caused by the snow slice.

## Terrain-level expectations

The near view is where the player should be able to see the difference between surface form and a
painted texture.

Expected:

- snow/rock transitions respect slope;
- rough folded terrain produces small changes in snow retention;
- lee pockets are visibly fuller without becoming blobs;
- scoured faces reveal restrained underlying rock tone;
- the surface remains free of repeating moiré patterns;
- no geometry displacement occurs because of the snow response.

Reject:

- white paint covering every face equally;
- crisp shader borders around snow patches;
- repeated line patterns;
- floating or displaced assets;
- snow response visible as a post-process overlay rather than a surface-material change.

## Climate expectations

Permanent-ice terrain may receive the strongest bounded response. Tundra receives a restrained response.
Warm/temperate terrain receives no wind-driven redistribution from this module.

Expected:

- climate remains map-aligned;
- cold-region asymmetry is visible only where the canonical snow system already supplies snow;
- southern/warm areas do not inherit a northern diagonal snow mask.

Reject:

- wind response with no snow supply;
- warm lowlands carrying a northern snow stripe;
- a climate edge that becomes a hard rendered rectangle.

## Water boundary expectations

The snow slice never owns water geometry.

Expected:

- existing water mesh remains in its established location;
- frozen shoreline remains continuous;
- snow terminates against canonical water classification;
- shallow water stays a water problem, not a snow workaround.

Reject:

- cyan water rectangles;
- snow laid over lake/sea cells;
- a modified shoreline caused by snow thresholds;
- water moiré that appears only after this PR.

## Vegetation expectations

The slice does not place or replace vegetation assets. Review only checks for accidental interaction.

Expected:

- existing trees remain grounded;
- no new floating vegetation occurs;
- no forest disappears because snow response altered geometry.

Any primitive/sparse/incorrect vegetation that predates the slice belongs to the active vegetation or
biome-placement candidates and must not be mislabelled as solved here.

## Performance expectations

The response is scalar and local. It must not introduce per-frame world searches, heavy mesh cloning or
new asset loads.

Expected:

- deterministic scalar work per terrain sample;
- no random allocation path in the render helper;
- no additional terrain sampler;
- no new vegetation/water/material authority;
- existing browser/mobile/performance budgets remain within repository gates.

Reject:

- visible LOD pop created by the slice;
- frame-time regression attributable to a new global scan;
- memory growth from duplicated environment assets.

## Acceptance sequence

Reviewers should read the evidence in this order:

1. Exact main SHA and PR head SHA.
2. Source-to-runtime parity result.
3. Directional/orographic regression results.
4. Deterministic field, relief and edge-case results.
5. Renderer-facing snow tone result.
6. Shipped `createScene()` full-world and near screenshots.
7. Repository-wide Run167/Run283, Terrain3D/HTerrain, PWA/mobile and performance results.

A failure at any visual level blocks merge even when every numerical assertion passes.

## Final reviewer rule

This slice succeeds when the player reads *landform first, snow second*: mountains retain their canonical
shape, snow follows folds and exposure, exposed rock reappears naturally, and no artificial tile/stripe/
rectangle replaces the underlying geography.
