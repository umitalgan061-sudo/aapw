# Kızıl Ufuk — Player World Coverage Director

## Purpose

`playerWorldCoverageDirector.js` is a composition layer over the shipped player/combat stack. It turns
world observations into bounded movement, animation, combat, camera, equipment and interaction context.
It does not become a second player controller. `src/3d/gameplay/player.js` remains the stateful owner of
movement, health/stamina/poise, dodge, guard and attack timing.

The world is represented as a deterministic 36 × 28 lattice over 9,000 × 7,000 metres with 250 metre
cells. The lattice is an evidence surface, not a geography generator: an empty cell is a reported gap,
never a fabricated biome, road, water body or settlement.

## World-to-player chain

```text
canonical terrain / water / slope sample
          ↓
playerWorldCoverageDirector
          ↓
surface + biome + grounding context
          ↓
movement / locomotion / foot-plant / terrain lean
          ↓
combat reach / lock-on / dodge / guard / parry / ranged stability
          ↓
equipment wetness / cold / socket readiness
          ↓
camera / interaction presentation
```

The chain is read-only with respect to world ownership. Terrain height, water, slope and ground collider
remain supplied by Buzul Muhafızı-owned APIs. NPC target state is supplied by Şafak Kartalı-owned services.
RPG and settlement semantics are supplied by Günbatımı Ustası-owned services.

## Full-world coverage

`buildCoverageLattice()` always emits all 1,008 canonical cells. `observedCellCount`, `readyCellCount`,
`gapCellCount` and `waterBlockedCellCount` distinguish evidence quality from world assumptions. A player
context carries both the exact player cell and a bounded nearby-cell review list for browser/PWA proof.

Surface adaptation covers grass, soil, mud, sand, rock, scree, snow, wet edge, road, settlement and water.
Biome input remains an observation; adaptation never invents missing geography.

## Player realism

Grounding compares render/visual ground, collider ground and canonical ground. A correction recommendation
is produced only when a caller has finite values within the acceptance tolerance. The player model is not
moved by this module. The runtime adapter can apply only presentation metadata to a caller-owned object.

Locomotion is shaped by traction, slope, snow/mud/scree and equipment encumbrance. Animation presentation
exposes idle/walk/run/sprint blending, terrain lean, foot-plant weight, additive surface motion and combat
layer weights. Attack recovery, dodge range and ranged aim stability remain bounded modifiers; they do not
replace player.js timing or damage resolution.

## Equipment and shared material placement

The player coverage layer records the only accepted model-bearing runtime authorities:

- `src/3d/materials/MaterialAssignmentCore.js`
- `src/3d/world/WorldAssetPlacementPipeline.js`

`EditorMaterialStudio.js` is intentionally forbidden from runtime modules. LFS pointer state is represented
as `pointer`, not `missing`; `missing` is reserved for observed loader failure. The asset evidence contract
expects source asset → shared material core → validation → placement pipeline → ground snap → scene attach.
Existing authored materials may be preserved and layered fallback remains available for single-surface meshes.

## Replay and determinism

`playerWorldCoverageReplayContract.js` records normalized player/equipment/combat/world observations with
bounded frame and observation counts. A replay produces per-frame fingerprints. Two replays of the same
recording must have identical fingerprints. This is the deterministic proof surface for later browser and
PWA captures.

## Combat target context

`playerWorldCoverageThreatAdapter.js` ranks only caller-supplied visible targets. Hostility, line of sight,
range, angle, threat and elevation influence a stable score. The adapter never owns NPC state and never
applies combat damage. The selected target is a presentation/lock-on hint consumed by the existing combat
architecture.

## Scenario matrix

The scenario matrix covers settlement gate, forest road, coast wet edge, wetland crossing, mountain climb,
alpine snow, steep scree, steppe run, deep water and snowy road. Each scenario uses explicit observations,
never synthetic geometry, and runs through the same context and acceptance path.

## Performance policy

The runtime adapter uses bounded sample batches, bounded nearby-cell review, bounded focus targets and a
publish rate limit. Mobile budgets are stricter than desktop budgets. No per-frame world scan is created by
the coverage layer.

## Acceptance commands

The focused regression is `scripts/checkPlayerWorldCoverageDirector.mjs` and the scenario regression is
`scripts/checkPlayerWorldCoverageScenarioMatrix.mjs`. The workflow
`.github/workflows/player-world-coverage-director.yml` runs syntax, shared-material boundary, deterministic
twice-run and changed-line budget checks on the exact PR head.

This layer intentionally ships without new binary model data. Existing repository LFS-backed character
and animation sources remain authoritative and are not overwritten.
