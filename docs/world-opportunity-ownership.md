# Opportunity Ownership Matrix
001 terrain: owns geometry.
002 terrain: opportunity layer may only read context.
003 road: owns topology.
004 road: opportunity layer may only read context.
005 hydrology: owns water simulation.
006 hydrology: opportunity layer may only read context.
007 actors: own creation.
008 actors: opportunity layer never creates actors.
009 actors: own locomotion.
010 actors: opportunity layer never moves actors.
011 animation: owns animation.
012 animation: opportunity layer never starts animation.
013 combat: owns hit resolution.
014 combat: opportunity layer never resolves combat.
015 quests: own progression.
016 quests: opportunity layer never advances quests.
017 persistence: owns saves.
018 persistence: opportunity layer never writes saves.
019 renderer: owns scene state.
020 renderer: opportunity layer never mutates scene.
021 materials: own material state.
022 materials: opportunity layer never changes materials.
023 editor: owns authoring mutation.
024 editor: opportunity layer never edits.
025 navigation: owns path execution.
026 navigation: planner never edits navmesh.
027 navigation: planner only reports reachability context.
028 event bus: remains external.
029 event bus: opportunity context does not publish.
030 registry: remains external.
031 registry: opportunity context does not mutate.
032 save: remains external.
033 save: proof remains read-only.
034 quest: remains external.
035 quest: proof remains read-only.
036 combat: remains external.
037 combat: proof remains read-only.
038 actor: remains external.
039 actor: plan remains descriptive.
040 movement: remains external.
041 movement: intent remains non-executing.
042 camera: remains external.
043 camera: no dependency.
044 scene: remains external.
045 scene: no dependency.
046 three: remains external.
047 three: no dependency.
048 browser: remains external.
049 browser: no dependency.
050 filesystem: remains external.
051 filesystem: no dependency.
052 network: remains external.
053 network: no dependency.
054 time: in-world clock is input only.
055 wall clock: never used.
056 random: never used.
057 timers: never used.
058 globals: never mutated.
059 singletons: never required.
060 side effects: never required.
061 inputs: normalized.
062 inputs: frozen after normalization.
063 scores: bounded.
064 scores: deterministic.
065 ranks: deterministic.
066 signals: deterministic.
067 plans: deterministic.
068 evidence: deterministic.
069 proofs: deterministic.
070 intents: descriptive.
071 context: serializable.
072 snapshot: serializable.
073 plan: serializable.
074 evidence: serializable.
075 proof: serializable.
076 intent: serializable.
077 errors: explicit.
078 validation: deterministic.
079 replay: deterministic.
080 ownership: explicit.
081 mutation owner: external.
082 requires execution: false.
083 access state: descriptive.
084 weather gate: descriptive.
085 route cost: descriptive.
086 risk cost: descriptive.
087 visibility cost: descriptive.
088 distance cost: descriptive.
089 confidence: descriptive.
090 utility: descriptive.
091 rationale: descriptive.
092 candidate: descriptive.
093 signal: descriptive.
094 alternative: descriptive.
095 strongest evidence: descriptive.
096 summary: descriptive.
097 checksum: proof metadata.
098 proof id: proof metadata.
099 intent id: proof metadata.
100 ownership-complete: no mutation crosses this layer.
101 terrain test: no scene import.
102 road test: no road mutation.
103 hydrology test: no water mutation.
104 actor test: no spawn call.
105 movement test: no locomotion call.
106 animation test: no animation call.
107 combat test: no combat call.
108 quest test: no quest call.
109 save test: no save call.
110 renderer test: no renderer mutation.
111 material test: no material call.
112 editor test: no editor call.
113 navmesh test: no navmesh creation.
114 random test: no Math.random.
115 clock test: no Date.now.
116 timer test: no setTimeout.
117 timer test: no setInterval.
118 event test: no publish.
119 registry test: no registration.
120 global test: no mutation.
121 freeze test: context frozen.
122 freeze test: snapshot frozen.
123 freeze test: plan frozen.
124 freeze test: evidence frozen.
125 freeze test: proof frozen.
126 freeze test: intent frozen.
127 bound test: distance bounded.
128 bound test: visibility bounded.
129 bound test: threat bounded.
130 bound test: friction bounded.
131 bound test: population bounded.
132 bound test: resources bounded.
133 bound test: patrol bounded.
134 bound test: slope bounded.
135 bound test: moisture bounded.
136 replay test: same seed.
137 replay test: same context.
138 replay test: same output.
139 replay test: same proof.
140 replay test: same checksum.
141 replay test: same rank.
142 replay test: same ids.
143 replay test: same phase.
144 replay test: same access.
145 replay test: same rationale.
146 mobile test: candidate cap.
147 desktop test: candidate cap.
148 signal test: signal cap.
149 step test: step cap.
150 alternative test: alternative cap.
151 planner test: discover.
152 planner test: approach.
153 planner test: compare.
154 planner test: retreat.
155 planner test: shelter.
156 planner test: observe.
157 evidence test: valid report.
158 evidence test: duplicate rejection.
159 evidence test: version rejection.
160 evidence test: missing rejection.
161 evidence test: range rejection.
162 proof test: valid proof.
163 proof test: stable proof id.
164 proof test: stable checksum.
165 intent test: default candidate.
166 intent test: explicit candidate.
167 intent test: descriptive action.
168 intent test: external owner.
169 intent test: no execution.
170 weather test: storm gate.
171 weather test: fog reduction.
172 weather test: rain shelter.
173 weather test: snow shelter.
174 weather test: clear neutral.
175 phase test: dawn.
176 phase test: morning.
177 phase test: midday.
178 phase test: afternoon.
179 phase test: dusk.
180 phase test: evening.
181 phase test: night.
182 biome test: forest.
183 biome test: wetland.
184 biome test: mountain.
185 biome test: ridge.
186 biome test: plains.
187 biome test: road.
188 biome test: frontier.
189 biome test: cave.
190 biome test: mixed.
191 biome test: unknown.
192 malformed test: NaN.
193 malformed test: Infinity.
194 malformed test: negatives.
195 malformed test: huge values.
196 malformed test: null.
197 malformed test: undefined.
198 malformed test: empty strings.
199 malformed test: unknown labels.
200 ownership-complete: execution remains with authoritative systems.
