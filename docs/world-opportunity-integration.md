# Opportunity Integration Ledger
001 input: plain object only.
002 input: normalized at boundary.
003 output: plain snapshot.
004 output: no hidden handles.
005 output: deterministic key.
006 output: stable signal ids.
007 output: stable rankings.
008 output: stable plan ids.
009 output: stable evidence ids.
010 output: stable proof ids.
011 consumer: terrain may read.
012 consumer: road may read.
013 consumer: hydrology may read.
014 consumer: actor system may read.
015 consumer: animation may read.
016 consumer: navigation may read.
017 consumer: combat may read.
018 consumer: quest may read.
019 consumer: save system may read.
020 consumer: renderer may read.
021 consumer: UI may read.
022 consumer: accessibility may read.
023 consumer: replay may read.
024 consumer: QA may read.
025 owner: execution remains external.
026 owner: mutation remains external.
027 owner: persistence remains external.
028 owner: combat remains external.
029 owner: quest remains external.
030 owner: rendering remains external.
031 owner: navigation remains external.
032 owner: actors remain external.
033 adapter: dependency injection friendly.
034 adapter: browser friendly.
035 adapter: Node friendly.
036 adapter: test friendly.
037 adapter: CI friendly.
038 adapter: replay friendly.
039 adapter: mobile friendly.
040 adapter: desktop friendly.
041 no-global: required.
042 no-random: required.
043 no-wallclock: required.
044 no-timers: required.
045 no-three: required.
046 no-scene: required.
047 no-spawn: required.
048 no-navmesh: required.
049 no-save: required.
050 no-quest: required.
051 no-combat: required.
052 no-road-mutation: required.
053 no-water-mutation: required.
054 no-material-mutation: required.
055 no-editor-mutation: required.
056 context: seed.
057 context: distance.
058 context: slope.
059 context: vegetation.
060 context: moisture.
061 context: population.
062 context: threat.
063 context: road activity.
064 context: route friction.
065 context: visibility.
066 context: clock.
067 context: weather.
068 context: biome.
069 context: settlement distance.
070 context: landmark distance.
071 context: shelter.
072 context: resource abundance.
073 context: patrol pressure.
074 output: phase.
075 output: candidates.
076 output: signals.
077 output: deterministic key.
078 plan: mode.
079 plan: steps.
080 plan: alternatives.
081 plan: count.
082 plan: deterministic key.
083 evidence: measurements.
084 evidence: decision.
085 evidence: ownership.
086 evidence: determinism.
087 proof: validity.
088 proof: summary.
089 proof: checksum.
090 proof: proof id.
091 intent: type.
092 intent: rank.
093 intent: score.
094 intent: mode.
095 intent: phase.
096 intent: intent id.
097 intent: mutation owner.
098 intent: no execution.
099 access: visible.
100 access: nearby.
101 access: approach.
102 access: weather gated.
103 type: landmark.
104 type: resource patch.
105 type: shelter.
106 type: trade window.
107 type: social gathering.
108 type: watch point.
109 type: route choice.
110 type: weather break.
111 type: quiet space.
112 type: danger edge.
113 type: craft window.
114 type: rest window.
115 weather: clear.
116 weather: rain.
117 weather: snow.
118 weather: fog.
119 weather: storm.
120 phase: night.
121 phase: dawn.
122 phase: morning.
123 phase: midday.
124 phase: afternoon.
125 phase: dusk.
126 phase: evening.
127 biome: forest.
128 biome: wetland.
129 biome: mountain.
130 biome: ridge.
131 biome: plains.
132 biome: road.
133 biome: frontier.
134 biome: cave.
135 biome: mixed.
136 biome: unknown.
137 mobile: nine candidates max.
138 desktop: fourteen candidates max.
139 signals: twelve max.
140 steps: eight max.
141 alternatives: three max.
142 score: 0..1.
143 confidence: 0..1.
144 utility: 0..1.
145 safety: 0..1.
146 reachability: 0..1.
147 distance: capped.
148 settlement distance: capped.
149 landmark distance: capped.
150 all numbers: finite.
151 freeze: policy.
152 freeze: context.
153 freeze: snapshot.
154 freeze: plan.
155 freeze: evidence.
156 freeze: proof.
157 serialization: stable.
158 ranking: stable.
159 sorting: stable.
160 hashing: stable.
161 errors: explicit.
162 validation: explicit.
163 replay: explicit.
164 QA: explicit.
165 CI: explicit.
166 ownership: explicit.
167 accessibility: explicit.
168 weather gating: explicit.
169 phase semantics: explicit.
170 biome semantics: explicit.
171 integration complete: no side effects.
172 integration complete: owner data only.
173 integration complete: no entity creation.
174 integration complete: no entity deletion.
175 integration complete: no state mutation.
176 integration complete: no time mutation.
177 integration complete: no quest mutation.
178 integration complete: no combat mutation.
179 integration complete: no render mutation.
180 integration complete: no navigation mutation.
181 integration complete: no terrain mutation.
182 integration complete: no road mutation.
183 integration complete: no water mutation.
184 integration complete: no material mutation.
185 integration complete: no editor mutation.
186 integration complete: deterministic replay.
187 integration complete: bounded output.
188 integration complete: frozen output.
189 integration complete: serializable output.
190 integration complete: testable output.
191 integration complete: mobile safe.
192 integration complete: desktop safe.
193 integration complete: browser safe.
194 integration complete: Node safe.
195 integration complete: CI safe.
196 integration complete: QA safe.
197 integration complete: dry-run safe.
198 integration complete: audit safe.
199 integration complete: review safe.
200 integration-ledger-complete: composition boundary is explicit.
