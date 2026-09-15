# Groundwater Surface Detail Event Contract

The event layer translates named world events into bounded presentation intent.
It does not create simulation ownership.
It does not persist a new world-state model.

## Event identities

`storm` is a wetting pulse.
`snowmelt` is a wetting transition.
`recovery` is a retained-moisture transition.
`drought` is a drying pulse.
`freeze-thaw` is a thermal pulse.
`fog-dew` is a light wetting pulse.
`seepage` is a groundwater presentation cue.
`evaporation` is a drying cue.
`salt-flush` is a mineral transition.
`thermal-spall` is a thermal material cue.

## Normalization

Event names are converted to lower case.
Leading and trailing whitespace is ignored.
Unknown names fall back to the safe recovery identity.
Intensity is converted to a finite number.
Intensity is clamped to `[0,1]`.
A negative intensity becomes zero.
An intensity above one becomes one.

## Families

Wetting events emphasize surface-film presentation.
Drying events emphasize evaporation and residue.
Thermal events emphasize cold-edge and roughness response.
Transition events preserve continuity.
Family classification is deterministic.
Family classification has no side effects.

## Priority

Storm has high wetting priority.
Snowmelt has high wetting priority.
Drought has high drying priority.
Freeze-thaw has high thermal priority.
Recovery has medium transition priority.
Other supported events use bounded default priority.
Priority is metadata only.
Priority does not override canonical ownership.

## Catalog safety

Catalog IDs must be unique.
Catalog intensities must be finite.
Catalog priorities must be finite.
Catalog descriptions must remain actionable.
The catalog is frozen.
Catalog lookup is deterministic.
Sequence construction is deterministic.
Event profiles are immutable.

## Composition

An event profile can feed `detailEventDelta`.
An event profile can feed `detailStackEvent`.
The profile intensity can be overridden safely.
Unknown event names remain safe.
Zero intensity is an identity delta.
Full intensity remains bounded.
Repeated application with the same inputs is deterministic.

## Review boundary

This contract does not define rainfall generation.
It does not define climate forecasting.
It does not define hydrology topology.
It does not define water-body geometry.
It does not define terrain height.
It does not define collision geometry.
It does not define vegetation placement.
It only defines presentation-event normalization.

## Merge gate

The event catalog must pass its focused checks.
The helper module must import cleanly.
The catalog audit must pass.
Known families must be present.
Known priorities must be finite.
Sequence output must be frozen.
Unknown inputs must remain safe.
This event layer is mergeable only with the rest of the groundwater detail focused suite green.
