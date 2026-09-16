# TypeScript 7 Adoption Status

The migration foundation now covers renderer selection, runtime state, scheduling, assets, workers, world queries, input, persistence, recovery, telemetry, configuration and validation.

The JavaScript application remains the active bootstrap while typed contracts guard new critical boundaries.

The next conversion stage should replace leaf utilities behind these contracts, then move subsystem implementations, and finally switch bootstrap ownership once parity tests cover the old path.

The existing WebGPU/WebGL2 architecture remains compatible with the migration because backend selection is represented as a discriminated type rather than a hard-coded implementation dependency.

Generated regression cases and focused runtime cases provide deterministic evidence for future conversions.

No public API should accept arbitrary values where a typed adapter can normalize them first.

No migration step should remove the fallback path until the replacement has an independently verified recovery path.
