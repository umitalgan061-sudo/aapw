# Terrain Wind / Snow Surface Contract

## 1. Scope

This document defines the render-only snow redistribution contract implemented by
`src/3d/world/terrainWindSnowExposure.js`.

The contract exists to repair a specific visual debt: northern terrain that is technically on the
correct canonical height field can still read as a smooth white paint layer when loose snow is not
redistributed around exposed shoulders, folded ridge terrain, sheltered lee pockets and steep faces.
The implementation therefore changes the *distribution and visual retention of loose surface snow*
without changing geography.

The contract is intentionally small in authority and large in evidence. It owns no map cell, no
terrain height, no collider, no hydrology classification, no road, no settlement seat, and no concrete
3D asset identity. The owner-map sampler remains the only height authority. The water classifier and
shared asset/placement pipeline remain untouched.

## 2. Why the previous signal was insufficient

The previous wind/snow response already had a deterministic prevailing direction, slope gates,
directional alignment, contour channeling and a four-neighbour fold detector. That prevented obvious
randomness but still left a visual gap between the geometric exposure signal and the amount of visible
snow retained on the surface.

In the old response, the directional weights were passed directly into fixed climate ceilings. A weak
lee signal and a strongly sheltered lee shoulder therefore used almost the same linear treatment. The
result was especially visible at large viewing distances: the north could read as one uniform snow
sheet because local geomorphology barely changed the final snow amount.

The new response adds three bounded surface concepts:

1. **Ridge exposure** — stronger scour is reserved for terrain that is both wind-aligned and visibly
   folded. This keeps ordinary crosswind planes quiet.
2. **Shelter pocket** — a folded lee face retains a little more loose snow than an equivalent planar
   lee slope. The gain is bounded and disappears on near-cliffs.
3. **Snow mobility** — slope controls how strongly surface redistribution can differentiate an exposed
   or sheltered face. It is a small response term, not a displacement field.

These are not new geographic fields. They are scalar responses of the same existing stencil.

## 3. Canonical topology rule

The source stencil is always:

- west height;
- east height;
- north height;
- south height;
- spacing between samples.

The horizontal gradient supplies local slope/aspect. The paired-neighbour sum difference supplies the
fold signal:

`abs((west + east) - (north + south)) / (2 * spacing)`.

A uniform vertical offset added to all four neighbours therefore cannot change the directional
response. This invariant is important because material/snow appearance must never become a hidden
second height authority.

No world-coordinate noise is used by this module. Adjacent vertices derive their response only from
their local canonical geometry. Any broad geographic climate pattern remains the responsibility of the
existing map-aligned cryosphere sampler.

## 4. Prevailing wind

The source vector is normalized and points to the north-west source of the prevailing flow. The
physical interpretation is therefore NW -> SE.

The directional gate deliberately contains a crosswind neutral band. A surface that is almost
perpendicular to the prevailing flow does not become half windward and half lee merely because it is
steep.

For broken mountain relief, a bounded part of the source vector can follow the nearest local contour
direction. The blend is gated by slope and alignment and receives a bounded extra contribution from the
fold detector. The blend cannot replace the source vector with a free-form wind field.

## 5. Ridge exposure

`ridgelineExposure` is the product of four conservative conditions:

- a measured fold response;
- source-facing alignment;
- sufficient slope for windward scour;
- a smooth response ramp rather than a binary threshold.

This means the signal is quiet on:

- flat plains;
- very shallow slopes;
- crosswind faces;
- smooth planar lee faces.

It becomes significant on folded, source-facing mountain shoulders where snow is visually expected to
be thinner and darker because the loose layer is scoured.

The signal does not alter the mesh. It only changes the amount of loose surface snow presented by the
existing shading function.

## 6. Shelter pockets

A shelter pocket is a folded, source-opposed face with enough slope to hold redistributed snow but not
so much slope that gravity immediately sheds it.

The response is intentionally asymmetric. The same fold magnitude on a source-facing ridge does not
produce the same sign as the corresponding sheltered lee face.

This asymmetry is the mechanism that breaks up a uniform white mountain surface into visibly different
bands of retained and scoured snow while keeping the canonical mountain silhouette unchanged.

## 7. Snow mobility

Snow mobility rises smoothly from shallow to moderate mountain slopes. It is deliberately capped.

It is used as a small response-shape term rather than a large multiplier, because an unconstrained
mobility factor would amplify the exact failure this slice is meant to avoid: giant artificial snow
bands that read like a texture decal.

The mobility response therefore obeys three rules:

- monotonic rise through the authored slope interval;
- normalized output;
- no independent contribution when the terrain is flat and directional weights are zero.

## 8. Climate ceiling

Climate still controls the absolute magnitude of the response.

Permanent ice receives the stronger ceiling. Tundra receives the restrained ceiling. Temperate/southern
terrain receives zero directional snow redistribution from this module.

The resolver never bypasses the canonical snow supply. The largest possible windward scour remains
inside `northWindwardScourMax` and `tundraWindwardScourMax`. The largest possible lee gain remains
inside `northLeeDepositMax` and `tundraLeeDepositMax`.

This keeps the effect suitable for a full-world orthographic camera as well as a terrain-level view.

## 9. Existing renderer compatibility

The live terrain biome renderer already calls `resolveTerrainWindSnowAdjustment` from its snow coverage
resolver. That renderer currently passes the established `windward` and `lee` values rather than the
new richer response object.

To avoid touching another production owner's file while the terrain/vegetation branches are active,
this slice projects the richer values back onto those existing arguments:

- a strong `windward` value supplies a bounded minimum ridge-exposure proxy;
- a strong `lee` value supplies a bounded minimum shelter-pocket proxy;
- directional weight supplies a bounded mobility proxy.

Direct callers can still provide the richer fields explicitly. This preserves one production path and
makes the change visible in the already-shipped renderer without a second integration layer.

## 10. Visual intent

The expected visual effect is subtle at low altitude and obvious only where the northern terrain already
has suitable relief.

A successful result should read as:

- windward ridges: slightly thinner, cooler or more exposed surfaces;
- lee shoulders: fuller retained snow;
- folded terrain: non-uniform snow cover that follows landform;
- steep faces: less artificial powder accumulation;
- shallow terrain: almost no directional striping.

A successful result must *not* read as:

- a new snow texture tile;
- a world-wide diagonal overlay;
- a repeated shader stripe;
- a new ridge or valley;
- a changed coastline;
- a changed collider.

## 11. Deterministic acceptance

`scripts/checkTerrainWindSnowExposure.mjs` remains the targeted regression gate. It validates the
public contract already used by the repository: flat neutrality, reversed aspect, crosswind neutrality,
cliff shedding, climate strength ordering, and propagation into the authoritative terrain snow resolver.

`scripts/checkTerrainWindSnowOrographicFold.mjs` validates the second-order fold path. It proves that two
fixtures with the same first derivative can differ in effective wind response when their neighbour-pair
sums describe broken relief.

`scripts/checkTerrainWindSnowFieldMatrix.mjs` expands those targeted checks into a deterministic field
matrix. It covers multiple slopes, aspects, fold strengths, climate bands, spacing signs, vertical
height offsets, perturbations, and large-value bounds. It also emits a stable SHA-256 digest of the
sample matrix for CI comparison and post-merge regression isolation.

## 12. Shipped runtime evidence

The dedicated workflow also executes the repository's existing `scripts/checkWorldEnvironmentAcceptanceMatrix.mjs`.
That harness uses the real `sceneManager.createScene()` path at 1536×1024 and captures full-world and
near-terrain PNG evidence. It checks the actual terrain meshes, map-aligned authored terrain albedo,
world-space micro-surface adoption, camera-relative sky/starfield positioning, atmospheric fog and
render activity.

The snow slice does not claim a visual PASS from mathematical tests alone. A final merge decision still
requires the generated shipped images and the repository's broader Run167/Run283, freshness,
determinism, Terrain3D/HTerrain, PWA/mobile and performance gates to be green.

## 13. Ownership boundaries

The following remain external authorities:

| Concern | Authority |
| --- | --- |
| Terrain height | `src/3d/world/terrain.js` canonical owner-map chain |
| Hydrology | canonical reference hydrology/map chain |
| Biome/classification | `terrainBiomeShading.js` and map-aligned climate inputs |
| Material assignment | `MaterialAssignmentCore.js` |
| World asset placement | `WorldAssetPlacementPipeline.js` |
| Vegetation identity/distribution | vegetation and biome-distribution owners |
| Mountain morphology | mountain-relief candidates |
| Water geometry/appearance | water owner chain |
| Sky/fog/light | scene sky/fog/lighting owners |

This slice intentionally changes none of those authorities.

## 14. Review checklist

Before READY:

- exact `origin/main` must still match the PR merge base;
- the entire diff must remain <=3000 additions+deletions;
- only the declared snow-relief files may change;
- syntax checks must be green;
- directional snow and fold suites must be green;
- the deterministic matrix must be green with a stable digest;
- shipped `createScene()` evidence must exist and be free of browser errors;
- full-world and near-terrain output must be inspected for P0–P5 regressions;
- no auto-merge may be enabled while candidate freshness/visual evidence is unresolved;
- repository-wide required gates remain mandatory.

Before merge, the maintainer must re-read the live head and live main SHA. A historical head or mergeable
flag is not authority after any competing merge.

## 15. Future extension rule

If the terrain renderer later accepts the complete exposure object directly, remove only the compatibility
projection from `resolveTerrainWindSnowAdjustment`; do not create a second snow system. The public policy
fields and deterministic matrix should remain stable so screenshots before and after can be compared on
the same camera, seed and coordinate fixtures.
