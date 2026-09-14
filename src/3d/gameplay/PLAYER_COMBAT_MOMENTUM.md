# Player Combat Momentum Contract

## Purpose

`playerCombatMomentumDirector.js` adds a bounded combat-rhythm layer on top of the existing player event stream. It is a **consumer**, not the owner of player combat state.

The production player remains responsible for movement, health, stamina, poise, dodge, guard, parry, attack timing, collision and damage. The momentum director observes those results and makes a deterministic presentation/gameplay signal available to downstream consumers.

The intended gameplay use is a readable escalation loop:

`defend cleanly → land attacks → preserve rhythm → build momentum → earn finisher readiness → spend readiness`

No damage is invented by this layer. A finisher is a readiness signal for a future gameplay consumer; consuming readiness is explicit through `consumeFinisher()`.

## Existing event inputs

### `aapw:player-motion`

The director reads:

- `state`
- `isGrounded`
- `speedMps`
- `staminaRatio`
- `poiseRatio`

These fields influence presentation context only. Movement is never mutated.

### `aapw:player-attack-window`

The director reads:

- `serial`
- `kind`
- `phase`
- `active`
- `comboStep`
- `reachMeters`
- `damageScale`

Only the terminal `finish` phase is eligible to create an offensive momentum sample. Windup and active transitions do not double-count an attack.

### `aapw:player-combat-feedback`

The director recognizes the existing defensive/offensive outcome vocabulary:

- `light-hit`
- `heavy-hit`
- `guard`
- `parry`
- `dodge`
- `hit`
- `guard-break`
- `hit-stagger`

Successful outcomes raise momentum. Failure outcomes reduce it and break a success streak.

### `aapw:player-equipment-combat-frame`

When this stream exists, `attack.damageScale` and `movement.movementMultiplier` contribute small bounded influence terms. The purpose is to make the same combat rhythm feel coherent across equipment profiles without owning inventory semantics.

## Output event

The director publishes:

`aapw:player-combat-momentum`

The payload is immutable and includes:

- version
- score
- scoreRatio
- rank
- successStreak
- defenseStreak
- failureStreak
- bestSuccessStreak
- totalSuccesses
- totalDefenses
- totalFailures
- totalActions
- rhythmQuality
- lastOutcome
- lastActionKind
- equipmentScale
- finisherReady
- finisherWindowRemaining
- finisherCooldownRemaining
- finisherGeneration
- reason
- sequence
- timestamp

Downstream UI/VFX/tutorial systems should treat this as a **hint stream** and must not write back into player state.

## Rank thresholds

The score is clamped to `[0, 100]`.

| Rank | Lower bound |
| --- | ---: |
| neutral | 0 |
| focused | 25 |
| surging | 55 |
| finisher-ready | 78 |

The thresholds are constants so regression suites can assert exact behavior.

## Momentum scoring

Base successful-action bonuses are intentionally modest:

| Outcome | Base bonus |
| --- | ---: |
| light-hit | +7 |
| heavy-hit | +11 |
| guard | +5 |
| parry | +16 |
| dodge | +9 |

Combo steps add a bounded bonus. Rhythm quality adds a proportional reward. Parry receives an extra clean-timing reward when the previous combat event is inside the intended rhythm window.

Failure penalties are:

| Outcome | Base penalty |
| --- | ---: |
| hit | −8 |
| guard-break | −10 |
| hit-stagger | −11 |

All values are fed through finite/limit checks before entering state.

## Rhythm model

Rhythm is not a wall-clock score. It is calculated from published combat event timestamps.

The preferred interval is `0.9 s`. Intervals shorter than `0.12 s` or longer than `3.25 s` are treated as non-rhythmic. The quality curve is bounded to `[0, 1]`.

A consumer can therefore reproduce the same score from the same event tape in a headless regression test without a browser clock.

## Finisher readiness

A finisher can become armed only when all three conditions hold:

1. score is at least `78`;
2. success streak is at least `3`;
3. defense streak is at least `1`.

When armed, the window lasts `0.55 s`. A failure outcome cancels the window and starts the configured cooldown. A consumer can explicitly spend the readiness with `consumeFinisher(timestamp)`.

The director does **not** choose a target, spawn a weapon effect, apply damage, teleport the player, or trigger an animation itself. Those are owned by their respective gameplay systems.

## Equipment influence

The normalized equipment envelope contains:

- raw bounded damage scale;
- raw bounded movement multiplier;
- a small damage influence term;
- a small speed influence term.

The final multiplier is clamped before scoring. This prevents an invalid equipment provider from turning the momentum meter into an unbounded value.

## Lifecycle

A normal mounted runtime follows:

```text
createPlayer()
    ↓
player.js publishes motion / attack / feedback
    ↓
createPlayerCombatMomentumDirector()
    ↓
read + derive + publish immutable momentum snapshots
    ↓
HUD / VFX / tutorial / future finisher consumer
    ↓
consumeFinisher() only when the consuming system has actually executed its finisher
    ↓
dispose()
```

`dispose()` removes all listeners and clears the bounded evidence history. It is safe to call once; repeated calls are no-ops.

## Ownership boundary

This module deliberately does **not** import:

- `EditorMaterialStudio.js`
- Three.js
- `OrbitControls`
- FBX/GLB loaders
- terrain/environment modules
- NPC AI modules
- inventory/quest/settlement semantics

The shared Material/Placement contract remains the authority for actual model/material placement elsewhere. This director has no new model-bearing asset, so no asset hydration or placement manifest is required for this slice.

## Determinism contract

`playerCombatMomentumReplay.js` converts normalized outcome samples into a bounded replay tape. A tape has:

- a fixed maximum event count;
- monotonic timestamp normalization;
- normalized outcome/kind strings;
- bounded combo and serial fields;
- a deterministic FNV-style digest.

A replay result exposes:

- final score;
- rank;
- canonical snapshot;
- published history;
- digest;
- tape key.

Identical tapes must compare equal. Meaningfully changed event order or combo timing must remain observable to the comparison contract.

## Regression expectations

The focused checks cover:

- rank thresholds;
- rhythm boundaries;
- positive and negative outcome signs;
- equipment normalization;
- motion normalization;
- attack-finish single counting;
- failure cancellation;
- finisher prerequisites;
- finisher consumption and cooldown;
- bounded history;
- immutable snapshots;
- consumer/provider exception isolation;
- deterministic replay;
- changed-event replay mismatch;
- scenario-catalog uniqueness;
- runtime/editor boundary scanning.

## Future finisher consumer guidance

A future finisher executor should subscribe to `aapw:player-combat-momentum`, select a compatible existing combat target supplied by the owning targeting system, verify its own hit/animation/equipment prerequisites, and call `consumeFinisher()` only after it has committed its action.

That separation is intentional: it avoids making the momentum director a hidden second attack state machine.

## Accessibility and device parity

The output event is input-device agnostic. Keyboard/mouse, gamepad and touch/PWA systems already converge on the existing player action event contracts before this director sees them.

A HUD can use `rank`, `scoreRatio`, and `finisherReady` to render the same feedback on all devices without adding device-specific combat rules.

## Performance budget

The director uses bounded arrays and scalar arithmetic. History is limited to 32 samples. Replay tapes are limited to 128 normalized combat events. No render-loop allocation is required by the core event handlers beyond immutable snapshots and bounded history entries.

The module must remain DOM-free and renderer-free so the normal 3D scene does not pay for editor-only machinery.

## Failure behavior

Malformed timestamps, strings, combo steps, serial numbers and equipment values are normalized or ignored. Provider exceptions resolve to a neutral equipment envelope. Consumer callback exceptions are isolated.

The desired failure mode is therefore:

`bad telemetry → neutral/finite evidence`

rather than:

`bad telemetry → broken player combat`

## Versioning

Current contract version: `2026-09-14-v1`.

Changes to thresholds, event meanings, or finisher lifecycle should update the version and extend the executable contract tests in the same change.
