# Opportunity QA Ledger
001 syntax: policy parses.
002 syntax: planner parses.
003 syntax: evidence parses.
004 syntax: system regression parses.
005 syntax: adversarial regression parses.
006 import: policy resolves.
007 import: planner resolves.
008 import: evidence resolves.
009 export: policy vocabulary resolves.
010 export: planner API resolves.
011 export: evidence API resolves.
012 regression: clear weather passes.
013 regression: storm weather passes.
014 regression: hidden visibility passes.
015 regression: deterministic repeat passes.
016 regression: route comparison passes.
017 regression: intent creation passes.
018 regression: evidence validation passes.
019 regression: proof creation passes.
020 adversarial: empty input passes.
021 adversarial: null input passes.
022 adversarial: negative distance passes.
023 adversarial: huge distance passes.
024 adversarial: NaN visibility passes.
025 adversarial: Infinity threat passes.
026 adversarial: extreme friction passes.
027 adversarial: unknown weather passes.
028 adversarial: unknown biome passes.
029 adversarial: negative clock passes.
030 adversarial: huge clock passes.
031 replay: same input same output.
032 replay: same input same proof.
033 replay: same input same ids.
034 replay: same input same ordering.
035 replay: same input same checksum.
036 replay: equivalent clock same phase.
037 replay: equivalent context stable.
038 replay: weather branch stable.
039 replay: biome branch stable.
040 replay: mode branch stable.
041 bounds: distance finite.
042 bounds: visibility finite.
043 bounds: threat finite.
044 bounds: friction finite.
045 bounds: population finite.
046 bounds: resources finite.
047 bounds: patrol finite.
048 bounds: slope finite.
049 bounds: moisture finite.
050 bounds: score finite.
051 bounds: confidence finite.
052 bounds: utility finite.
053 bounds: safety finite.
054 bounds: reachability finite.
055 bounds: rank finite.
056 caps: candidates bounded.
057 caps: signals bounded.
058 caps: steps bounded.
059 caps: alternatives bounded.
060 caps: desktop bounded.
061 caps: mobile bounded.
062 ownership: no scene mutation.
063 ownership: no three import.
064 ownership: no spawn.
065 ownership: no navmesh creation.
066 ownership: no save.
067 ownership: no quest mutation.
068 ownership: no combat mutation.
069 ownership: no timer.
070 ownership: no random.
071 ownership: no wall clock.
072 ownership: no road mutation.
073 ownership: no hydrology mutation.
074 ownership: no material mutation.
075 ownership: no editor mutation.
076 ownership: no registry mutation.
077 ownership: no event publication.
078 freeze: policy frozen.
079 freeze: context frozen.
080 freeze: snapshot frozen.
081 freeze: plan frozen.
082 freeze: evidence frozen.
083 freeze: proof frozen.
084 freeze: intent frozen.
085 validation: duplicate id rejected.
086 validation: invalid version rejected.
087 validation: missing evidence rejected.
088 validation: invalid utility rejected.
089 validation: invalid confidence rejected.
090 validation: invalid safety rejected.
091 validation: invalid reachability rejected.
092 validation: invalid owner rejected.
093 validation: false deterministic rejected.
094 summary: count exact.
095 summary: mean confidence stable.
096 summary: strongest stable.
097 proof: validity mirrors validator.
098 proof: checksum stable.
099 proof: proof id stable.
100 proof: summary stable.
101 policy: landmark covered.
102 policy: resource covered.
103 policy: shelter covered.
104 policy: trade covered.
105 policy: social covered.
106 policy: watch covered.
107 policy: route covered.
108 policy: weather-break covered.
109 policy: quiet covered.
110 policy: danger covered.
111 policy: craft covered.
112 policy: rest covered.
113 weather: clear covered.
114 weather: rain covered.
115 weather: snow covered.
116 weather: fog covered.
117 weather: storm covered.
118 phase: night covered.
119 phase: dawn covered.
120 phase: morning covered.
121 phase: midday covered.
122 phase: afternoon covered.
123 phase: dusk covered.
124 phase: evening covered.
125 biome: forest covered.
126 biome: wetland covered.
127 biome: mountain covered.
128 biome: ridge covered.
129 biome: plains covered.
130 biome: road covered.
131 biome: frontier covered.
132 biome: cave covered.
133 biome: mixed covered.
134 biome: unknown covered.
135 mode: discover covered.
136 mode: approach covered.
137 mode: compare covered.
138 mode: retreat covered.
139 mode: shelter covered.
140 mode: observe covered.
141 access: visible covered.
142 access: nearby covered.
143 access: approach covered.
144 access: weather-gated covered.
145 mobile: deterministic subset.
146 desktop: deterministic subset.
147 screen-reader: textual evidence.
148 low-motion: no animation dependency.
149 high-contrast: numeric evidence.
150 compact: bounded surface.
151 intent: default selection.
152 intent: explicit selection.
153 intent: external owner.
154 intent: no execution.
155 compare: primary winner.
156 compare: secondary winner.
157 compare: tie.
158 compare: no route mutation.
159 planner: discover utility.
160 planner: approach utility.
161 planner: retreat utility.
162 planner: shelter utility.
163 planner: observe utility.
164 planner: compare utility.
165 evidence: measurements.
166 evidence: decision.
167 evidence: ownership.
168 evidence: determinism.
169 proof: checksum.
170 proof: validity.
171 proof: summary.
172 proof: id.
173 CI: exact head.
174 CI: current main freshness.
175 CI: syntax.
176 CI: regression.
177 CI: adversarial.
178 CI: double-run.
179 CI: boundary guard.
180 CI: diff budget.
181 release: additive scope.
182 release: no deletion expectation.
183 release: docs scoped.
184 release: tests scoped.
185 release: workflow scoped.
186 release: branch isolated.
187 merge: current main base.
188 merge: exact head.
189 merge: mergeability.
190 merge: CI status.
191 post-merge: PR closed.
192 post-merge: merged true.
193 post-merge: merge commit recorded.
194 post-merge: main verified.
195 report: diff count recorded.
196 report: features recorded.
197 report: tests recorded.
198 report: CI state honest.
199 report: no unsupported claims.
200 qa-complete: release gate is explicit.
