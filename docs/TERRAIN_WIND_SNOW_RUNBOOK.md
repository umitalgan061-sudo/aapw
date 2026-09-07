# Buzul Muhafızı — Terrain Wind/Snow Visual Runbook

## Purpose

This runbook is the review contract for the fold-aware snow surface slice. The goal is not to make the
map whiter. The goal is to make existing canonical northern relief read as geology and climate rather
than as a uniformly painted snow plane.

The implementation is render-only. It does not replace the canonical height owner, hydrology owner,
material-assignment core, vegetation placement pipeline, water mesh or settlement geometry. Review must
therefore separate true snow-surface improvement from unrelated environment debt.

## Camera set

Every review uses the same deterministic four-view set:

| View | Purpose |
| --- | --- |
| Full-world 1536×1024 orthographic, 90° | detect map-scale stripes, snow blocks, broad climate leakage and black-sky regressions |
| Far mountain view | inspect ridge/valley silhouette, atmospheric snow separation and repeated bands |
| Terrain-level near view | inspect snow/rock ecotone, micro-breakup, cliff exposure and surface transition |
| Deterministic second near sample | catch a local artifact that the primary near sample happens not to hit |

The same seed, coordinates and camera framing are required for before/after comparison. Do not compare
arbitrary browser screenshots.

## P0 gates

The snow slice must not introduce or preserve any new large-scale renderer artifact.

A failure is recorded when a review shows:

- a rectangular snow or water tile;
- a visible tile seam at a chunk boundary;
- repeated diagonal or horizontal snow bands unrelated to terrain aspect;
- a single snow shade covering unrelated landforms;
- a hard polygon edge around an otherwise continuous snow field;
- a black or unlit world background introduced by the slice.

The prevailing wind direction is allowed to create broad asymmetry, but that asymmetry must follow landform
and climate. It must never look like a screen-space overlay.

## P1 relief gates

A successful mountain surface should preserve the canonical ridge/valley/cliff silhouette and improve the
way snow responds to it.

Inspect exposed shoulders first. Source-facing folded ridges may show thinner loose snow. Sheltered lee
shoulders may retain slightly fuller snow. Near-vertical faces must shed rather than accumulate a giant
powder wall.

Do not accept a new mountain silhouette merely because it looks more natural. Any geometry change belongs
to the canonical terrain/mountain-relief owners.

The following visual relation is desirable:

`windward ridge < planar snow retention < sheltered lee pocket`

for otherwise comparable cold-climate terrain. The relation is qualitative; exact colour or coverage
numbers are not acceptance criteria by themselves.

## P2 surface-material gates

The snow layer should remain visibly connected to the underlying rock/soil system.

Look for:

- rock exposure on steep or scoured faces;
- small tone variation rather than a single white slab;
- retained snow gathering in folds instead of stopping at an artificial pixel boundary;
- transition to frozen shore/tundra that follows the canonical climate field;
- no new checkerboard or texture-repeat pattern.

The slice does not replace the terrain PBR material system. If albedo/normal/roughness is wrong across all
biomes, route that issue to the shared material/terrain-surface owner rather than duplicating a material
stack inside this module.

## P3 vegetation interaction

Snow review must include at least one forest edge or shrub ecotone. Vegetation must not float, disappear
into the mesh or acquire an unexplained snow stripe because the underlying snow scalar changed.

The snow module does not own vegetation assets. If primitive trees, sparse forest coverage or invalid
placement remain visible, they belong to the active vegetation/biome distribution candidates and must not
be papered over here.

## P4 coast and water interaction

Near a frozen shore, snow and water must preserve the existing canonical shoreline. The snow slice may
alter surface snow retention on land but must not expand a water polygon, move a coast or classify a lake as
sea.

Hard failures include:

- cyan rectangles;
- hard cyan halos crossing land;
- water stripes visible at the same frequency as the snow response;
- snow painted over canonical water pixels.

## P5 atmospheric review

The snow response must survive the full-world orthographic composition without becoming a flat colour
wash. Distant mountains should remain distinguishable through atmospheric perspective.

Check:

- camera-relative sky remains visible;
- fog is continuous rather than a hard horizon line;
- snow colour is not neon cyan;
- high-frequency detail does not alias into moiré at distance;
- the effect remains plausible in both near and far views.

## Geometry-derived invariants

The production response comes from a four-neighbour terrain stencil. This creates several useful review
invariants:

### Vertical datum invariance

Adding the same vertical datum to all four samples must not change wind/snow direction. A change here would
mean the surface layer accidentally depends on absolute world elevation in a way that belongs to the
canonical climate field.

### Crosswind neutrality

A surface facing roughly perpendicular to the prevailing source should be much quieter than a directly
windward or lee face. If every slope receives a similar directional treatment, the scene will read as a
diagonal screen overlay.

### Cliff shedding

As the lee face approaches the authored steep threshold, lee retention falls to zero. This is intentional:
it prevents an unrealistic white wall on near-vertical cliffs.

### Fold sensitivity

A folded ridge and an equally sloped planar face may legitimately receive different snow retention. That
difference is driven by the local second-order stencil and is not a new map layer.

## Asset/placement parity

No new concrete model is introduced by this slice. That is deliberate because the current environment
workspace has active asset/vegetation/material candidates. Before adding any future rock, tree, prop or
structure to this area, use the shared MaterialAssignmentCore and WorldAssetPlacementPipeline contract.

The following remain mandatory for future asset work:

`asset hydrate/load → surface analysis → multi-material recipe → validation → ground transform → manifest → scene attach`

Do not import EditorMaterialStudio into runtime. Do not create a local placement cache that competes with
the shared pipeline.

## CI evidence hierarchy

The evidence order is:

1. exact `origin/main` freshness;
2. source-to-runtime ownership proof;
3. numerical snow and fold contracts;
4. deterministic field and relief sweeps;
5. shipped `createScene()` browser capture;
6. repository-wide Run283/Run167 and platform/performance checks.

A lower-level green result never overrides a higher-level visual failure. A successful numerical sweep does
not justify merging a screenshot with a new P0 artifact.

## Debugging order

When a visual defect is found, debug in this order:

1. Confirm the live head and main SHA are still the values used by the run.
2. Confirm the snow resolver still receives `windward`/`lee` from the terrain biome path.
3. Confirm the climate weights come from the canonical map-aligned cryosphere.
4. Confirm the four-neighbour spacing is positive/normalized.
5. Inspect the fold/shelter/ridge scalar before changing any threshold.
6. Verify the final snow amount and snow tone are bounded.
7. Compare the deterministic screenshot at the same camera/seed/coordinate.
8. Only then consider a threshold adjustment.

Do not start by increasing snow noise. That tends to hide the actual topology problem and creates texture
speckle instead of geology.

## Reviewer decision matrix

| Observation | Decision |
| --- | --- |
| Natural ridge/lee asymmetry with no map-scale striping | accept candidate evidence |
| Slightly stronger snow on a folded lee pocket, cliff shedding intact | accept candidate evidence |
| Snow visible as a diagonal screen-space band | reject; P0 |
| Rectangular snow/water block | reject; P0 |
| Cliff becomes a smooth white wall | reject; P1 |
| Entire north remains a single white slab | reject; investigate P1/P2/source climate adoption |
| Forest still sparse/primitive | route to vegetation owner, do not duplicate asset system here |
| Cyan water rectangles remain | route to water owner; snow PR must not claim solved |
| Black sky appears | reject; P5 |
| Numerical matrix green, browser evidence missing | keep draft |
| Browser evidence green, repository-wide freshness stale | keep draft |

## Post-merge regression expectation

After merge, the same deterministic camera set should be rerun. A production regression is especially likely
to appear as one of these patterns:

- a previously quiet crosswind face becoming striped;
- an LOD transition creating a sudden snow step;
- a streamed chunk showing a different fold response than its neighbour;
- a warm biome receiving northern directional snow;
- a near-cliff retaining snow after a threshold change;
- a distant ridge losing all snow because the response was over-weighted.

The production module should be reverted or corrected rather than masked by changing screenshot exposure.

## Ownership boundary reminder

Buzul Muhafızı owns the environmental response and review. Mountain morphology, vegetation identity,
water geometry, shared material assignment and settlement geometry retain their own owners. The purpose of
this separation is to keep the final world coherent rather than to maximize one agent's line count.
