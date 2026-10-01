# Living World Fauna Ecology Runtime

`livingWorldFaunaEcologyRuntime.js` is an additive deterministic adapter over the existing Living World owners. It does not replace ActorRegistry, navigation, combat, factions, reputation, diplomacy, law, settlements, world events, scene attachment, or material placement.

## Owner boundary

| Capability | Owner |
|---|---|
| Actor identity/lifetime | existing ActorRegistry |
| Route execution | existing navigation |
| Damage/hit resolution | existing combat owner |
| World events | existing WorldEventSystem |
| Faction/reputation/diplomacy/law | existing owners |
| Material assignment | `MaterialAssignmentCore.js` |
| World placement | `WorldAssetPlacementPipeline.js` |
| Editor material UI | `EditorMaterialStudio.js` only; runtime forbidden |

## Tick flow

1. Normalize clock, habitats, population, candidates and threats.
2. Reject invalid ocean/cliff, missing-ground, unreachable-nav, excessive-slope and occupied habitat candidates.
3. Resolve dawn/day/dusk/night schedules plus season/weather modifiers.
4. Calculate deterministic carrying capacity and population pressure.
5. Produce bounded spawn directives and movement intent from seed + tick + habitat + species.
6. React to visible/heard threats with roam/flee/stalk and deterministic group formations.
7. Emit ecology events (graze/drink/travel/hunt/roost) without owning their execution.
8. Apply distance LOD and tick throttling; cull only after a grace period or death/inactivity.
9. Route side effects only through injected owner callbacks.

## Species

- **Deer:** forest/meadow/hills/taiga grazer; active dawn/day/dusk; avoids wolf/dragon/guard/player.
- **Wolf:** forest/taiga/hills predator; pack 2–5; stronger at night/dawn/dusk; can stalk deer; avoids dragon/guard/player.
- **Horse:** meadow/roadside/settlement-edge grazer; small groups; day/dawn/dusk; avoids wolves/dragons.
- **Dragon:** mountain/volcanic/ruins apex species; solitary by default; can hunt deer/horse/wolf; avoids player/guard.

## LOD and budgets

| Range | Mode | Interval |
|---|---|---:|
| ≤180m | near/full | 0s |
| ≤650m | distant/reduced | 0.75s |
| ≤1500m | far/aggregate | 2s |
| >1500m | culled/proxy | 10s |

Runtime caps habitats, candidates, threats, events, groups and commands so population size cannot turn into hundreds of full AI ticks on mobile/PWA.

## Placement contract

A model-bearing consumer must perform: real asset/LFS hydrate/load → mesh/material-slot analysis → named-part or layered recipe → `validateMaterialAssignment` → ground/nav/habitat alignment → placement manifest → scene attach. Single-surface fallback is allowed; primitive placeholder substitution is not. `MaterialAssignmentCore` and `WorldAssetPlacementPipeline` remain the shared runtime authority.

## Determinism

Inputs are stably ordered by IDs. Random-looking decisions derive from the supplied seed and world tick. Replay fingerprints and input-reordering checks ensure equal inputs produce equal outputs.

## Acceptance

The focused scripts cover schedules, habitat safety, perception/threat reactions, group movement, LOD, despawn, custom species, placement contracts, bounded stress loads, malformed finite values, deterministic replay and injected-owner failure isolation. The CI gate also rejects editor/DOM/Three.js runtime imports and enforces the PR line budget.
