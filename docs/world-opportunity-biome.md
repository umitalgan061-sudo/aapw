# Biome Opportunity Matrix
001 forest: resource factor is elevated.
002 forest: quiet factor is elevated.
003 forest: landmark remains bounded.
004 forest: shelter remains contextual.
005 forest: route remains friction-aware.
006 forest: trade remains settlement-aware.
007 forest: social remains population-aware.
008 forest: watch remains visibility-aware.
009 forest: danger remains threat-aware.
010 forest: craft remains bounded.
011 forest: rest remains phase-aware.
012 wetland: resource factor is elevated.
013 wetland: moisture remains contextual.
014 wetland: landmark remains bounded.
015 wetland: shelter remains weather-aware.
016 wetland: route remains friction-aware.
017 wetland: trade remains settlement-aware.
018 wetland: social remains population-aware.
019 wetland: watch remains visibility-aware.
020 wetland: danger remains threat-aware.
021 wetland: no hydrology mutation.
022 wetland: craft remains bounded.
023 wetland: rest remains phase-aware.
024 mountain: landmark factor is elevated.
025 mountain: shelter factor is elevated.
026 mountain: watch factor is elevated.
027 mountain: danger remains contextual.
028 mountain: route remains friction-aware.
029 mountain: resource remains bounded.
030 mountain: trade remains settlement-aware.
031 mountain: social remains population-aware.
032 mountain: weather gating remains explicit.
033 mountain: no terrain mutation.
034 mountain: no actor mutation.
035 mountain: no nav mutation.
036 ridge: watch factor is elevated.
037 ridge: landmark remains useful.
038 ridge: visibility controls confidence.
039 ridge: weather can gate exposed outputs.
040 ridge: route remains descriptive.
041 ridge: shelter remains descriptive.
042 ridge: danger remains diagnostic.
043 ridge: social remains contextual.
044 ridge: trade remains contextual.
045 ridge: resource remains contextual.
046 ridge: craft remains contextual.
047 ridge: rest remains contextual.
048 plains: trade factor is elevated.
049 plains: social factor is elevated.
050 plains: route remains friction-aware.
051 plains: landmark remains bounded.
052 plains: resource remains abundance-aware.
053 plains: watch remains visibility-aware.
054 plains: shelter remains contextual.
055 plains: danger remains threat-aware.
056 plains: no crowd creation.
057 plains: no merchant creation.
058 plains: no quest creation.
059 plains: no combat creation.
060 plains: no save mutation.
061 road: trade factor is elevated.
062 road: route factor is elevated.
063 road: landmark remains proximity-aware.
064 road: population remains contextual.
065 road: social remains population-aware.
066 road: watch remains visibility-aware.
067 road: shelter remains contextual.
068 road: danger remains patrol-aware.
069 road: no road mutation.
070 road: no navmesh mutation.
071 road: no actor movement.
072 road: no event publication.
073 frontier: danger factor is elevated.
074 frontier: watch remains contextual.
075 frontier: route remains risk-aware.
076 frontier: shelter remains valuable.
077 frontier: quiet remains possible.
078 frontier: trade remains bounded.
079 frontier: social remains bounded.
080 frontier: resource remains bounded.
081 frontier: no combat begins.
082 frontier: no quest begins.
083 frontier: no actor spawn.
084 frontier: no terrain edit.
085 cave: quiet factor is elevated.
086 cave: shelter factor is elevated.
087 cave: landmark remains bounded.
088 cave: watch remains visibility-aware.
089 cave: weather gating may be reduced internally.
090 cave: route remains contextual.
091 cave: trade remains settlement-aware.
092 cave: social remains population-aware.
093 cave: danger remains threat-aware.
094 cave: resource remains bounded.
095 cave: craft remains contextual.
096 cave: rest remains phase-aware.
097 mixed: neutral biome factors are used.
098 mixed: every supported type remains valid.
099 mixed: ranking remains deterministic.
100 mixed: no new world content is inferred.
101 unknown: neutral factor fallback.
102 unknown: output remains bounded.
103 unknown: output remains serializable.
104 unknown: replay remains deterministic.
105 unknown: evidence remains explainable.
106 unknown: ownership remains external.
107 unknown: no actor creation.
108 unknown: no geometry creation.
109 unknown: no road mutation.
110 unknown: no water mutation.
111 unknown: no material mutation.
112 unknown: no persistence mutation.
113 unknown: no quest mutation.
114 unknown: no combat mutation.
115 biome-seed: same seed same output.
116 biome-phase: same phase same phase label.
117 biome-distance: bounded proximity.
118 biome-visibility: bounded visibility.
119 biome-threat: bounded threat.
120 biome-friction: bounded friction.
121 biome-population: bounded population.
122 biome-resource: bounded resources.
123 biome-patrol: bounded patrol.
124 biome-slope: bounded slope.
125 biome-moisture: bounded moisture.
126 biome-weather: explicit weather input.
127 biome-shelter: explicit shelter input.
128 biome-signal: stable signal id.
129 biome-plan: stable plan id.
130 biome-proof: stable proof id.
131 biome-checksum: stable checksum.
132 biome-score: score remains 0..1.
133 biome-confidence: confidence remains 0..1.
134 biome-utility: utility remains 0..1.
135 biome-safety: safety remains 0..1.
136 biome-reachability: reachability remains 0..1.
137 biome-rank: ranking remains deterministic.
138 biome-order: ties use stable ordering.
139 biome-freeze: snapshots remain frozen.
140 biome-mobile: nine-candidate cap.
141 biome-desktop: fourteen-candidate cap.
142 biome-signals: twelve-signal cap.
143 biome-steps: eight-step cap.
144 biome-alternatives: three-alternative cap.
145 biome-discover: neutral mode.
146 biome-approach: proximity-oriented mode.
147 biome-observe: observation-oriented mode.
148 biome-shelter: cover-oriented mode.
149 biome-retreat: safety-oriented mode.
150 biome-compare: route comparison mode.
151 biome-intent: descriptive intent.
152 biome-owner: external execution owner.
153 biome-action: textual recommendation.
154 biome-gating: weather gating is explicit.
155 biome-evidence: measurements are plain data.
156 biome-reason: rationale is human-readable.
157 biome-validator: malformed report is rejected.
158 biome-duplicate: duplicate ids are rejected.
159 biome-version: invalid version is rejected.
160 biome-ownership: wrong owner is rejected.
161 biome-deterministic: false deterministic flag is rejected.
162 biome-nan: NaN remains safe.
163 biome-infinity: Infinity remains safe.
164 biome-negative: negatives clamp safely.
165 biome-huge: huge values clamp safely.
166 biome-empty: empty input remains valid.
167 biome-null: null input remains valid.
168 biome-undefined: undefined input remains valid.
169 biome-clock-negative: clock wraps safely.
170 biome-clock-huge: clock wraps safely.
171 biome-weather-unknown: fallback remains deterministic.
172 biome-string-empty: fallback remains deterministic.
173 biome-seed-empty: fallback remains deterministic.
174 biome-repeat: repeated call is equal.
175 biome-replay: replay is equal.
176 biome-serialization: JSON shape remains stable.
177 biome-browser: no browser globals required.
178 biome-node: Node evaluation remains possible.
179 biome-renderer: renderer is not imported.
180 biome-three: three.js is not imported.
181 biome-scene: scene is not touched.
182 biome-spawn: spawn APIs are not touched.
183 biome-save: save APIs are not touched.
184 biome-quest: quest APIs are not touched.
185 biome-combat: combat APIs are not touched.
186 biome-road: road APIs are not touched.
187 biome-water: water APIs are not touched.
188 biome-editor: editor APIs are not touched.
189 biome-material: material APIs are not touched.
190 biome-timer: timers are not used.
191 biome-random: randomness is not used.
192 biome-wallclock: wall clock is not used.
193 biome-sideeffect: side effects are external.
194 biome-purity: scoring remains pure.
195 biome-ranking: ranking remains pure.
196 biome-planning: planning remains pure.
197 biome-evidence: evidence remains pure.
198 biome-proof: proof remains pure.
199 biome-review: release review checks ownership.
200 biome-complete: matrix is covered by executable regression.
