# Safak Kartali — Fauna Encounter Director R1

This package adds a deterministic, renderer-agnostic encounter policy for existing fauna.

## Ownership

`livingWorldFaunaEncounterDirector.js` is a policy adapter. It consumes caller-owned snapshots and returns bounded directives. It does not instantiate a creature rig, move transforms, invoke physics, choose navigation paths, load assets, spawn actors, or persist world state.

Existing `creatureBrain.js`, `creatureSpawner.js`, actor registries, navigation, physics and asset-placement authorities remain the owners of those concerns.

## Decision model

Each candidate is normalized into bounded threat, player-proximity, habitat-fit, energy, social and recent-threat signals. A deterministic action is selected from `rest`, `graze`, `roam`, `regroup`, `flee`, `investigate`, `return`, and `alert`.

The resulting directive includes a stable urgency score, movement intent, social intent and explicit ownership-preservation evidence.

## Budgets and lifecycle

The director evaluates at most 64 candidate snapshots and returns at most 24 directives. Social signals are capped at 16 members. Runtime state is resettable and disposal-safe.

Every evaluated result receives an FNV-1a digest over stable-key serialization so repeated inputs produce the same replay identity.

## Acceptance corpus

R1 materializes 4,096 distinct cases across 8 species × 8 behaviour scenarios × 8 threat levels × 8 distance bands. The validator recomputes every expected classification through the production policy and then runs a 32-candidate integration replay twice, asserting equal digest/order, result audit validity, limits and disposed-runtime rejection.

The matrix is evidence, not filler: every row covers a unique combination and must remain reproducible from the generator.

## Safety boundaries

This turn does not replace fauna movement or physics, create a second actor registry, introduce model/texture/animation assets, mutate canonical terrain or settlement data, own world-event persistence, or import editor-only runtime systems.
