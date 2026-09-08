# Geographic vegetation runtime and QA

## Runtime purpose

The geographic vegetation adapter is an optional render-quality layer. It must never become the owner of world placement, terrain height, hydrology, road routing, or save state.

The production sequence is therefore intentionally one-way:

`canonical terrain -> existing deterministic scatter -> geographic context -> verified asset -> render replacement`

The reverse direction is forbidden. A failed asset load must not invalidate the original scatter.

## Boot sequence

The 3D scene first creates the canonical terrain sampler and collider-owned ground height. The same height authority is passed to vegetation placement. This ensures a real tree silhouette is grounded on exactly the surface already used by roads, water and gameplay height queries.

The existing vegetation generator creates its procedural instances synchronously. That is important for boot reliability. The optional real-asset adapter is designed to run after that point and can therefore fail, cancel, or finish later without preventing the scene from becoming interactive.

## Desktop policy

Desktop-class rendering is the first target for real GLB replacement. The adapter is bounded by a replacement ratio rather than attempting to replace every instance.

The purpose of this bound is twofold. It creates recognizable authored silhouette islands and prevents a large preview radius from turning into one enormous set of unique high-cost meshes.

The intended replacement target is 18–42% of eligible procedural tree instances. Regional density policy can reduce or increase the effective replacement probability inside that bound.

## Mobile policy

Coarse-pointer/mobile-class devices remain on the existing procedural vegetation plus existing low-poly LOD path. The geographic asset module is explicitly desktop-only in this stage.

Mobile must not pay the memory, parsing, texture and draw-call costs of decorative GLB hydration while the world is still prioritizing terrain, water, interaction and streaming stability.

## Cancellation

Long-running optional hydration is abortable on `pagehide`. The browser leaving the page must not leave promises trying to mutate a detached scene graph.

A future streaming implementation should preserve the same contract by attaching an abort controller to the chunk lifecycle rather than to the entire page.

## Asset validation lifecycle

Each candidate passes through four conceptual stages.

### 1. Source availability
The repository checkout must contain a hydrated binary rather than an LFS pointer. CI performs selective hydration because downloading the complete vegetation library is unnecessary for this pass.

### 2. Model shape
The loaded object must contain renderable meshes, have finite bounds and represent a plausible vertical tree silhouette. Excessively wide or huge sources are rejected.

### 3. Geographic compatibility
The family is only eligible inside regions recorded in `GEOGRAPHIC_VEGETATION_REGION_POLICY`. Permanent-ice and tundra context can override ordinary family selection.

### 4. Instance replacement
The original procedural instance matrix is read and reused. The replacement is normalized to the target visual tree height and written into an instanced mesh.

## Texture policy

The adapter prefers source-authored materials. `sourceVegetationMaterialEvidence()` exists so QA can prove that mapped materials are present rather than merely assuming a GLB is textured.

No generated palette is applied to a source mesh simply because a generic world material system exists. Vegetation is a strong case where the original artist texture is itself the important geographic signal.

A small world-space breakup pass is allowed to avoid identical lighting/colour reads across a large repeated forest. Its amplitude must remain subordinate to the source albedo and normal information.

## Geographic continuity

Hard biome circles look artificial at normal gameplay camera distances. The adapter therefore relies on the same projected map coordinate and zone influence used elsewhere rather than introducing a second hard-coded map extent.

The intended visual transition is gradual:

- dense canopy toward the center of a lush zone;
- smaller mixed stands along the edge;
- deadwood or sparse vegetation entering dry belts;
- cryosphere-dominant silhouettes toward permanent ice.

This means the asset family is a contextual decision, not a binary “inside or outside” texture stamp.

## Road relationship

Roads are not placement targets for vegetation. Existing road exclusions remain authoritative.

The geographic adapter may use road distance as a small probability bias because roadside vegetation can benefit from a more recognizable authored silhouette. It must never reduce road clearance below the underlying placement rule.

## Settlement relationship

Kingdom seats and village clearings already establish strong visual anchors. The vegetation layer stays outside those exclusions and should frame settlements rather than bury them.

This is especially important for the 162–204m settlement-fringe prop layer introduced in the same realism pass: trees, fringe props, functional landmarks and the core castle need enough negative space to remain legible as separate layers.

## Castle / village readability

A visually realistic world is not the same as a maximally cluttered world. The castle should remain a dominant vertical landmark. Village rooflines should be visible. Roads should remain traceable. Vegetation density therefore belongs to the landscape context, not to the “more is always better” bucket.

## Material QA goals

A valid runtime vegetation instance should expose enough metadata for browser tests to answer:

- which source family produced this mesh;
- which canonical biome context selected it;
- whether the source contained mapped material evidence;
- whether the authored texture flag was preserved;
- how many real meshes were hydrated;
- whether procedural fallback stayed visible anywhere.

This turns an artistic concern into measurable evidence without making the game depend on debug-only logic.

## Performance QA goals

The adapter must not silently multiply draw calls for every tree. It groups source primitives by family and source-mesh index into instanced meshes.

Before accepting a new vegetation family, measure its renderable mesh count and source bounds. A single GLB with many tiny decorative meshes can be more expensive than a visually richer but simpler source.

The current policy therefore rejects very high mesh counts before an asset can become a repeated world primitive.

## Failure matrix

| Failure | Required behavior |
|---|---|
| LFS pointer | Reject candidate; keep procedural tree |
| HTTP 404 | Reject candidate; keep procedural tree |
| Corrupt GLB | Reject candidate; keep procedural tree |
| Placeholder returned by loader | Reject candidate; keep procedural tree |
| Empty bounds | Reject candidate |
| Non-finite bounds | Reject candidate |
| Too-wide source | Reject candidate |
| Too-large source | Reject candidate |
| No matching biome family | Do not replace that instance |
| Abort/pagehide | Stop optional work without world failure |
| Browser runtime exception | CI failure; game code still retains procedural source |

## Determinism QA

A geographic asset choice must be reproducible. The family selector uses a stable integer hash rather than `Math.random()`.

Test inputs should include the canonical world seed, a fixed biome kind, fixed cryosphere values, and a deterministic instance index. The same call should return exactly the same family sequence across repeated processes.

This matters because visual regressions can otherwise be masked by a new random forest on each browser invocation.

## Browser proof

The browser proof for this slice should boot the real application scene rather than a fabricated scene consisting only of imported test objects.

A valid proof collects the production vegetation group, waits for optional hydration telemetry to settle, and checks that no placeholder objects exist in the real-asset group.

The proof should also capture one rendered frame and use GPU readback only as a smoke signal. Pixel readback does not prove artistic correctness, but it does detect blank canvases and catastrophic shader compilation failures.

## Relationship with existing winter vegetation

Northern winter vegetation already has a dedicated asset-upgrade path. The geographic adapter must not replace or undermine that owner. In permanent ice, family selection should prefer the existing cold visual language; a later integration can explicitly reconcile the two systems at one ownership boundary.

The first pass therefore keeps the new module separate from the canonical vegetation producer so the existing northern behavior remains stable.

## Why the adapter is intentionally separate

The world currently contains several rounds of terrain and vegetation refinement. A large in-place rewrite would make visual gains harder to attribute and harder to rollback.

A separate adapter makes the proposed visual change testable as a single responsibility: “take an already valid tree instance and, where possible, give it a more geographic real-asset silhouette.”

Once browser proof demonstrates the asset quality and performance envelope, a separate integration change can decide whether the adapter becomes part of the permanent production path.

## Reviewer acceptance

Accept the asset layer only when the following all hold:

- exact-main ancestry is recorded;
- asset files are hydrated and binary;
- source bounds are sane;
- at least one asset carries texture evidence;
- family-to-biome mapping is deterministic;
- no second world placement authority is introduced;
- procedural fallback is intact;
- mobile continues using the existing budgeted representation;
- browser proof can observe the real production scene;
- the PR remains below the requested development-slice size without filler commits.

## Visual target

At gameplay height the eye should immediately understand that vegetation follows geography. Cold north should not look like a green temperate park. Desert and steppe should preserve open ground. Lush belts should have deeper canopy masses. Mountain regions should have more exposed trunks and deadwood. The change should be visible from the camera without relying on a debug overlay to explain what the player is seeing.
