# Weather Opportunity Cases
001 clear: neutral exposure.
002 clear: discovery preserved.
003 clear: shelter not forced.
004 clear: trade remains contextual.
005 clear: social remains contextual.
006 clear: watch uses visibility.
007 clear: route uses friction.
008 rain: shelter gains value.
009 rain: weather-break gains value.
010 rain: exposed discovery is reduced.
011 rain: trade remains possible.
012 rain: social remains possible.
013 rain: rest remains possible.
014 rain: no actor is created.
015 rain: no material changes.
016 snow: shelter gains value.
017 snow: rest gains value.
018 snow: route friction remains bounded.
019 snow: watch uses visibility.
020 snow: no terrain mutation.
021 snow: no actor mutation.
022 fog: landmark confidence falls.
023 fog: watch confidence falls.
024 fog: shelter remains available.
025 fog: quiet remains available.
026 fog: route remains bounded.
027 fog: no navigation mutation.
028 storm: shelter is strongly relevant.
029 storm: weather-break is strongly relevant.
030 storm: exposed trade is penalized.
031 storm: exposed social is penalized.
032 storm: gated access is explicit.
033 storm: no combat begins.
034 storm: no quest begins.
035 storm: no save occurs.
036 storm: no time advance occurs.
037 storm: danger remains descriptive.
038 clear-storm-repeat: same seed stays deterministic.
039 rain-repeat: same seed stays deterministic.
040 snow-repeat: same seed stays deterministic.
041 fog-repeat: same seed stays deterministic.
042 storm-repeat: same seed stays deterministic.
043 weather-default: missing value becomes clear.
044 weather-unknown: remains bounded.
045 weather-null: remains bounded.
046 weather-number: normalized to text safely.
047 weather-empty: deterministic fallback.
048 weather-case: stable lower-case handling.
049 weather-phase: phase remains independent and stable.
050 weather-distance: proximity remains bounded.
051 weather-visibility: visibility remains bounded.
052 weather-threat: threat remains bounded.
053 weather-friction: friction remains bounded.
054 weather-population: population remains bounded.
055 weather-resource: resources remain bounded.
056 weather-patrol: patrol remains bounded.
057 weather-shelter: shelter flag remains explicit.
058 weather-biome: biome remains contextual.
059 weather-seed: seed remains deterministic.
060 weather-signal: signal id remains stable.
061 weather-rank: rank remains stable.
062 weather-score: score remains 0..1.
063 weather-confidence: confidence remains 0..1.
064 weather-proof: proof remains deterministic.
065 weather-checksum: checksum remains deterministic.
066 weather-mobile: bounded subset.
067 weather-desktop: bounded full set.
068 weather-plan: bounded steps.
069 weather-alternatives: bounded alternatives.
070 weather-intent: descriptive only.
071 weather-owner: execution delegated.
072 weather-replay: equal input equals output.
073 weather-no-random: random API absent.
074 weather-no-clock: wall clock absent.
075 weather-no-timer: timer API absent.
076 weather-no-scene: scene absent.
077 weather-no-three: three.js dependency absent.
078 weather-no-spawn: spawn absent.
079 weather-no-navmesh: navmesh absent.
080 weather-no-save: save absent.
081 weather-no-quest: quest absent.
082 weather-no-combat: combat absent.
083 weather-no-road: road mutation absent.
084 weather-no-water: hydrology mutation absent.
085 weather-no-material: material mutation absent.
086 weather-no-editor: editor mutation absent.
087 weather-proof-review: evidence explains the weather effect.
088 weather-reason: rationale stays human-readable.
089 weather-access: access stays explicit.
090 weather-gate: gating never deletes candidates.
091 weather-order: tie-break remains stable.
092 weather-freeze: output remains frozen.
093 weather-serialization: output remains plain data.
094 weather-null-plan: empty plan stays valid.
095 weather-null-proof: proof stays valid.
096 weather-adversarial: extreme inputs remain safe.
097 weather-regression: executable tests cover branches.
098 weather-ci: workflow checks the branch.
099 weather-budget: diff guard remains active.
100 weather-complete: release review verifies the contract.
