# Opportunity Guardrail Ledger
001 guard: exact input is deterministic.
002 guard: normalized input is frozen.
003 guard: output is bounded.
004 guard: output is serializable.
005 guard: output is replayable.
006 guard: output is read-only.
007 guard: score is finite.
008 guard: confidence is finite.
009 guard: utility is finite.
010 guard: safety is finite.
011 guard: reachability is finite.
012 guard: distance is finite.
013 guard: candidate count is bounded.
014 guard: signal count is bounded.
015 guard: step count is bounded.
016 guard: alternative count is bounded.
017 guard: desktop limit is explicit.
018 guard: mobile limit is explicit.
019 guard: weather gate is explicit.
020 guard: phase is explicit.
021 guard: biome is explicit.
022 guard: access is explicit.
023 guard: rationale is explicit.
024 guard: owner is explicit.
025 guard: execution is explicitly false.
026 guard: landmark is supported.
027 guard: resource patch is supported.
028 guard: shelter is supported.
029 guard: trade window is supported.
030 guard: social gathering is supported.
031 guard: watch point is supported.
032 guard: route choice is supported.
033 guard: weather break is supported.
034 guard: quiet space is supported.
035 guard: danger edge is supported.
036 guard: craft window is supported.
037 guard: rest window is supported.
038 guard: clear weather is supported.
039 guard: rain weather is supported.
040 guard: snow weather is supported.
041 guard: fog weather is supported.
042 guard: storm weather is supported.
043 guard: night phase is supported.
044 guard: dawn phase is supported.
045 guard: morning phase is supported.
046 guard: midday phase is supported.
047 guard: afternoon phase is supported.
048 guard: dusk phase is supported.
049 guard: evening phase is supported.
050 guard: forest biome is supported.
051 guard: wetland biome is supported.
052 guard: mountain biome is supported.
053 guard: ridge biome is supported.
054 guard: plains biome is supported.
055 guard: road biome is supported.
056 guard: frontier biome is supported.
057 guard: cave biome is supported.
058 guard: mixed biome is supported.
059 guard: unknown biome is bounded.
060 guard: null input is bounded.
061 guard: empty input is bounded.
062 guard: undefined input is bounded.
063 guard: NaN input is bounded.
064 guard: Infinity input is bounded.
065 guard: negative input is bounded.
066 guard: huge input is bounded.
067 guard: unknown weather is bounded.
068 guard: unknown mode is bounded.
069 guard: unsupported type is explicit error.
070 guard: duplicate evidence is explicit error.
071 guard: bad version is explicit error.
072 guard: missing evidence is explicit error.
073 guard: invalid utility is explicit error.
074 guard: invalid confidence is explicit error.
075 guard: invalid safety is explicit error.
076 guard: invalid reachability is explicit error.
077 guard: invalid owner is explicit error.
078 guard: false deterministic flag is explicit error.
079 guard: empty evidence remains valid.
080 guard: empty plan remains valid.
081 guard: empty snapshot remains valid.
082 guard: stable hash is deterministic.
083 guard: tie ordering is deterministic.
084 guard: phase wrapping is deterministic.
085 guard: signal ids are deterministic.
086 guard: step ids are deterministic.
087 guard: intent ids are deterministic.
088 guard: proof ids are deterministic.
089 guard: checksums are deterministic.
090 guard: no Math.random.
091 guard: no Date.now.
092 guard: no setTimeout.
093 guard: no setInterval.
094 guard: no scene.add.
095 guard: no spawnNpc.
096 guard: no createNavMesh.
097 guard: no saveState.
098 guard: no quest mutation.
099 guard: no combat mutation.
100 guard: no terrain mutation.
101 guard: no road mutation.
102 guard: no hydrology mutation.
103 guard: no material mutation.
104 guard: no editor mutation.
105 guard: no event publication.
106 guard: no registry mutation.
107 guard: no actor movement.
108 guard: no animation start.
109 guard: no camera mutation.
110 guard: no renderer dependency.
111 guard: no three dependency.
112 guard: no filesystem dependency.
113 guard: no network dependency.
114 guard: no browser-global requirement.
115 guard: Node execution remains possible.
116 guard: CI execution remains possible.
117 guard: dry-run execution remains possible.
118 guard: replay execution remains possible.
119 guard: QA execution remains possible.
120 guard: mobile consumption remains possible.
121 guard: desktop consumption remains possible.
122 guard: screen-reader evidence remains textual.
123 guard: low-motion has no animation dependency.
124 guard: high-contrast preserves numeric evidence.
125 guard: compact consumers preserve identity.
126 guard: planner stays adapter-friendly.
127 guard: evidence stays adapter-friendly.
128 guard: proof stays adapter-friendly.
129 guard: intent stays adapter-friendly.
130 guard: execution owner remains external.
131 guard: current-main freshness remains required.
132 guard: exact-head checkout remains required.
133 guard: diff budget remains required.
134 guard: CI status remains reportable.
135 guard: merge uses exact head.
136 guard: post-merge state remains verifiable.
137 guard: no unsupported claim is released.
138 guard: no stale-base merge is released.
139 guard: no direct-main write is released.
140 guard: opportunity guardrails complete.
