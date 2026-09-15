# Opportunity Replay Ledger
001 seed same: snapshot identity is stable.
002 seed same: score is stable.
003 seed same: rank is stable.
004 seed same: signal id is stable.
005 seed same: proof id is stable.
006 seed same: checksum is stable.
007 clock same: phase is stable.
008 clock plus day: phase is equivalent.
009 clock negative: phase wraps safely.
010 clock huge: phase wraps safely.
011 weather clear: deterministic output.
012 weather rain: deterministic output.
013 weather snow: deterministic output.
014 weather fog: deterministic output.
015 weather storm: deterministic output.
016 biome forest: deterministic output.
017 biome plains: deterministic output.
018 biome mountain: deterministic output.
019 biome ridge: deterministic output.
020 biome wetland: deterministic output.
021 distance zero: proximity is maximal.
022 distance local: proximity is bounded.
023 distance maximum: proximity is minimal.
024 distance huge: distance is capped.
025 visibility zero: gated outputs remain valid.
026 visibility one: observation remains valid.
027 threat zero: danger remains low.
028 threat one: danger remains bounded.
029 friction zero: route cost is low.
030 friction one: route cost is bounded.
031 population zero: quiet relevance may rise.
032 population one: social relevance may rise.
033 resources zero: resource value remains bounded.
034 resources one: resource value may rise.
035 patrol zero: danger remains bounded.
036 patrol one: danger remains bounded.
037 shelter false clear: shelter is not forced.
038 shelter true clear: shelter can rank.
039 shelter false storm: environmental cover may rank.
040 shelter true storm: shelter ranks strongly.
041 discover mode: output is stable.
042 approach mode: output is stable.
043 compare mode: output is stable.
044 retreat mode: output is stable.
045 shelter mode: output is stable.
046 observe mode: output is stable.
047 mode switch: ids reflect mode deterministically.
048 mode same: ids remain equal.
049 confidence floor low: more steps may survive.
050 confidence floor high: weak steps are filtered.
051 desktop candidate cap: bounded.
052 mobile candidate cap: bounded.
053 signal cap: bounded.
054 step cap: bounded.
055 alternative cap: bounded.
056 serialization: JSON remains stable.
057 freeze: policy remains immutable.
058 freeze: context remains immutable.
059 freeze: snapshot remains immutable.
060 freeze: plan remains immutable.
061 freeze: evidence remains immutable.
062 freeze: proof remains immutable.
063 repeat snapshot: deep equality holds.
064 repeat plan: deep equality holds.
065 repeat proof: deep equality holds.
066 repeat evidence: deep equality holds.
067 repeat intent: same id.
068 repeat comparison: same winner.
069 compare tie: tie remains stable.
070 compare primary: winner remains stable.
071 compare secondary: winner remains stable.
072 evidence checksum: stable.
073 proof checksum: stable.
074 deterministic key: stable.
075 signal id: stable.
076 step id: stable.
077 intent id: stable.
078 proof id: stable.
079 malformed context: normalization stable.
080 null context: normalization stable.
081 empty context: normalization stable.
082 unknown weather: fallback stable.
083 unknown biome: fallback stable.
084 missing seed: fallback stable.
085 NaN input: finite output.
086 Infinity input: finite output.
087 negative input: bounded output.
088 huge input: bounded output.
089 unsupported type: explicit failure.
090 malformed report: explicit validation.
091 duplicate evidence: explicit validation.
092 invalid version: explicit validation.
093 invalid utility: explicit validation.
094 invalid confidence: explicit validation.
095 invalid safety: explicit validation.
096 invalid reachability: explicit validation.
097 invalid owner: explicit validation.
098 false deterministic: explicit validation.
099 empty evidence: valid summary.
100 strongest evidence: stable selection.
101 mean confidence: stable rounding.
102 proof validity: matches validator.
103 proof summary: deterministic.
104 proof checksum: deterministic.
105 plan mode: explicit.
106 plan phase: explicit.
107 plan count: exact.
108 plan key: deterministic.
109 plan action: descriptive.
110 plan owner: external.
111 plan execution: false.
112 route comparison: descriptive.
113 route comparison: no nav mutation.
114 intent build: descriptive.
115 intent build: no movement.
116 opportunity scoring: pure.
117 opportunity ranking: pure.
118 signal building: pure.
119 evidence building: pure.
120 proof building: pure.
121 renderer absent: replay still works.
122 browser absent: replay still works.
123 filesystem absent: replay still works.
124 network absent: replay still works.
125 actor registry absent: replay still works.
126 event bus absent: replay still works.
127 terrain owner absent: replay still works.
128 road owner absent: replay still works.
129 hydrology owner absent: replay still works.
130 combat owner absent: replay still works.
131 quest owner absent: replay still works.
132 save owner absent: replay still works.
133 editor owner absent: replay still works.
134 material owner absent: replay still works.
135 three.js absent: replay still works.
136 random API absent: replay still works.
137 Date API absent: replay still works.
138 timers absent: replay still works.
139 global mutable state absent: replay still works.
140 plain input: replay works.
141 plain output: replay works.
142 plain evidence: replay works.
143 plain proof: replay works.
144 plain plan: replay works.
145 plain intent: replay works.
146 clear morning: stable.
147 clear midday: stable.
148 clear afternoon: stable.
149 clear dusk: stable.
150 clear evening: stable.
151 clear night: stable.
152 clear dawn: stable.
153 rain morning: stable.
154 rain midday: stable.
155 rain evening: stable.
156 snow morning: stable.
157 snow night: stable.
158 fog dawn: stable.
159 fog afternoon: stable.
160 storm dusk: stable.
161 storm night: stable.
162 forest morning: stable.
163 mountain dusk: stable.
164 plains midday: stable.
165 ridge dawn: stable.
166 wetland afternoon: stable.
167 approach storm: gated stable.
168 shelter rain: stable.
169 retreat snow: stable.
170 observe fog: visibility-aware stable.
171 compare road: friction-aware stable.
172 discover forest: resource-aware stable.
173 discover mountain: landmark-aware stable.
174 discover plains: trade-aware stable.
175 observe ridge: watch-aware stable.
176 retreat forest: shelter-aware stable.
177 shelter mountain: shelter-aware stable.
178 compare plains: route-aware stable.
179 replay batch: all outputs remain stable.
180 replay batch: all outputs remain bounded.
181 replay batch: all outputs remain frozen.
182 replay batch: all outputs remain serializable.
183 replay batch: all outputs remain owner-safe.
184 replay batch: all outputs remain read-only.
185 replay batch: all outputs remain diagnosable.
186 replay batch: all outputs remain deterministic.
187 replay batch: all outputs remain testable.
188 replay batch: all outputs remain CI-compatible.
189 replay batch: all outputs remain mobile-safe.
190 replay batch: all outputs remain desktop-safe.
191 replay batch: weather remains explicit.
192 replay batch: phase remains explicit.
193 replay batch: biome remains explicit.
194 replay batch: access remains explicit.
195 replay batch: rationale remains explicit.
196 replay batch: rank remains explicit.
197 replay batch: confidence remains explicit.
198 replay batch: checksum remains explicit.
199 replay batch: ownership remains explicit.
200 replay-complete: contract is replayable.
