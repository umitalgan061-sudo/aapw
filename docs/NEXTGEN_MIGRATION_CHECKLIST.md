# NextGen Migration Checklist

- Keep simulation state in typed contracts and fixed-step systems.
- Keep rendering as a consumer of deterministic render plans.
- Keep network transport separate from authoritative gameplay.
- Keep asset validation before decoding or residency.
- Keep save schema migrations explicit and forward-only.
- Keep all untrusted payloads behind the security boundary.
- Keep legacy JavaScript adapters thin and temporary.
- Prefer deterministic ordering for entity, event, queue and snapshot collections.
- Respect device-tier budgets instead of assuming desktop hardware.
- Add a regression test for every migrated lifecycle boundary.
- Remove duplicate legacy logic only after the typed implementation is authoritative.
- Preserve existing public behavior while ownership transfers subsystem by subsystem.
