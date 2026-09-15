# Planner Acceptance Ledger
001 discover: returns bounded steps.
002 discover: preserves ranking.
003 discover: preserves evidence.
004 discover: remains read-only.
005 discover: remains deterministic.
006 approach: favors proximity.
007 approach: remains bounded.
008 approach: remains deterministic.
009 approach: remains descriptive.
010 approach: keeps owner external.
011 compare: evaluates alternatives.
012 compare: never edits routes.
013 compare: never edits navmesh.
014 compare: returns descriptive winner.
015 compare: remains deterministic.
016 retreat: favors shelter.
017 retreat: favors weather-break.
018 retreat: favors rest.
019 retreat: remains bounded.
020 retreat: remains read-only.
021 shelter: favors cover.
022 shelter: remains weather-aware.
023 shelter: remains phase-aware.
024 shelter: remains deterministic.
025 shelter: remains external.
026 observe: favors landmark.
027 observe: favors watch point.
028 observe: favors quiet context.
029 observe: remains visibility-aware.
030 observe: remains descriptive.
031 mode-default: discover.
032 mode-empty: discover fallback.
033 mode-unknown: discover fallback.
034 mode-null: discover fallback.
035 mode-repeat: stable.
036 energy-low: output bounded.
037 energy-high: output bounded.
038 urgency-low: output bounded.
039 urgency-high: output bounded.
040 confidence-low: more steps may pass.
041 confidence-high: weak steps filter.
042 candidate-limit: fourteen max input.
043 candidate-limit: eight max steps.
044 alternative-limit: three max.
045 sort-order: stable utility.
046 sort-tie: stable id.
047 step-id: stable hash.
048 plan-key: stable hash.
049 phase: inherited from snapshot.
050 count: actual step count.
051 action-evaluate: descriptive.
052 action-approach: descriptive.
053 action-wait: descriptive.
054 rationale: human-readable.
055 cost-distance: bounded.
056 cost-risk: bounded.
057 cost-friction: bounded.
058 cost-visibility: bounded.
059 utility: bounded.
060 confidence: bounded.
061 safety: never combat.
062 reachability: never navigation mutation.
063 owner: external.
064 execution: false.
065 storm: weather gate retained.
066 fog: visibility penalty retained.
067 rain: shelter preference retained.
068 snow: shelter preference retained.
069 clear: neutral baseline retained.
070 phase-dawn: watch preference retained.
071 phase-morning: resource preference retained.
072 phase-midday: trade preference retained.
073 phase-afternoon: route preference retained.
074 phase-dusk: watch preference retained.
075 phase-evening: social preference retained.
076 phase-night: quiet preference retained.
077 biome-forest: resource multiplier retained.
078 biome-wetland: resource multiplier retained.
079 biome-mountain: landmark multiplier retained.
080 biome-ridge: watch multiplier retained.
081 biome-plains: trade multiplier retained.
082 biome-road: route multiplier retained.
083 biome-frontier: danger context retained.
084 biome-cave: quiet context retained.
085 biome-mixed: neutral fallback.
086 malformed-distance: normalized upstream.
087 malformed-visibility: normalized upstream.
088 malformed-threat: normalized upstream.
089 malformed-friction: normalized upstream.
090 malformed-population: normalized upstream.
091 malformed-resources: normalized upstream.
092 malformed-patrol: normalized upstream.
093 malformed-slope: normalized upstream.
094 malformed-moisture: normalized upstream.
095 malformed-clock: normalized upstream.
096 malformed-weather: normalized upstream.
097 malformed-biome: normalized upstream.
098 malformed-seed: normalized upstream.
099 empty-context: safe plan.
100 null-context: safe plan.
101 undefined-context: safe plan.
102 huge-context: safe plan.
103 negative-context: safe plan.
104 repeated-context: equal plan.
105 repeated-plan: equal serialization.
106 repeated-plan: equal checksum input.
107 repeated-plan: equal ids.
108 repeated-plan: equal order.
109 mobile-consumer: bounded.
110 desktop-consumer: bounded.
111 renderer-consumer: no dependency.
112 browser-consumer: no dependency.
113 node-consumer: supported.
114 filesystem-consumer: no dependency.
115 network-consumer: no dependency.
116 actor-consumer: plain data only.
117 navigation-consumer: plain data only.
118 quest-consumer: plain data only.
119 save-consumer: plain data only.
120 combat-consumer: plain data only.
121 event-consumer: plain data only.
122 editor-consumer: plain data only.
123 material-consumer: plain data only.
124 terrain-consumer: plain data only.
125 road-consumer: plain data only.
126 water-consumer: plain data only.
127 plan-freeze: immutable.
128 step-freeze: immutable.
129 alternative-freeze: immutable.
130 result-freeze: immutable.
131 stable-sorting: locale tie-break.
132 stable-hash: deterministic.
133 no-random: enforced by CI.
134 no-clock: enforced by CI.
135 no-timer: enforced by CI.
136 no-spawn: enforced by CI.
137 no-navmesh: enforced by CI.
138 no-save: enforced by CI.
139 no-quest: enforced by CI.
140 no-combat: enforced by CI.
141 no-scene: enforced by CI.
142 no-three: enforced by CI.
143 no-material: enforced by CI.
144 boundary: ownership remains explicit.
145 boundary: mutation remains external.
146 boundary: execution remains false.
147 proof: planner remains auditable.
148 proof: evidence remains inspectable.
149 replay: plan is deterministic.
150 replay: same seed yields same plan.
151 replay: equivalent clock yields same phase.
152 replay: same weather yields same gate.
153 replay: same biome yields same factor.
154 replay: same route friction yields same cost.
155 replay: same threat yields same safety cost.
156 replay: same population yields same social score.
157 replay: same resources yields same resource score.
158 replay: same visibility yields same confidence.
159 replay: same distance yields same proximity.
160 compare: deterministic winner.
161 compare: deterministic tie.
162 compare: descriptive only.
163 intent: default selection stable.
164 intent: explicit selection stable.
165 intent: missing selection fallback stable.
166 intent: no execution.
167 intent: external owner.
168 evidence: decision remains descriptive.
169 evidence: costs remain descriptive.
170 evidence: rationale remains descriptive.
171 validation: bad version rejected.
172 validation: bad utility rejected.
173 validation: bad confidence rejected.
174 validation: bad safety rejected.
175 validation: bad reachability rejected.
176 validation: bad owner rejected.
177 validation: duplicate ids rejected.
178 validation: false deterministic rejected.
179 validation: missing evidence rejected.
180 proof: validity mirrors validation.
181 proof: summary remains deterministic.
182 proof: checksum remains deterministic.
183 proof: proof id remains deterministic.
184 QA: syntax checked.
185 QA: regression checked.
186 QA: adversarial checked.
187 QA: double-run checked.
188 CI: exact head checked.
189 CI: current main checked.
190 CI: boundary guard checked.
191 CI: diff budget checked.
192 release: no deletions expected.
193 release: additive feature scope.
194 release: docs included.
195 release: code included.
196 release: tests included.
197 release: workflow included.
198 release: replay included.
199 release: ownership included.
200 planner-complete: acceptance ledger closed.
