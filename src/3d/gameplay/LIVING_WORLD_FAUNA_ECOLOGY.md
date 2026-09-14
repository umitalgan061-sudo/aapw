# Living World Fauna Ecology Runtime

## Scope

`livingWorldFaunaEcologyRuntime.js` extends the existing Living World fauna adapter with deterministic ecology decisions. It is not a replacement for `ActorRegistry`, navigation, combat, factions, reputation, diplomacy, law, settlement, world events, scene attachment, or material placement.

The runtime consumes caller-owned observations and produces bounded plans. Side effects occur only through injected owner functions.

## Ownership

| Capability | Authoritative owner |
|---|---|
| Actor identity and lifetime | existing ActorRegistry / caller |
| Navigation and route execution | existing navigation owner |
| Combat damage and hit resolution | existing combat owner |
| World event publication | existing WorldEventSystem |
| Faction/reputation/diplomacy | existing faction/reputation/diplomacy owners |
| Law/crime/wanted | existing law owner |
| Material assignment | `MaterialAssignmentCore.js` |
| Grounded world placement | `WorldAssetPlacementPipeline.js` |
| Editor material UI | `EditorMaterialStudio.js` only; runtime import forbidden |

## Runtime flow

1. Normalize clock, habitat, population, threat and actor observations.
2. Resolve species habitat eligibility from biome, slope, water, ground and navigation signals.
3. Resolve schedule from day phase plus season and weather.
4. Calculate bounded carrying capacity and population pressure.
5. Produce deterministic spawn candidates using world seed + habitat + species + ecology tick.
6. Emit movement targets for roam/flee/stalk without taking navigation ownership.
7. Emit bounded events such as graze, drink, travel, hunt and roost.
8. Group existing actors into deterministic formations.
9. Apply distance-based behavior LOD and tick throttling.
10. Despawn only when caller-owned actors are dead, inactive, or safely outside the world-interest radius.
11. Produce command intents; injected services remain responsible for execution.
12. Model-bearing callers must complete hydrate/load → mesh/material analysis → named/layered recipe → `validateMaterialAssignment` → ground/nav/habitat alignment → placement manifest → scene attach.

## LOD policy

| Range | Level | Tick interval | Behavior mode |
|---|---|---:|---|
| 0–180m | near | 0s | full |
| 180–650m | distant | 0.75s | reduced |
| 650–1500m | far | 2s | aggregate |
| 1500m+ | culled | 10s | proxy |

The thresholds are intentionally bounded for mobile/PWA safety. The runtime never creates hundreds of fully ticking clones just because a habitat contains a large population estimate.

## Species ecology

### Deer
Forest, meadow, hills and taiga. Grazer. Larger groups. Active at dawn/day/dusk with rest at night. Avoids wolves, dragons, guards and player threats.

### Wolf
Forest, taiga and hills. Predator. Pack size 2–5. Stronger night/dawn/dusk activity. Can stalk deer and flees from dragons, guards and players.

### Horse
Meadow, roadside and settlement-edge habitat. Grazer. Small groups. Day/dawn/dusk activity. Avoids wolves and dragons while remaining compatible with settlement-edge ambience.

### Dragon
Mountain, volcanic and ruins habitat. Apex species. Always solitary in the default profile. Can hunt horse/deer/wolf and flees from player/guard pressure.

## Placement contract

Every spawn directive carries both shared owner identifiers and a required sequence manifest. A runtime consumer must not attach a model directly from a fauna decision.

The shared pipeline remains the sole authority for:

- real asset/LFS hydration and load verification;
- mesh/material-slot analysis;
- named-part figure kit or suitable multi-surface recipe;
- layered fallback for one-mesh/one-material assets;
- `validateMaterialAssignment` failure gating;
- ground/navigation alignment;
- placement manifest creation;
- scene attachment.

The ecology runtime deliberately contains no Three.js import and no editor UI import. It only communicates the required shared contract.

## Determinism

All ordering is normalized by stable IDs. Random-looking decisions derive from the supplied world seed, day/tick, habitat ID and species ID. Replay output is fingerprinted from canonical serialized data. Reordering input arrays must not alter output.

## Safety limits

The runtime caps candidate, habitat, population, threat, event, group-member and command counts. It also bounds command TTL and history size. Malformed finite inputs fail closed into safe defaults rather than propagating `NaN`/`Infinity` into navigation or placement consumers.

## Acceptance matrix

| Area | Required evidence |
|---|---|
| Habitat grounding | valid position + ground + water + navigation + biome |
| Schedule | dawn/day/dusk/night transitions |
| Population | capacity and target remain bounded |
| Spawn | no ocean/cliff invalid placement; cooldown respected |
| Threat | stale memory ignored; visible/heard threats can trigger response |
| Behavior | roam/flee/stalk states are deterministic |
| Group AI | stable formation and leader selection |
| LOD | near/distant/far/culled intervals enforced |
| Cleanup | dead/out-of-interest actors produce bounded despawn directives |
| Commands | deterministic priority and TTL |
| Assets | shared material + placement contract required |
| Runtime boundary | no editor/DOM/duplicate framework import |
| Replay | same seed/input yields same fingerprint |
| Budget | additions+deletions remain <=3000 for this PR |

## Runtime scenarios

The acceptance scripts cover forest deer daytime grazing, forest deer nighttime rest, taiga wolf nocturnal activity, meadow horse daytime ambience, mountain dragon daytime activity, volcanic dragon dusk pressure, ruins dragon night rest, stale threats, audible threats, close predator pressure, grouped movement, out-of-interest cleanup, malformed numeric inputs, deterministic input reordering and bounded large populations.

## Integration notes

The output is designed to be consumed by existing Living World owners. `applyFaunaEcologyTick()` dispatches command/update/spawn/despawn intent only when caller services are supplied. It catches individual owner failures so one faulty downstream command does not abort the whole tick.

The runtime is intentionally additive and adapter-shaped so future NPC perception, faction reactions, crime/wanted semantics, companion behavior and world-event reactions can consume the same observations without creating a second framework.
