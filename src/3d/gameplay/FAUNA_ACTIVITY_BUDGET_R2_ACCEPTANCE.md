# R2 Acceptance Records

01. Policy is deterministic.
02. Policy id is versioned.
03. Minimum budget is bounded.
04. Maximum budget is bounded.
05. Candidate input is capped.
06. Selected work is capped.
07. Ledger history is bounded.
08. Threat work has explicit priority.
09. Resource pressure affects resource work.
10. Reproduction pressure affects reproduction work.
11. Starvation receives fairness credit.
12. Stale work receives freshness credit.
13. Near LOD receives presentation credit.
14. Culled LOD remains representable.
15. Ambient work can be deprioritized.
16. Health can reduce noncritical work.
17. Low energy can reduce noncritical work.
18. Occluded distant work is penalized.
19. Settlement pressure affects ambient work.
20. Weather stress affects resource/rest work.
21. Global threat influences local scoring.
22. Unknown LOD normalizes safely.
23. Unknown kind normalizes safely.
24. Nonfinite threat normalizes safely.
25. Nonfinite energy normalizes safely.
26. Nonfinite health normalizes safely.
27. Negative ticks normalize safely.
28. Candidate ids have deterministic fallbacks.
29. Species labels normalize consistently.
30. Activity kind is part of stable ordering.
31. LOD is part of stable ordering.
32. Species is part of stable ordering.
33. Id is a final deterministic tiebreaker.
34. Stable hash avoids global randomness.
35. Seed participates in deterministic jitter.
36. Tick participates in deterministic jitter.
37. Reversed input preserves digest.
38. Repeated evaluation preserves result.
39. Digest includes selection identity.
40. Digest includes budget identity.
41. Digest includes context identity.
42. Deferred entries remain inspectable.
43. Selected entries expose rank.
44. Selected entries expose urgency.
45. Selected entries expose reason.
46. Selected entries expose estimated cost.
47. Selected entries expose seed key.
48. Summary exposes input count.
49. Summary exposes eligible count.
50. Summary exposes selected count.
51. Summary exposes deferred count.
52. Summary exposes average threat.
53. Summary exposes average deficit.
54. Summary exposes kind distribution.
55. Summary exposes LOD distribution.
56. Empty input is safe.
57. Null input is safe.
58. Oversized input is capped.
59. Oversized budget is capped.
60. Oversized selection is capped.
61. Ledger reset clears history.
62. Ledger reset clears tick.
63. Ledger disposal is fail-closed.
64. Disposed evaluation does not run scoring.
65. Replay returns one result per context.
66. Replay preserves context order.
67. Replay changes digest with tick changes.
68. Validation checks policy identity.
69. Validation checks tick domain.
70. Validation checks budget domain.
71. Validation checks selected array.
72. Validation checks deferred array.
73. Validation checks duplicate ids.
74. Validation checks kind membership.
75. Validation checks LOD membership.
76. Validation checks rank domain.
77. Acceptance runner executes 4096 direct cases.
78. Species axis contains eight entries.
79. LOD axis contains four entries.
80. Kind axis contains eight entries.
81. Threat axis contains eight levels.
82. Resource axis contains two states.
83. Axis product equals 4096.
84. Matrix partitions are deterministic.
85. Matrix IDs are four-digit identifiers.
86. Matrix IDs are unique.
87. Matrix IDs are ordered.
88. Matrix partition one covers 0000–1023.
89. Matrix partition two covers 1024–2047.
90. Matrix partition three covers 2048–2815.
91. Matrix partition four covers 2816–3583.
92. Production evaluator computes the missing axis combinations.
93. Edge acceptance covers malformed numeric inputs.
94. Edge acceptance covers unknown enum inputs.
95. Edge acceptance covers inactive candidates.
96. Edge acceptance covers ineligible candidates.
97. Edge acceptance covers duplicate candidate ids.
98. Edge acceptance covers oversized candidate arrays.
99. Edge acceptance covers oversized budgets.
100. Edge acceptance covers empty input.
101. CI performs syntax validation.
102. CI executes the repository acceptance runner.
103. CI reads only repository contents.
104. Workflow is scoped to R2 paths.
105. Documentation records ownership boundaries.
106. Ecology remains intent owner.
107. Encounter remains intent owner.
108. Navigation remains execution owner.
109. Physics remains execution owner.
110. Persistence remains state owner.
111. Asset loading remains asset owner.
112. Activity budget returns policy data only.
113. Policy result is immutable.
114. Candidate normalization is immutable.
115. Context normalization is immutable.
116. Policy helpers are exportable for focused tests.
117. Regression artifacts remain human inspectable.
118. No renderer dependency is introduced.
119. No global random source is introduced.
120. No actor construction is introduced.
121. No event dispatch is introduced.
122. No persistence write is introduced.
123. No navigation command is issued.
124. No physics mutation is issued.
125. R2 remains a bounded scheduling layer.
126. R2 remains compatible with existing fauna ownership.
127. R2 is fresh-main based for this turn.
128. R2 is ready for diff and ancestry verification.
