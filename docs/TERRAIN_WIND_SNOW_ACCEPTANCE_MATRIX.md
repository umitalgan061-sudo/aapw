# Terrain Wind / Snow Acceptance Matrix

This matrix describes what the Buzul Muhafızı snow-relief slice is allowed to change and what remains a
hard failure.

## Production inputs

The production function consumes four canonical neighbouring heights and their spacing. It derives
first-order slope/aspect and a second-order fold signal. Climate strength is supplied separately by the
existing map-aligned cryosphere path.

| Input family | Meaning | May change terrain height? |
| --- | --- | --- |
| Four-neighbour heights | canonical local topology | No |
| Spacing | world sampling distance | No |
| Prevailing source vector | explicit wind direction | No |
| Fold signal | broken/saddle relief indicator | No |
| Permanent ice weight | northern snow climate | No |
| Tundra weight | cold transition climate | No |

## Expected output envelope

All response values are normalized unless explicitly documented as a signed direction vector or signed
aspect dot.

| Output | Expected behaviour |
| --- | --- |
| `windward` | grows only with meaningful source-facing slope |
| `lee` | grows only with meaningful sheltered slope and fades on cliffs |
| `ridgelineExposure` | requires folded, source-facing, sufficiently steep relief |
| `shelterPocket` | requires folded, source-opposed, sufficiently steep relief |
| `snowMobility` | bounded slope response, no flat-terrain activation |
| `crustScour` | bounded ridge-scour support term |
| `packGain` | bounded lee-packing support term |
| `windwardScour` | climate-bounded reduction of loose snow |
| `leeDeposit` | climate-bounded increase of loose snow |

## Hard visual failures

A change fails regardless of numerical PASS when the shipped runtime exhibits any of the following:

- a new rectangular snow or water tile;
- a repeated diagonal shader stripe visible across unrelated terrain;
- an exposed-snow pattern that ignores relief and climate;
- a cliff carrying a full powder layer;
- flat plains receiving a mountain-like directional snow mask;
- a second terrain/collider height authority;
- a changed coastline or hydrology classification;
- an asset placement side effect from the snow module;
- a black sky or other unrelated regression revealed by the shipped scene evidence.

## Sampling families

The field-envelope gate uses six relief families: smooth plain, broad ridge, broken ridge, valley,
stepped relief and folded basin. These are stress fields only. They are not canonical geography and are
never consumed by runtime.

The compass sweep covers 72 directions at moderate mountain slope. This exposes the crosswind neutral
sector and makes it difficult for a single prevailing direction to become a world-wide stripe.

The perturbation sweep changes neighbouring heights by small deterministic amounts. This catches
threshold discontinuities that could flash while a camera moves or when a streamed chunk crosses a
vertex boundary.

## Climate matrix

The same exposure fixture is evaluated as permanent ice, tundra, mixed ice, sub-ice and temperate. The
absolute adjustment may rise with cold-climate strength but may not exceed the declared ceiling.

Temperate/southern values are exactly zero for wind-driven snow redistribution. That rule is important:
otherwise an explicit NW prevailing source would become a generic global weather overlay.

## Integration proof

The runtime-parity gate requires:

1. the terrain biome shading module to import `terrainWindSnowExposure.js`;
2. terrain snow coverage to call `resolveTerrainWindSnowAdjustment`;
3. the canonical terrain module to continue exposing its existing height sampler/policy;
4. the snow module to remain render-only;
5. no `Math.random()` or transform mutation inside the snow module;
6. no duplicate material, water, vegetation or world-asset placement authority.

## Browser evidence

The dedicated CI workflow runs the repository's world-environment browser harness at 1536×1024. The
harness uses the real `sceneManager.createScene()` path, not a mocked snow layer. It captures the
full-world orthographic frame and deterministic near-terrain samples, then verifies the terrain texture
adoption, world-space micro-surface setup, sky/starfield camera-relative placement, fog and render
activity.

Snow-specific acceptance is therefore a two-stage decision:

- numerical/source proofs establish that the response is correct and bounded;
- shipped screenshots establish that the actual world still looks natural and no P0–P5 defect has been
  introduced.

Neither stage alone authorizes merge.

## Diff and lifecycle gate

The PR workflow re-fetches `origin/main` at the start and end of the job, verifies the merge base equals
the live main SHA, enforces `git diff --check`, and rejects any scope outside the six declared files.
The additions+deletions total must remain within the repository-wide 3000-line safety ceiling.

The PR stays draft until all required gates are fresh. Auto-merge must remain off while the exact head,
visual evidence and repository-wide CI status are unresolved.

## Relation to other environment owners

This slice is intentionally not a mountain-relief replacement, vegetation distribution replacement,
material assignment replacement, water renderer replacement or settlement placement system. It is the
smallest production layer capable of making the existing northern snow surface read as landform-driven
rather than uniformly painted.
