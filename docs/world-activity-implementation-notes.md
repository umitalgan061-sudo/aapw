# World Activity Implementation Notes

The activity stack is intentionally layered over existing world authorities.

Context derives traversal evidence.
Cadence derives temporal presentation pressure.
Shelter derives environmental exposure pressure.
Journey composes activity, cadence and shelter.
Scheduler assigns deterministic windows.
Evidence reduces multiple signals into bounded recommendations.
Accessibility projects recommendations without mutating UI state.
Director arbitrates a final bounded presentation packet.

All modules expose versioned APIs.
All returned objects are deeply frozen.
All numeric values are normalized or bounded.
All selection uses deterministic sorting and stable identifiers.
No module owns actor spawning, combat, quests, economy, terrain, hydrology,
roads, navigation meshes, materials, model attachment or authoritative save state.

The activity context explicitly honors caller weather input.
This prevents an environmental presentation request from silently collapsing to
clear-weather behavior when the upstream traversal plan contains no atmosphere field.

The scenario and decision ledgers remain descriptive acceptance data.
They are kept separate from authoritative runtime state so test coverage can grow
without creating a second gameplay ledger.

The exact-head workflow verifies current-main ancestry, syntax, regression,
ownership, scope and the 2700..3000 changed-line envelope.
