# World Opportunity Scenario Ledger

This ledger turns the opportunity contract into deterministic acceptance scenarios.

001 clear/morning/forest: resource and landmark context remains discoverable.
002 clear/morning/plains: trade remains population-sensitive.
003 clear/morning/mountain: landmark remains proximity-sensitive.
004 clear/dusk/ridge: watch remains visibility-sensitive.
005 clear/evening/plains: social remains population-sensitive.
006 clear/night/forest: quiet gains phase preference.
007 rain/morning/forest: shelter relevance increases.
008 rain/afternoon/plains: trade remains possible.
009 snow/morning/mountain: route remains friction-sensitive.
010 fog/morning/forest: landmark confidence is reduced.
011 storm/morning/plains: shelter is highly relevant.
012 storm/dusk/mountain: watch becomes weather-gated.
013 negative-distance: normalizes to safe local distance.
014 huge-distance: caps at maximum local distance.
015 negative-visibility: clamps to zero.
016 huge-visibility: clamps to one.
017 negative-threat: clamps to zero.
018 huge-threat: clamps to one.
019 negative-friction: clamps to zero.
020 huge-friction: clamps to one.
021 negative-population: clamps to zero.
022 huge-population: clamps to one.
023 negative-resources: clamps to zero.
024 huge-resources: clamps to one.
025 negative-patrol: clamps to zero.
026 huge-patrol: clamps to one.
027 negative-slope: clamps to zero.
028 huge-slope: clamps to one.
029 negative-moisture: clamps to zero.
030 huge-moisture: clamps to one.
031 NaN-distance: normalizes safely.
032 NaN-visibility: normalizes safely.
033 Infinity-threat: normalizes safely.
034 Infinity-friction: normalizes safely.
035 empty-context: remains valid.
036 null-context: remains valid.
037 undefined-context: remains valid.
038 unknown-weather: falls back deterministically.
039 unknown-biome: falls back deterministically.
040 missing-seed: stays deterministic.
041 negative-clock: wraps deterministically.
042 huge-clock: wraps deterministically.
043 equivalent-day-clock: produces equivalent phase.
044 equal-seed-equal-context: produces equal score.
045 equal-seed-equal-context: produces equal rank.
046 equal-seed-equal-context: produces equal signal ids.
047 equal-seed-equal-context: produces equal proof checksum.
048 equal-seed-equal-context: produces equal intent id.
049 equal-seed-different-weather: changes weather-sensitive values.
050 equal-seed-different-phase: changes phase-sensitive values.
051 equal-seed-different-distance: changes proximity-sensitive values.
052 equal-seed-different-biome: changes biome-sensitive values.
053 equal-context-different-seed: tie-break remains deterministic.
054 mobile-limit: output stays within nine candidates.
055 desktop-limit: output stays within fourteen candidates.
056 signal-limit: output stays within twelve signals.
057 plan-limit: output stays within eight steps.
058 alternative-limit: output stays within three alternatives.
059 confidence-floor-zero: weak steps may be retained.
060 confidence-floor-one: only perfect confidence could pass.
061 compare-primary: returns descriptive winner.
062 compare-secondary: returns descriptive winner.
063 compare-tie: returns tie deterministically.
064 intent-default: chooses highest-ranked candidate.
065 intent-specific: selects requested candidate when present.
066 intent-id: remains stable.
067 step-id: remains stable.
068 proof-id: remains stable.
069 evidence-id: remains stable.
070 deterministic-key: remains stable.
071 checksum: remains stable.
072 frozen-policy: resists accidental mutation.
073 frozen-context: resists accidental mutation.
074 frozen-snapshot: resists accidental mutation.
075 frozen-plan: resists accidental mutation.
076 frozen-evidence: resists accidental mutation.
077 frozen-proof: resists accidental mutation.
078 unsupported-type: throws explicit error.
079 malformed-report: validator does not throw.
080 duplicate-evidence: validator rejects duplicate ids.
081 invalid-version: validator rejects invalid version.
082 missing-evidence: validator rejects missing array.
083 invalid-utility: validator rejects out-of-range utility.
084 invalid-confidence: validator rejects out-of-range confidence.
085 invalid-safety: validator rejects out-of-range safety.
086 invalid-reachability: validator rejects out-of-range reachability.
087 invalid-owner: validator rejects incorrect ownership.
088 nondeterministic-flag: validator rejects false deterministic flag.
089 empty-evidence-summary: remains valid and deterministic.
090 strongest-evidence: returns stable strongest item.
091 mean-confidence: rounds deterministically.
092 proof-validity: matches validator validity.
093 proof-checksum: equals evidence checksum.
094 proof-summary: equals deterministic summary.
095 planner-mode: appears explicitly in plan.
096 planner-phase: appears explicitly in plan.
097 planner-count: equals actual step count.
098 planner-key: remains deterministic.
099 planner-risk: stays bounded.
100 planner-distance-cost: stays bounded.
