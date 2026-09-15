# Failure and Boundary Ledger
001 missing context: normalize defaults.
002 null context: normalize defaults.
003 undefined context: normalize defaults.
004 empty seed: stable fallback.
005 empty weather: clear fallback.
006 empty biome: mixed fallback.
007 negative distance: clamp.
008 huge distance: cap.
009 NaN distance: safe fallback.
010 Infinity distance: safe fallback.
011 negative visibility: clamp.
012 huge visibility: cap.
013 NaN visibility: safe fallback.
014 Infinity visibility: safe fallback.
015 negative threat: clamp.
016 huge threat: cap.
017 negative friction: clamp.
018 huge friction: cap.
019 negative population: clamp.
020 huge population: cap.
021 negative resources: clamp.
022 huge resources: cap.
023 negative patrol: clamp.
024 huge patrol: cap.
025 negative slope: clamp.
026 huge slope: cap.
027 negative moisture: clamp.
028 huge moisture: cap.
029 negative clock: wrap.
030 huge clock: wrap.
031 unsupported type: explicit error.
032 malformed report: validator result.
033 duplicate evidence: validator result.
034 bad version: validator result.
035 missing evidence: validator result.
036 bad utility: validator result.
037 bad confidence: validator result.
038 bad safety: validator result.
039 bad reachability: validator result.
040 bad owner: validator result.
041 false deterministic: validator result.
042 empty evidence: valid report.
043 empty steps: valid plan.
044 empty candidates: valid snapshot.
045 storm exposed candidate: gate access.
046 fog exposed candidate: penalize confidence.
047 rain shelter candidate: prefer cover.
048 snow shelter candidate: prefer cover.
049 clear shelter candidate: do not force.
050 low visibility shelter: allow.
051 low visibility rest: allow.
052 low visibility weather-break: allow.
053 low visibility watch: reduce.
054 low visibility landmark: reduce.
055 high threat danger: bounded.
056 low threat danger: bounded.
057 high friction route: bounded.
058 low friction route: bounded.
059 high population social: bounded.
060 low population quiet: bounded.
061 high resources resource: bounded.
062 low resources resource: bounded.
063 far settlement trade: bounded.
064 near settlement trade: bounded.
065 far landmark: bounded.
066 near landmark: bounded.
067 missing shelter flag: safe.
068 present shelter flag: safe.
069 unknown weather: safe.
070 unknown biome: safe.
071 unknown mode: discover fallback.
072 missing mode: discover fallback.
073 missing confidence floor: default.
074 invalid confidence floor: clamp.
075 invalid energy: clamp.
076 invalid urgency: clamp.
077 repeat same input: same output.
078 repeat same plan: same output.
079 repeat same proof: same output.
080 repeat same evidence: same output.
081 different seed: deterministic change only.
082 different weather: weather-sensitive change.
083 different phase: phase-sensitive change.
084 different biome: biome-sensitive change.
085 different distance: distance-sensitive change.
086 different visibility: visibility-sensitive change.
087 different friction: friction-sensitive change.
088 different population: social-sensitive change.
089 different resources: resource-sensitive change.
090 different threat: risk-sensitive change.
091 different patrol: risk-sensitive change.
092 desktop limit: fourteen max.
093 mobile limit: nine max.
094 signals: twelve max.
095 steps: eight max.
096 alternatives: three max.
097 unsupported access: never generated.
098 weather gate: explicit.
099 approach access: explicit.
100 evaluate access: explicit.
101 action: not executable.
102 intent: not executable.
103 owner: external.
104 execution: false.
105 random API: prohibited.
106 wall clock: prohibited.
107 timers: prohibited.
108 scene mutation: prohibited.
109 spawn: prohibited.
110 navmesh mutation: prohibited.
111 save: prohibited.
112 quest: prohibited.
113 combat: prohibited.
114 road mutation: prohibited.
115 hydrology mutation: prohibited.
116 materials mutation: prohibited.
117 editor mutation: prohibited.
118 actor registry mutation: prohibited.
119 event publication: prohibited.
120 global state mutation: prohibited.
121 renderer dependency: prohibited.
122 three dependency: prohibited.
123 browser dependency: unnecessary.
124 filesystem dependency: unnecessary.
125 network dependency: unnecessary.
126 deterministic hash: required.
127 freeze: required.
128 serialization: required.
129 reason: required.
130 evidence: required.
131 checksum: required.
132 proof id: required.
133 plan id: required.
134 signal id: required.
135 intent id: required.
136 rank: required.
137 phase: required.
138 access: required.
139 type: required.
140 score: required.
141 confidence: required.
142 utility: required.
143 safety: required.
144 reachability: required.
145 ownership: required.
146 deterministic flag: required.
147 workflow syntax: required.
148 workflow regression: required.
149 workflow adversarial: required.
150 workflow double-run: required.
151 workflow exact-head: required.
152 workflow freshness: required.
153 workflow boundary guard: required.
154 workflow diff guard: required.
155 additive-only expectation: preserved.
156 no-deletion expectation: preserved.
157 source scope: gameplay context only.
158 test scope: opportunity scripts only.
159 docs scope: opportunity contracts only.
160 branch scope: dedicated feature branch.
161 merge scope: current main only.
162 stale history: forbidden.
163 synthetic merge: forbidden.
164 direct main writes: forbidden.
165 exact head: verified before merge.
166 mergeability: verified before merge.
167 diff budget: verified before merge.
168 CI status: reported honestly.
169 workflow failure: inspect before merge.
170 workflow success: confirm exact head.
171 post-merge state: verify closed and merged.
172 post-merge commit: record exact sha.
173 post-merge main: verify exact head movement.
174 release notes: summarize behavior.
175 release notes: summarize ownership.
176 release notes: summarize tests.
177 release notes: summarize diff.
178 release notes: summarize merge.
179 release notes: distinguish CI queued from green.
180 release notes: avoid unsupported claims.
181 code review: check imports.
182 code review: check bounds.
183 code review: check errors.
184 code review: check freeze.
185 code review: check replay.
186 code review: check ownership.
187 code review: check mobile limit.
188 code review: check desktop limit.
189 code review: check signals.
190 code review: check plans.
191 code review: check alternatives.
192 code review: check intent.
193 code review: check evidence.
194 code review: check proof.
195 code review: check reason coverage.
196 code review: check type coverage.
197 code review: check weather coverage.
198 code review: check phase coverage.
199 code review: check biome coverage.
200 failure-ledger-complete: boundary behavior is explicit.
