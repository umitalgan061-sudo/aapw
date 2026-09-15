# Evidence Acceptance Ledger
001 id: deterministic signal identity.
002 type: supported opportunity type.
003 rank: bounded positive integer.
004 measurement: bounded distance.
005 measurement: bounded visibility.
006 measurement: explicit weather.
007 measurement: explicit phase.
008 decision: bounded utility.
009 decision: bounded confidence.
010 decision: bounded safety.
011 decision: bounded reachability.
012 ownership: opportunity-context.
013 deterministic: true.
014 duplicate ids: rejected.
015 missing version: rejected.
016 bad version: rejected.
017 missing evidence: rejected.
018 utility below zero: rejected.
019 utility above one: rejected.
020 confidence below zero: rejected.
021 confidence above one: rejected.
022 safety below zero: rejected.
023 safety above one: rejected.
024 reachability below zero: rejected.
025 reachability above one: rejected.
026 wrong owner: rejected.
027 nondeterministic flag: rejected.
028 empty evidence: valid.
029 empty summary: deterministic.
030 strongest item: stable.
031 mean confidence: stable.
032 checksum: stable.
033 proof id: stable.
034 proof validity: stable.
035 proof summary: stable.
036 proof checksum: stable.
037 malformed report: validator stays safe.
038 null report: validator stays safe.
039 undefined report: validator stays safe.
040 repeated report: equal validation.
041 repeated evidence: equal output.
042 repeated proof: equal output.
043 clear weather: evidence remains explicit.
044 rain weather: evidence remains explicit.
045 snow weather: evidence remains explicit.
046 fog weather: evidence remains explicit.
047 storm weather: evidence remains explicit.
048 dawn phase: evidence remains explicit.
049 morning phase: evidence remains explicit.
050 midday phase: evidence remains explicit.
051 afternoon phase: evidence remains explicit.
052 dusk phase: evidence remains explicit.
053 evening phase: evidence remains explicit.
054 night phase: evidence remains explicit.
055 forest biome: evidence remains explicit.
056 wetland biome: evidence remains explicit.
057 mountain biome: evidence remains explicit.
058 ridge biome: evidence remains explicit.
059 plains biome: evidence remains explicit.
060 road biome: evidence remains explicit.
061 frontier biome: evidence remains explicit.
062 cave biome: evidence remains explicit.
063 mixed biome: evidence remains explicit.
064 unknown biome: fallback remains explicit.
065 low visibility: confidence remains bounded.
066 high visibility: confidence remains bounded.
067 low threat: safety remains bounded.
068 high threat: safety remains bounded.
069 low friction: distance remains bounded.
070 high friction: reachability remains bounded.
071 low population: social evidence remains bounded.
072 high population: social evidence remains bounded.
073 low resources: resource evidence remains bounded.
074 high resources: resource evidence remains bounded.
075 low patrol: risk evidence remains bounded.
076 high patrol: risk evidence remains bounded.
077 absent shelter: evidence remains valid.
078 present shelter: evidence remains valid.
079 extreme distance: evidence remains valid.
080 negative distance: evidence remains valid.
081 NaN input: evidence remains valid.
082 Infinity input: evidence remains valid.
083 empty input: evidence remains valid.
084 null input: evidence remains valid.
085 large clock: evidence remains valid.
086 negative clock: evidence remains valid.
087 unknown weather: evidence remains valid.
088 unknown type: upstream rejects explicitly.
089 frozen evidence: immutable.
090 frozen proof: immutable.
091 frozen summary: immutable.
092 serialized evidence: plain data.
093 serialized proof: plain data.
094 serialized summary: plain data.
095 browser independent: yes.
096 node independent: yes.
097 filesystem independent: yes.
098 network independent: yes.
099 actor independent: yes.
100 renderer independent: yes.
101 terrain independent: yes.
102 road independent: yes.
103 hydrology independent: yes.
104 combat independent: yes.
105 quest independent: yes.
106 persistence independent: yes.
107 editor independent: yes.
108 material independent: yes.
109 navigation independent: yes.
110 event bus independent: yes.
111 random independent: yes.
112 wall clock independent: yes.
113 timer independent: yes.
114 evidence ordering: follows plan order.
115 proof ordering: follows evidence order.
116 summary ordering: stable reduction.
117 error ordering: stable.
118 id generation: hash only.
119 checksum generation: hash only.
120 proof generation: read-only.
121 utility meaning: opportunity usefulness.
122 confidence meaning: evidence confidence.
123 safety meaning: contextual pressure inverse.
124 reachability meaning: contextual access estimate.
125 measurement meaning: observed plain input.
126 ownership meaning: layer boundary.
127 deterministic meaning: replay safe.
128 rationale meaning: explainable reason.
129 weather gate meaning: deferred access.
130 rank meaning: ordered candidate position.
131 mobile evidence: bounded subset.
132 desktop evidence: bounded full set.
133 signal cap: twelve maximum.
134 candidate cap: fourteen maximum.
135 step cap: eight maximum.
136 alternative cap: three maximum.
137 evidence cap: plan bounded.
138 summary cap: one compact record.
139 proof cap: one compact record.
140 validation cap: finite error list.
141 regression: clear path covered.
142 regression: storm path covered.
143 regression: hidden visibility covered.
144 regression: comparison covered.
145 regression: intent covered.
146 regression: validation covered.
147 regression: proof covered.
148 adversarial: malformed numerics covered.
149 adversarial: malformed strings covered.
150 adversarial: missing inputs covered.
151 adversarial: extreme inputs covered.
152 adversarial: deterministic repeats covered.
153 adversarial: weather repeats covered.
154 adversarial: phase repeats covered.
155 adversarial: biome repeats covered.
156 adversarial: mode repeats covered.
157 replay: same seed same evidence.
158 replay: same context same evidence.
159 replay: same plan same evidence.
160 replay: same proof same checksum.
161 replay: same proof same id.
162 ownership: no spawn.
163 ownership: no move.
164 ownership: no animation.
165 ownership: no combat.
166 ownership: no quest.
167 ownership: no save.
168 ownership: no scene.
169 ownership: no geometry.
170 ownership: no navmesh.
171 ownership: no roads.
172 ownership: no water.
173 ownership: no materials.
174 ownership: no editor mutation.
175 ownership: no event publish.
176 ownership: no registry mutation.
177 ownership: no global state.
178 ownership: no timer.
179 ownership: no randomness.
180 ownership: no wall clock.
181 integration: plain context input.
182 integration: plain snapshot output.
183 integration: plain plan output.
184 integration: plain evidence output.
185 integration: plain proof output.
186 integration: dependency injection friendly.
187 integration: adapter friendly.
188 integration: dry-run friendly.
189 integration: CI friendly.
190 integration: replay friendly.
191 documentation: mirrors contract.
192 documentation: mirrors ownership.
193 documentation: mirrors replay.
194 documentation: mirrors accessibility.
195 documentation: mirrors failure behavior.
196 documentation: mirrors weather behavior.
197 documentation: mirrors phase behavior.
198 documentation: mirrors biome behavior.
199 documentation: mirrors test coverage.
200 evidence-complete: ledger closed.
