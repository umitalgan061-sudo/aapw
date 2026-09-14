# Geographic Visual Acceptance — Living World

## 1. Acceptance principle

A living-world asset is visually accepted only when model identity, material identity, geographic identity and physical placement agree.

The acceptance chain is:

`canonical reference map → world alignment → biome/habitat → real asset → material surfaces → ground/water/slope → bounded visibility`

A test that proves only that a file exists is insufficient.

## 2. Geographic identity

Every ambient record carries the canonical biome kind and biome id returned by the existing world-reference map. No second biome classifier is allowed.

At map-zone centers, the same source zone must resolve back to its authored biome kind. This catches axis inversion and map-to-world offset errors that otherwise appear as plausible but wrong scenery.

## 3. Model identity

The source path must remain inside the tracked asset family. The director rejects an unavailable or placeholder result instead of silently inserting a primitive.

Expected human sources in the first visual slice:

- `assets/models/characters/peasant_girl.fbx`
- `assets/models/characters/paladin_j_nordstrom.fbx`
- `assets/models/characters/erika_archer.fbx`

Expected real fauna sources already known to the shared catalog include horse, wolf and dragon assets documented by the habitat contract.

## 4. Material identity

The model must retain high-quality authored maps when they exist. Validation must report whether the final path is authored-material preservation or generated layered fallback.

A flat red person, flat brown horse, flat grey wolf or flat single-color dragon is not acceptable simply because the mesh renders.

Material proof must include:

- mesh count;
- material surface count;
- generated-material count;
- validation errors/warnings;
- texture map dimensions;
- geographic palette/profile;
- source-material mode.

## 5. Ground relationship

Ground Y is sampled from the canonical collider, not an arbitrary world constant. Finite-difference samples provide a local slope estimate before acceptance.

A character that floats or sinks is a placement failure even when its XYZ values are numerically finite.

## 6. Water relationship

The water surface is a hard exclusion for human ambient placement. Near-coast candidates are still allowed when they remain above water and within settlement/road policy.

This prevents common visual failures such as farmers standing on sea pixels or guards walking through shallow submerged geometry.

## 7. Road relationship

Ambient humans should look like people using a settlement region, not decals printed on the road ribbon. A minimum side-of-road buffer is mandatory.

The director consumes road edges from the existing road system and never reconstructs route geometry.

## 8. Settlement relationship

Settlement cores should remain readable. Human ambient candidates are sampled around the seat at a deterministic distance ring and reject candidates too close to or too far from the seat.

This also protects castle entrances, gates, walls and quest interaction spaces from random crowding.

## 9. Biome relationship

The initial visual family mapping is intentionally conservative:

| Biome | Main human visual family | Habitat note |
|---|---|---|
| snow | knight | cold/protected visual identity |
| cold-grassland | knight/peasant | northern pasture transition |
| marsh | peasant | wet lowland, light worker presence |
| mountain | knight | high relief / guard presence |
| rocky-hills | knight/ranger | stone scrub / frontier |
| lush-grassland | peasant/ranger | fertile plains |
| temperate-coast | mixed human | salt-wind settlement edge |
| desert | ranger | arid frontier |
| arid | ranger | dry waste |
| steppe | ranger | open travel corridor |
| jungle | peasant/ranger | humid settlement/frontier |

This mapping is a visual profile, not an AI faction or occupation framework.

## 10. Fauna relationship

Horse belongs near pasture and settlement edges, wolf belongs in natural edge habitat away from settlement cores, and dragon belongs to high-relief aerial habitat.

These are candidate habitat constraints only. Existing animal/creature/dragon controllers retain movement, combat and ecology behavior ownership.

## 11. Determinism

Placement uses stable seed + settlement identity + candidate index. A repeat with identical seed and inputs must produce identical placement JSON.

The browser proof should run at least two planner passes for the same seed and compare their serialized placement records.

## 12. Performance

The ambient human layer is deliberately bounded. Desktop is capped at 12 visual instances and mobile at 5. Visibility uses 700m show and 920m hide hysteresis with a 0.20s update cadence.

This is not a license to tick hundreds of NPC state machines. The existing actor and fauna systems remain the owners of behavioral simulation.

## 13. Runtime proof

The final evidence should come from a real Chromium session using the existing `createScene()` world state and the real asset loader. The proof should record actual loaded source models, material audits and placement records.

A synthetic fixture is useful for testing the material core but cannot substitute for the hydrated binary asset proof.

## 14. LFS proof

CI must selectively hydrate only the source families required for the check. It must then reject any remaining pointer stub. A small Git LFS pointer file is not an acceptable “loaded model”.

## 15. Console/page errors

The acceptance browser session must record page errors, console errors and HTTP responses >=400. A model proof that succeeds while silently producing failed subresource requests is incomplete.

## 16. Offline shell

The current service worker and its owner remain authoritative. This work does not rewrite the service worker. Any future runtime integration must respect the existing shell graph and avoid a large unrelated service-worker diff.

## 17. Ownership

No change in this family is allowed to duplicate the existing production implementation of:

- NPC state/behavior;
- animal behavior;
- creature brain;
- dragon combat;
- vegetation distribution;
- natural geology placement;
- water/road construction;
- settlement construction;
- service worker ownership.

The geographic asset layer is a consumer/adapter, not an alternative world framework.

## 18. Definition of done

A future merge of the runtime integration requires all of the following to be green on the exact head:

1. exact current-main ancestry and bounded PR scope;
2. real binary asset hydration proof;
3. geographic mapping determinism;
4. material surface validation;
5. shared MaterialAssignmentCore and WorldAssetPlacementPipeline contract;
6. browser proof in the actual Three.js world;
7. zero new console/page errors;
8. visible population under the mobile/desktop budget;
9. LOD hysteresis behavior;
10. existing Run283, determinism and freshness gates.

Anything less is a partial implementation, not a merge-ready visual slice.
