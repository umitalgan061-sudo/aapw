# Seasonal erosion merge gate

GATE-01: feature scope is render-only.
GATE-02: seasonal forcing is deterministic.
GATE-03: world-space sampling is deterministic.
GATE-04: climate profiles are data-driven.
GATE-05: substrate profiles are data-driven.
GATE-06: snowmelt is represented as a material/runoff pulse.
GATE-07: freeze-thaw is represented as micro-surface wear.
GATE-08: drought uses memory instead of an instant switch.
GATE-09: wind drying is bounded.
GATE-10: runoff response is bounded.
GATE-11: material channels are bounded.
GATE-12: base material remains authoritative.
GATE-13: sediment composition remains present.
GATE-14: runtime cache identity includes season-relevant context.
GATE-15: event ranking is deterministic.
GATE-16: shader installation is idempotent.
GATE-17: shader cache identity is versioned.
GATE-18: shader code does not write terrain height.
GATE-19: shader code does not write hydrology.
GATE-20: shader code does not write vegetation placement.
GATE-21: integration manifest is versioned.
GATE-22: canonical height invariant is explicit.
GATE-23: canonical hydrology invariant is explicit.
GATE-24: canonical coastline invariant is explicit.
GATE-25: canonical collider invariant is explicit.
GATE-26: canonical vegetation invariant is explicit.
GATE-27: profile integrity is tested.
GATE-28: forcing bounds are tested.
GATE-29: snowpack bounds are tested.
GATE-30: freeze-thaw bounds are tested.
GATE-31: runoff bounds are tested.
GATE-32: wind bounds are tested.
GATE-33: world-space separation is tested.
GATE-34: day separation is tested.
GATE-35: climate separation is tested.
GATE-36: substrate separation is tested.
GATE-37: repeated samples are compared.
GATE-38: long-grid behavior is compared.
GATE-39: stress performance has a bound.
GATE-40: edge cases have named coverage.
GATE-41: scenario ledger has named coverage.
GATE-42: transition vectors cover season boundaries.
GATE-43: acceptance ledger is reviewable.
GATE-44: calibration atlas describes intended visual behavior.
GATE-45: response book describes substrate/climate interaction.
GATE-46: biome atlas covers four seasons.
GATE-47: runtime exposes a stable sample contract.
GATE-48: adapter exposes a stable material contract.
GATE-49: no random source is required.
GATE-50: no wall-clock source is required.
GATE-51: no network source is required.
GATE-52: no frame-order randomness is required.
GATE-53: no canonical geometry write is present.
GATE-54: no canonical hydrology write is present.
GATE-55: no canonical coastline write is present.
GATE-56: no canonical collider write is present.
GATE-57: no canonical vegetation relocation is present.
GATE-58: feature-specific QA can be evaluated independently.
GATE-59: actual PR diff is measured before merge.
GATE-60: current-main freshness is checked before merge.
GATE-61: failed checks are reported truthfully.
GATE-62: merge is performed only after gate review.
