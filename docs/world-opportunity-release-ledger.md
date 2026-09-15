# Opportunity Release Verification Ledger
001 branch: feature branch starts from live main.
002 branch: no direct main writes.
003 branch: scope remains additive.
004 branch: scope remains world opportunity context.
005 runtime: policy added.
006 runtime: planner added.
007 runtime: evidence added.
008 tests: regression script added.
009 tests: adversarial script added.
010 docs: contract recorded.
011 docs: scenario matrix recorded.
012 docs: weather matrix recorded.
013 docs: time matrix recorded.
014 docs: biome matrix recorded.
015 docs: accessibility matrix recorded.
016 docs: replay matrix recorded.
017 docs: ownership matrix recorded.
018 docs: planner ledger recorded.
019 docs: evidence ledger recorded.
020 docs: failure ledger recorded.
021 docs: integration ledger recorded.
022 docs: QA ledger recorded.
023 CI: workflow added.
024 CI: exact head checked.
025 CI: current main checked.
026 CI: syntax checked.
027 CI: regression checked.
028 CI: adversarial checked.
029 CI: deterministic double-run checked.
030 CI: boundary checked.
031 CI: diff budget checked.
032 policy: twelve opportunity types covered.
033 policy: five weather branches covered.
034 policy: seven phases covered.
035 policy: multiple biome branches covered.
036 policy: explicit access states covered.
037 planner: six modes covered.
038 planner: bounded steps covered.
039 planner: bounded alternatives covered.
040 planner: route comparison covered.
041 planner: descriptive intent covered.
042 evidence: measurements covered.
043 evidence: decisions covered.
044 evidence: ownership covered.
045 evidence: determinism covered.
046 evidence: validation covered.
047 evidence: summary covered.
048 evidence: proof covered.
049 replay: seed stable.
050 replay: phase stable.
051 replay: weather stable.
052 replay: biome stable.
053 replay: distance stable.
054 replay: visibility stable.
055 replay: threat stable.
056 replay: friction stable.
057 replay: population stable.
058 replay: resources stable.
059 replay: patrol stable.
060 replay: mode stable.
061 replay: plan stable.
062 replay: evidence stable.
063 replay: proof stable.
064 boundaries: no actor spawn.
065 boundaries: no actor movement.
066 boundaries: no animation.
067 boundaries: no combat.
068 boundaries: no quest.
069 boundaries: no save.
070 boundaries: no scene mutation.
071 boundaries: no geometry mutation.
072 boundaries: no navmesh mutation.
073 boundaries: no road mutation.
074 boundaries: no hydrology mutation.
075 boundaries: no material mutation.
076 boundaries: no editor mutation.
077 boundaries: no event publish.
078 boundaries: no registry mutation.
079 boundaries: no random.
080 boundaries: no wall clock.
081 boundaries: no timer.
082 bounds: finite distance.
083 bounds: finite visibility.
084 bounds: finite threat.
085 bounds: finite friction.
086 bounds: finite population.
087 bounds: finite resources.
088 bounds: finite patrol.
089 bounds: finite score.
090 bounds: finite confidence.
091 bounds: finite utility.
092 bounds: finite safety.
093 bounds: finite reachability.
094 caps: candidates bounded.
095 caps: signals bounded.
096 caps: steps bounded.
097 caps: alternatives bounded.
098 freeze: context frozen.
099 freeze: snapshot frozen.
100 freeze: plan frozen.
101 freeze: evidence frozen.
102 freeze: proof frozen.
103 freeze: intent frozen.
104 errors: unsupported type explicit.
105 errors: malformed report validated.
106 errors: duplicate ids rejected.
107 errors: bad version rejected.
108 errors: bad ranges rejected.
109 errors: bad owner rejected.
110 errors: nondeterminism rejected.
111 weather: storm gates exposed output.
112 weather: fog reduces observation confidence.
113 weather: rain favors shelter.
114 weather: snow favors shelter.
115 weather: clear preserves neutral balance.
116 time: dawn watch.
117 time: morning resource.
118 time: midday trade.
119 time: afternoon route.
120 time: dusk watch.
121 time: evening social.
122 time: night quiet.
123 accessibility: mobile bounded subset.
124 accessibility: desktop bounded breadth.
125 accessibility: screen-reader textual rationale.
126 accessibility: low-motion no animation dependency.
127 accessibility: high-contrast numeric evidence.
128 accessibility: compact consumers may summarize.
129 ownership: external systems execute intent.
130 ownership: opportunity layer remains descriptive.
131 release: diff must be within configured budget.
132 release: deletions must remain zero.
133 release: current main must remain ancestor.
134 release: exact head must be merged.
135 release: PR must be mergeable.
136 release: workflow status must be checked.
137 release: CI pending is not green.
138 release: CI failure blocks confidence in verification.
139 release: post-merge PR state is verified.
140 release: post-merge main is verified.
141 release: merge commit is recorded.
142 report: feature summary is factual.
143 report: diff summary is factual.
144 report: test summary is factual.
145 report: CI summary is factual.
146 report: merge summary is factual.
147 report: no invented runtime behavior.
148 report: no invented CI success.
149 report: no stale-base claim.
150 release-ledger-complete: ready for exact-head comparison.
