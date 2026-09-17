# AAPW Modern Combat Stack

The modern path now treats combat as semantic, deterministic runtime data rather than renderer/UI state.

## Guarantees

- Typed combat decisions are consumed by `RuntimeIntegrationV2`.
- Attack instances carry their own stable identity, so hit de-duplication never depends on wall-clock time.
- Attack phase transitions keep the exact attack definition from startup through active/recovery.
- Large frame gaps are consumed phase-by-phase instead of skipping the active window.
- Legacy `PlayerInput` attack booleans remain supported while semantic commands can be injected directly.
- Stamina and stance mutation are exposed through bounded methods on `PlayerAuthority`.

The renderer remains outside the simulation contract. VFX/SFX/UI consumers should subscribe to combat events or typed decision receipts rather than mutate gameplay state directly.
