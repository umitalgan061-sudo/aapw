# Traversal contact presentation

Traversal contact is a presentation-layer interpretation of landing impact and foot contact confidence.
It is intentionally separate from physics contact resolution.

## Contact bands

`none` covers impacts below the soft landing threshold. `soft` provides a moderate contact weight and a lighter
recoil/emphasis packet. `hard` provides full contact weight, stronger recoil, a one-shot audio emphasis and a stronger
VFX burst. The band thresholds match the traversal presentation policy so consumers do not maintain duplicate values.

## Animation

Animation can use squash, recoil and foot-plant values from `resolveTraversalContactAnimationEmphasis()`. These values
are normalized and presentation-only. The function never writes a bone or mixer state.

## Audio

Audio receives an intensity derived from impact and a material-independent `light`/`heavy` hint. Material selection
remains a consumer responsibility. The policy only indicates whether a meaningful one-shot contact occurred.

## VFX

VFX receives dust/ring weights and a boolean burst hint. The policy does not spawn particles or know the renderer.

## Validation

Contact output is valid only when the band is one of `none`, `soft`, `hard`, weight is bounded, and impact stays within
the documented normalized impact envelope. Malformed input is converted to a safe numeric fallback before these checks.

## Ownership

Physics remains authoritative over contact and landing. Traversal presentation reads the resulting impact measurement.
Nothing in this module can cause the player to land, bounce, slide, or change velocity.

## Determinism

For the same presentation object, the contact band and emphasis values are identical. No random or wall-clock source is
used. This makes the policy safe for replay and fixture-based tuning.
