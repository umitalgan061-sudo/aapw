# ADR-0292 — Owner-map aligned mountains in the live height sampler

- Date: 2026-08-14
- Status: Proposed in a draft pull request
- Risk: HIGH

## Context

The shipped Three.js terrain height field combines 0–24 m seeded FBM with three legacy hand-placed
domes, only one of which reaches 150 m. The current G10 proof confirms why the user's map view reads
flat: its production relief is approximately -2.5–26.8 m, while the apparent full-world height in
the proof is largely a capture-only 4x exaggeration. That is not equivalent to mountains in the
live game.

The owner map already has three reusable source contracts:

- fixed map checksum `20702972...`;
- four audited connected relief chains;
- a 96x64 source-derived surface mask that distinguishes sea/lake from dry land.

The live game also already has one height-sampler boundary. Rendered chunks, ground collision,
bathymetry, rivers, roads, vegetation and settlements all reach terrain through
`createHeightSampler`. A second visual-only displacement source would immediately break that
parity.

## Decision

Add `worldReferenceMountainRelief.js` and consume it exactly once inside
`terrain.js#createHeightSampler`.

The module:

1. Projects live world X/Z into the exact 9000x7000 owner-map alignment.
2. Computes aspect-correct distance to the four canonical relief polylines.
3. Builds connected ridge shoulders with deterministic, seeded summit variation.
4. Bilinearly gates the result with the immutable surface mask, making the mountain contribution
   exactly zero on sea/lake-owned samples.
5. Uses authored low mountain passes where the shipped western kingdom roads cross the Vale and Red
   chains. This preserves mountains around the route instead of flattening the whole range.
6. Returns real meters, with approximately 245 m Vale, 265 m Red, 545 m Bone and 379 m eastern
   sampled peaks. The full reference-grid peak is approximately 542 m.
7. Returns zero outside the canonical map canvas, preserving the previous unbounded sampler's safe
   behavior beyond the intended world.

The existing legacy domes remain in this first integration for compatibility. They are now a
secondary layer; the owner-map chains provide the missing continent-scale relief.

## Alternatives considered

- Keep using capture-only vertical exaggeration. Rejected because screenshots would look taller
  while gameplay geometry, collision, hydrology and roads remained flat.
- Displace only the material/shader. Rejected because shadows could change but physics, water depth,
  vegetation and routes would still disagree with the visible surface.
- Import `map.png` as a raw grayscale heightmap. Rejected because color brightness is not
  elevation: sea labels, forests, roads, text and coast shading would become false hills.
- Raise every point on each polyline uniformly. Rejected because it creates impassable walls rather
  than ranges with traversable passes.
- Maintain a second Terrain3D-only height source. Rejected because the shipped runtime is Three.js
  and the one-sampler parity contract already exists.

## Consequences

The player will see real relief wherever live chunks intersect the mapped chains. The same heights
are automatically used by collision, water-depth baking, river descent, roads, vegetation and
settlements. No new draw calls, textures or assets are added; the extra cost is CPU sampling during
chunk generation. A 500,000-sample local benchmark completed in about 73 ms after the bounding-box
fast path was added.

Western approach passes are now part of the deterministic policy and checksum. Moving a pass or
changing a peak intentionally changes the fixture and requires the seat/road safety gates.

## Verification boundary

The deterministic contract fixes a 257x193, one-centimeter-quantized checksum and asserts:

- all four source chains have continuous positive dry-land centerline relief;
- the Bone chain exceeds 500 m and the full reference exceeds 500 m;
- mountain contribution over sea/lake ownership is exactly 0 m;
- normalized-reference and live-world projection samples are identical;
- the live terrain imports and consumes the module exactly once;
- the service worker precaches the new live import.

Local module-level verification passed. A direct run of the real settlement/road modules over the
new shared sampler produced 14 safe seats and all 13 MST road edges below the 20° hard limit
(measured maximum about 14.23°). The pull-request workflow remains the authoritative browser gate:
it runs the existing terrain-seat, road-network and full game smoke suites with Chromium.

## Rollback

Revert the pull-request commit. Removing the single sampler addition restores byte-for-byte legacy
height behavior; the new module, fixture, workflow and service-worker entry then become unreferenced
and are removed in the same revert. No save migration or asset cleanup is required.

## Future-phase impact

Hydrology, biome materials, forests, settlement placement and orthographic proof captures must keep
reading the shared live sampler. Future map refinements may add erosion and more audited relief
anchors, but must not create an independent visual height field. A fresh real 90° full-world
orthographic artifact is required after this branch is rebased with the existing 3D proof branch.
