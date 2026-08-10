# Run236 V2 proof isolation rationale

The superseded V1 proof mixed two independent behaviors: unknown/missing-asset skipping and fractional-position fidelity while scene-load snap settings are restored. V2 intentionally uses integer positions so it tests only the unknown-asset contract while still covering signed rotation, sub-0.01 non-uniform scale, hierarchy, selection clearing, and editor grid/snap settings. Fractional-position fidelity remains tracked separately in issue #125.
