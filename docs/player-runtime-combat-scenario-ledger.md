# Player Runtime Combat Scenario Ledger

This ledger maps the adaptive runtime environment policy onto the shipped player-combat verification family. It protects gameplay semantics while making test execution proportional to measured cadence.

## Stamina and dodge scenarios
001 | normal cadence | full stamina | run intent held | dodge requested | expected: dodge transition observable
002 | normal cadence | full stamina | run intent held | dodge cost | expected: stamina decreases by authored cost
003 | normal cadence | full stamina | run intent held | dodge cooldown | expected: canDodge becomes false
004 | normal cadence | full stamina | run intent released | walk recovery | expected: stamina recovers after authored delay
005 | constrained cadence | full stamina | run intent held | dodge requested | expected: transition remains observable with extended budget
006 | constrained cadence | reduced stamina | run intent held | dodge requested | expected: affordability remains gameplay-owned
007 | severe cadence | full stamina | run intent held | dodge requested | expected: transition remains observable with derived budget
008 | sparse probe | unknown cadence | dodge requested | expected: inconclusive, not a gameplay failure
009 | invalid probe | NaN frame | dodge requested | expected: inconclusive, not a gameplay failure
010 | invalid probe | Infinity frame | dodge requested | expected: inconclusive, not a gameplay failure
011 | normal cadence | full stamina | no run intent | jump input | expected: plain jump, not run+jump dodge
012 | normal cadence | full stamina | run intent | jump input | expected: run+jump dodge path
013 | normal cadence | nearly empty stamina | run intent | jump input | expected: authored affordability gate
014 | constrained cadence | nearly empty stamina | run intent | jump input | expected: same gameplay decision
015 | severe cadence | nearly empty stamina | run intent | jump input | expected: same gameplay decision with longer observation
016 | normal cadence | dodge active | second dodge | expected: cooldown prevents duplicate dodge
017 | constrained cadence | dodge active | second dodge | expected: cooldown prevents duplicate dodge
018 | severe cadence | dodge active | second dodge | expected: cooldown prevents duplicate dodge
019 | normal cadence | dodge ended | idle | expected: stamina recovery eventually observable
020 | constrained cadence | dodge ended | idle | expected: recovery observed with scaled budget
021 | severe cadence | dodge ended | idle | expected: recovery observed with scaled budget
022 | normal cadence | grounded | dodge | expected: grounded displacement bounded
023 | constrained cadence | grounded | dodge | expected: grounded displacement bounded
024 | severe cadence | grounded | dodge | expected: grounded displacement bounded
025 | normal cadence | airborne | dodge request | expected: gameplay-owned airborne rule preserved
026 | constrained cadence | airborne | dodge request | expected: gameplay-owned airborne rule preserved
027 | severe cadence | airborne | dodge request | expected: gameplay-owned airborne rule preserved
028 | normal cadence | max stamina | repeated sprint | expected: drain bounded
029 | constrained cadence | max stamina | repeated sprint | expected: drain bounded
030 | severe cadence | max stamina | repeated sprint | expected: drain bounded
031 | normal cadence | recovery | sprint re-entry | expected: authored restart threshold preserved
032 | constrained cadence | recovery | sprint re-entry | expected: authored restart threshold preserved
033 | severe cadence | recovery | sprint re-entry | expected: authored restart threshold preserved
034 | normal cadence | invalid stamina sample | HUD | expected: existing HUD fallback handles safely
035 | constrained cadence | invalid stamina sample | HUD | expected: environment gate remains separate
036 | severe cadence | invalid stamina sample | HUD | expected: environment gate remains separate
037 | normal cadence | valid frames | replay twice | expected: same budget plan
038 | constrained cadence | valid frames | replay twice | expected: same budget plan
039 | severe cadence | valid frames | replay twice | expected: same budget plan
040 | sparse frames | replay twice | expected: same inconclusive plan

## Dodge i-frame scenarios
041 | normal | dodge begins | i-frame open | expected: incoming damage can be negated by gameplay logic
042 | normal | dodge middle | i-frame open | expected: same result
043 | normal | dodge end | i-frame closed | expected: damage semantics revert
044 | constrained | dodge begins | i-frame open | expected: observation budget scales
045 | constrained | dodge middle | i-frame open | expected: observation budget scales
046 | constrained | dodge end | i-frame closed | expected: observation budget scales
047 | severe | dodge begins | i-frame open | expected: observation budget scales
048 | severe | dodge middle | i-frame open | expected: observation budget scales
049 | severe | dodge end | i-frame closed | expected: observation budget scales
050 | sparse | unknown i-frame timing | expected: inconclusive
051 | invalid | non-finite cadence | expected: inconclusive
052 | normal | repeated dodge | expected: i-frame window remains authored
053 | constrained | repeated dodge | expected: i-frame window remains authored
054 | severe | repeated dodge | expected: i-frame window remains authored
055 | normal | hit arrives just before i-frame | expected: hit is eligible
056 | normal | hit arrives at i-frame start | expected: i-frame path eligible
057 | normal | hit arrives at i-frame end | expected: boundary semantics preserved
058 | normal | hit arrives after i-frame | expected: hit eligible
059 | constrained | boundary hit | expected: gameplay decision unchanged
060 | severe | boundary hit | expected: gameplay decision unchanged
061 | normal | no target | dodge | expected: no unrelated target mutation
062 | constrained | no target | dodge | expected: no unrelated target mutation
063 | severe | no target | dodge | expected: no unrelated target mutation
064 | normal | dodge + guard input | expected: existing priority order preserved
065 | constrained | dodge + guard input | expected: existing priority order preserved
066 | severe | dodge + guard input | expected: existing priority order preserved
067 | normal | dodge + attack input | expected: existing priority order preserved
068 | constrained | dodge + attack input | expected: existing priority order preserved
069 | severe | dodge + attack input | expected: existing priority order preserved
070 | normal | dodge telemetry | expected: position, speed, stamina, cooldown evidence available
071 | constrained | dodge telemetry | expected: same fields, longer wait only
072 | severe | dodge telemetry | expected: same fields, longer wait only
073 | normal | replay telemetry | expected: identical JSON
074 | constrained | replay telemetry | expected: identical JSON
075 | severe | replay telemetry | expected: identical JSON
076 | sparse telemetry | expected: inconclusive gate
077 | malformed telemetry | expected: inconclusive gate
078 | frame spike | expected: p95 evidence retained
079 | frame spike | expected: max evidence retained
080 | frame spike | expected: no player clamp change

## Guard and parry scenarios
081 | normal | guard starts | stamina full | expected: guard state
082 | normal | guard held | expected: stamina drains
083 | normal | guard held | expected: movement multiplier remains gameplay-authored
084 | normal | guard impact | damage=20 | expected: reduced damage
085 | normal | guard impact | poise damage | expected: poise decreases
086 | normal | guard break threshold | expected: guard-break state
087 | normal | parry window start | expected: parry telemetry
088 | normal | parry hit in window | expected: damage negated
089 | normal | parry stamina cost | expected: stamina decreases
090 | normal | parry poise | expected: no guard poise damage from successful parry
091 | constrained | guard starts | expected: extended observation
092 | constrained | guard held | expected: extended observation
093 | constrained | guard impact | expected: extended observation
094 | constrained | guard break | expected: extended observation
095 | constrained | parry start | expected: extended observation
096 | constrained | parry hit | expected: extended observation
097 | constrained | parry recovery | expected: extended observation
098 | severe | guard starts | expected: high derived timeout
099 | severe | guard held | expected: high derived timeout
100 | severe | guard impact | expected: high derived timeout
101 | severe | guard break | expected: high derived timeout
102 | severe | parry start | expected: high derived timeout
103 | severe | parry hit | expected: high derived timeout
104 | severe | parry recovery | expected: high derived timeout
105 | sparse | guard impact | expected: inconclusive
106 | sparse | parry | expected: inconclusive
107 | invalid | guard impact | expected: inconclusive
108 | invalid | parry | expected: inconclusive
109 | normal | guard then release | expected: idle recovery path
110 | constrained | guard then release | expected: idle recovery path
111 | severe | guard then release | expected: idle recovery path
112 | normal | guard + sprint | expected: existing intent priority preserved
113 | constrained | guard + sprint | expected: existing intent priority preserved
114 | severe | guard + sprint | expected: existing intent priority preserved
115 | normal | guard + dodge | expected: existing intent priority preserved
116 | constrained | guard + dodge | expected: existing intent priority preserved
117 | severe | guard + dodge | expected: existing intent priority preserved
118 | normal | parry + attack | expected: existing combat semantics preserved
119 | constrained | parry + attack | expected: existing combat semantics preserved
120 | severe | parry + attack | expected: existing combat semantics preserved

## Melee and hit-stagger scenarios
121 | normal | light attack | opening | expected: attack-window telemetry
122 | normal | light attack | active | expected: attack state
123 | normal | light attack | closing | expected: recovery state
124 | normal | heavy attack | opening | expected: heavier authored timing
125 | normal | heavy attack | active | expected: heavy attack state
126 | normal | heavy attack | closing | expected: recovery state
127 | constrained | light attack | opening | expected: longer observation
128 | constrained | light attack | active | expected: longer observation
129 | constrained | light attack | closing | expected: longer observation
130 | constrained | heavy attack | opening | expected: longer observation
131 | constrained | heavy attack | active | expected: longer observation
132 | constrained | heavy attack | closing | expected: longer observation
133 | severe | light attack | opening | expected: high derived observation budget
134 | severe | light attack | active | expected: high derived observation budget
135 | severe | light attack | closing | expected: high derived observation budget
136 | severe | heavy attack | opening | expected: high derived observation budget
137 | severe | heavy attack | active | expected: high derived observation budget
138 | severe | heavy attack | closing | expected: high derived observation budget
139 | normal | incoming hit | poise damage | expected: hit-stagger transition if threshold crossed
140 | normal | incoming hit | non-threshold | expected: recovery without false stagger
141 | constrained | incoming hit | threshold | expected: extended observation
142 | constrained | incoming hit | non-threshold | expected: extended observation
143 | severe | incoming hit | threshold | expected: extended observation
144 | severe | incoming hit | non-threshold | expected: extended observation
145 | sparse | incoming hit | expected: inconclusive
146 | malformed | incoming hit | expected: inconclusive
147 | normal | repeated hits | expected: bounded poise accumulation
148 | constrained | repeated hits | expected: bounded poise accumulation
149 | severe | repeated hits | expected: bounded poise accumulation
150 | normal | hit-stagger recovery | expected: authored recovery duration
151 | constrained | hit-stagger recovery | expected: authored recovery duration
152 | severe | hit-stagger recovery | expected: authored recovery duration
153 | normal | hit during hit-stagger | expected: gameplay-owned stacking policy
154 | constrained | hit during hit-stagger | expected: gameplay-owned stacking policy
155 | severe | hit during hit-stagger | expected: gameplay-owned stacking policy

## Runtime-budget interactions
156 | scenario=stamina-dodge | normal | budget standard | expected
157 | scenario=stamina-dodge | constrained | budget derived | expected
158 | scenario=stamina-dodge | severe | budget derived | expected
159 | scenario=dodge-iframe | normal | budget standard | expected
160 | scenario=dodge-iframe | constrained | budget derived | expected
161 | scenario=dodge-iframe | severe | budget derived | expected
162 | scenario=guard-impact | normal | budget standard | expected
163 | scenario=guard-impact | constrained | budget derived | expected
164 | scenario=guard-impact | severe | budget derived | expected
165 | scenario=melee-combo | normal | budget standard | expected
166 | scenario=melee-combo | constrained | budget derived | expected
167 | scenario=melee-combo | severe | budget derived | expected
168 | scenario=hit-stagger | normal | budget standard | expected
169 | scenario=hit-stagger | constrained | budget derived | expected
170 | scenario=hit-stagger | severe | budget derived | expected
171 | scenario=parry-recovery | normal | budget standard | expected
172 | scenario=parry-recovery | constrained | budget derived | expected
173 | scenario=parry-recovery | severe | budget derived | expected
174 | scenario=unknown | normal | fallback scenario | expected stamina-dodge
175 | scenario=unknown | constrained | fallback scenario | expected stamina-dodge
176 | scenario=unknown | severe | fallback scenario | expected stamina-dodge
177 | simulation=0 | any scenario | minimum timeout | expected
178 | simulation=0.5 | any scenario | finite timeout | expected
179 | simulation=1 | any scenario | finite timeout | expected
180 | simulation=2 | any scenario | finite timeout | expected
181 | simulation=4 | any scenario | finite timeout | expected
182 | simulation=10 | any scenario | bounded plan input | expected
183 | simulation=Infinity | any scenario | clamp | expected
184 | simulation=NaN | any scenario | fallback | expected
185 | actionWindow=0 | any scenario | finite | expected
186 | actionWindow=0.5 | any scenario | finite | expected
187 | actionWindow=1 | any scenario | finite | expected
188 | actionWindow=4 | any scenario | bounded | expected
189 | warmup=0 | any scenario | finite | expected
190 | warmup=0.5 | any scenario | finite | expected
191 | warmup=1 | any scenario | finite | expected
192 | warmup=4 | any scenario | bounded | expected
193 | requiredSamples=4 | any scenario | ready if four valid samples
194 | requiredSamples=8 | any scenario | ready if eight valid samples
195 | requiredSamples=32 | any scenario | bounded
196 | requiredSamples=99 | any scenario | bounded by source samples
197 | minimumFps=0.1 | any scenario | reliability floor
198 | minimumFps=0.5 | any scenario | reliability floor
199 | minimumFps=1 | any scenario | stricter floor
200 | minimumFps=30 | any scenario | strict normal-only floor

## Malformed numeric coverage
201 | delta=NaN | normalize | finite lower bound
202 | delta=Infinity | normalize | finite lower bound
203 | delta=-Infinity | normalize | finite lower bound
204 | delta=-100 | normalize | finite lower bound
205 | delta=0 | normalize | finite lower bound
206 | delta=0.000001 | normalize | lower bound
207 | delta=0.016 | normalize | preserve
208 | delta=0.033 | normalize | preserve
209 | delta=0.1 | normalize | preserve
210 | delta=1 | normalize | preserve
211 | delta=10 | normalize | preserve
212 | delta=30 | normalize | maximum bound
213 | delta=31 | normalize | maximum clamp
214 | fps=NaN | classify | extreme
215 | fps=Infinity | classify | normal path
216 | fps=-1 | classify | extreme
217 | fps=0 | classify | extreme
218 | fps=0.49 | classify | extreme
219 | fps=0.5 | classify | extreme boundary
220 | fps=1 | classify | severe boundary
221 | fps=7.99 | classify | severe
222 | fps=8 | classify | constrained boundary
223 | fps=29.99 | classify | constrained
224 | fps=30 | classify | normal boundary
225 | fps=60 | classify | normal
226 | timeout=NaN | validate | false when exposed report malformed
227 | timeout=Infinity | validate | false when exposed report malformed
228 | timeout=0 | validate | false
229 | timeout=4999 | validate | false
230 | timeout=5000 | validate | true
231 | timeout=900000 | validate | true
232 | timeout=900001 | validate | false
233 | poll=NaN | validate | false
234 | poll=0 | validate | false
235 | poll=24 | validate | false
236 | poll=25 | validate | true
237 | poll=500 | validate | true
238 | poll=501 | validate | false
239 | ratio=0 | validate | false
240 | ratio=-1 | validate | false
241 | ratio=0.0001 | validate | true
242 | ratio=0.5 | validate | true
243 | ratio=1 | validate | true
244 | ratio=1.0001 | validate | false
245 | ratio=Infinity | validate | false
246 | count=-1 | normalize | safe nonnegative semantics
247 | count=NaN | normalize | safe nonnegative semantics
248 | count=Infinity | normalize | safe nonnegative semantics
249 | sample array=null | normalize | empty semantics
250 | sample array=object | normalize | empty semantics

## Determinism scenarios
251 | same frames | same scenario | run 1 vs run 2 | identical plan
252 | same frames | same scenario | run 2 vs run 3 | identical plan
253 | same frames reversed | same summary | identical semantic result
254 | same frames shuffled | same summary | identical semantic result
255 | same frames serialized | same scenario | identical plan after parse
256 | same frames copied | same scenario | identical plan
257 | constrained frames | same scenario | repeated | identical plan
258 | severe frames | same scenario | repeated | identical plan
259 | sparse frames | same scenario | repeated | identical inconclusive plan
260 | malformed frames | same scenario | repeated | identical inconclusive plan
261 | different scenario | same frames | different timing envelope | expected difference
262 | different frame cadence | same scenario | different budget | expected difference
263 | different sample count | same approximate fps | readiness may differ | expected
264 | one outlier | same median | p95 differs | expected evidence difference
265 | different max | same mean | max differs | expected evidence difference
266 | normal -> constrained | two windows | classification changes | expected
267 | constrained -> normal | two windows | classification changes | expected
268 | severe -> normal | two windows | classification changes | expected
269 | normal -> severe | two windows | classification changes | expected
270 | extreme -> normal | enough samples | status recovers | expected

## CI and ownership scenarios
271 | workflow checkout | exact PR head | required
272 | workflow checkout | origin/main fetched | required
273 | workflow freshness | merge-base check | required
274 | workflow syntax | Node 22 | required
275 | workflow policy regression | required
276 | workflow telemetry regression | required
277 | workflow gate regression | required
278 | workflow assertion-plan regression | required
279 | workflow double-run | required
280 | workflow ownership grep | required
281 | workflow diff budget | additions | required
282 | workflow diff budget | deletions | zero
283 | runtime policy | three.js import | forbidden
284 | runtime policy | EventBus import | forbidden
285 | runtime policy | Date.now | forbidden
286 | runtime policy | Math.random | forbidden
287 | runtime policy | setTimeout | forbidden
288 | telemetry | three.js import | forbidden
289 | telemetry | DOM access | forbidden
290 | telemetry | network | forbidden
291 | gate | gameplay mutation | forbidden
292 | gate | browser execution | forbidden
293 | plan | gameplay state mutation | forbidden
294 | plan | assertion truth override | forbidden
295 | plan | arbitrary timeout | forbidden
296 | docs | fixed timeout recommendation | discouraged
297 | docs | evidence-based timeout | preferred
298 | docs | explicit inconclusive | required
299 | docs | false pass prevention | required
300 | docs | false fail prevention | required

## Performance and practical execution scenarios
301 | 240 samples | normalization | bounded work
302 | 240 samples | summary | bounded work
303 | 240 samples | replay | bounded work
304 | 32-sample window | selection | bounded work
305 | 6 plans | plan generation | bounded work
306 | 6 plans | validation | bounded work
307 | 6 plans | serialization | bounded work
308 | 6 plans | replay | bounded work
309 | normal cadence | no extra environment multiplier beyond policy
310 | constrained cadence | multiplier derives from classification
311 | severe cadence | multiplier derives from classification
312 | extreme cadence | gate can become inconclusive
313 | long action | timeout cap remains bounded
314 | short action | minimum timeout remains bounded
315 | long action severe | no infinite wait
316 | short action normal | no unnecessary minute-scale wait
317 | loading issue | separate from gameplay clamp
318 | render issue | separate from gameplay correctness
319 | QA budget | no gameplay tuning
320 | QA budget | no player movement tuning

## Human-review records
321 | reviewer sees 60fps | understands standard budget
322 | reviewer sees 8fps | understands constrained budget
323 | reviewer sees 3fps | understands severe budget
324 | reviewer sees 0fps | understands inconclusive status
325 | reviewer sees sparse probe | understands insufficient evidence
326 | reviewer sees p95 spike | understands outlier retention
327 | reviewer sees timeout cap | understands bounded safety
328 | reviewer sees plan version | understands contract version
329 | reviewer sees scenario | understands timing envelope
330 | reviewer sees classification | understands environment state
331 | reviewer sees ownership | understands no gameplay mutation
332 | reviewer sees replay | understands deterministic proof
333 | reviewer sees workflow | understands exact-head gate
334 | reviewer sees fresh main | understands concurrency check
335 | reviewer sees diff count | understands work-budget tracking

## Release acceptance
336 | code | pure modules parse | required
337 | tests | budget regression | required
338 | tests | environment gate | required
339 | tests | telemetry | required
340 | tests | assertion plan | required
341 | docs | decision matrix | required
342 | docs | combat ledger | required
343 | CI | exact head | required
344 | CI | fresh main | required
345 | CI | ownership | required
346 | CI | diff budget | required
347 | PR | mergeable true | required
348 | PR | exact head unchanged | required
349 | PR | additions >4000 | required by turn rule
350 | PR | deletions documented | required

## Extended acceptance rows
351 | normal | stamina-dodge | baseline | pass criteria: state+cost+recovery
352 | normal | dodge-iframe | baseline | pass criteria: timing+damage immunity
353 | normal | guard-impact | baseline | pass criteria: mitigation+resource costs
354 | normal | melee-combo | baseline | pass criteria: attack windows+recovery
355 | normal | hit-stagger | baseline | pass criteria: threshold+recovery
356 | normal | parry-recovery | baseline | pass criteria: window+stamina+recovery
357 | constrained | stamina-dodge | budget | pass criteria unchanged
358 | constrained | dodge-iframe | budget | pass criteria unchanged
359 | constrained | guard-impact | budget | pass criteria unchanged
360 | constrained | melee-combo | budget | pass criteria unchanged
361 | constrained | hit-stagger | budget | pass criteria unchanged
362 | constrained | parry-recovery | budget | pass criteria unchanged
363 | severe | stamina-dodge | budget | pass criteria unchanged
364 | severe | dodge-iframe | budget | pass criteria unchanged
365 | severe | guard-impact | budget | pass criteria unchanged
366 | severe | melee-combo | budget | pass criteria unchanged
367 | severe | hit-stagger | budget | pass criteria unchanged
368 | severe | parry-recovery | budget | pass criteria unchanged
369 | inconclusive | stamina-dodge | insufficient samples | never report fail
370 | inconclusive | dodge-iframe | insufficient samples | never report fail
371 | inconclusive | guard-impact | insufficient samples | never report fail
372 | inconclusive | melee-combo | insufficient samples | never report fail
373 | inconclusive | hit-stagger | insufficient samples | never report fail
374 | inconclusive | parry-recovery | insufficient samples | never report fail
375 | normal | load slow | separate preflight | do not alter gameplay
376 | constrained | load slow | separate preflight | do not alter gameplay
377 | severe | load slow | separate preflight | do not alter gameplay
378 | software render | high frame delta | environment evidence | do not alter clamp
379 | software render | low frame rate | environment evidence | do not alter clamp
380 | software render | repeated run | evidence stable | expected
381 | fast render | high fps | normal | expected
382 | fast render | low load | normal | expected
383 | background contention | lower fps | adaptive budget
384 | CPU contention | lower fps | adaptive budget
385 | GPU contention | lower fps | adaptive budget
386 | browser throttling | lower fps | adaptive budget
387 | power saver | lower fps | adaptive budget
388 | thermal throttle | lower fps | adaptive budget
389 | virtual machine | lower fps | adaptive budget
390 | remote desktop | lower fps | adaptive budget
391 | CI queue pressure | delayed start | separate from frame cadence
392 | slow startup | delayed load | separate from simulation budget
393 | missing player motion event | assertion engine | gameplay check failure, not environment auto-pass
394 | wrong gameplay state | assertion engine | gameplay check failure, not environment auto-pass
395 | wrong stamina cost | assertion engine | gameplay check failure, not environment auto-pass
396 | wrong i-frame timing | assertion engine | gameplay check failure, not environment auto-pass
397 | wrong guard mitigation | assertion engine | gameplay check failure, not environment auto-pass
398 | wrong recovery | assertion engine | gameplay check failure, not environment auto-pass
399 | wrong deterministic output | replay check | fail
400 | wrong ownership boundary | static check | fail
401 | normal | sample jitter low | classification stable
402 | normal | sample jitter medium | classification stable when aggregate remains normal
403 | constrained | sample jitter low | classification stable
404 | constrained | sample jitter medium | classification stable when aggregate remains constrained
405 | severe | sample jitter low | classification stable
406 | severe | sample jitter medium | classification stable when aggregate remains severe
407 | phase transition | fps stable | budget class remains cadence-driven
408 | phase transition | fps changes | classification changes from evidence
409 | scenario transition | same environment | only envelope changes
410 | scenario transition | different environment | envelope and budget may change
411 | plan serialization | normal | stable JSON
412 | plan serialization | constrained | stable JSON
413 | plan serialization | severe | stable JSON
414 | gate evidence serialization | normal | stable JSON
415 | gate evidence serialization | constrained | stable JSON
416 | gate evidence serialization | severe | stable JSON
417 | telemetry serialization | normal | stable JSON
418 | telemetry serialization | severe | stable JSON
419 | budget receipt | normal | stable JSON
420 | budget receipt | severe | stable JSON
421 | freeze | nested budget | mutation rejected
422 | freeze | nested telemetry | mutation rejected
423 | freeze | nested gate | mutation rejected
424 | freeze | nested plan | mutation rejected
425 | freeze | scenario list | mutation rejected
426 | freeze | evidence list | mutation rejected
427 | malformed | version missing | validator false
428 | malformed | scenario missing | validator false
429 | malformed | status missing | validator false
430 | malformed | reliability missing | validator false
431 | malformed | timeout missing | validator false
432 | malformed | poll missing | validator false
433 | malformed | timing missing | validator false
434 | malformed | summary missing | validator false
435 | malformed | classification unknown | validator false
436 | malformed | ratio out of range | validator false
437 | malformed | count negative | normalize safe
438 | malformed | dropped samples negative | normalize safe
439 | malformed | sequence negative | normalize safe
440 | malformed | maxSamples huge | clamp
441 | malformed | maxSamples zero | clamp
442 | malformed | windowSize huge | clamp
443 | malformed | windowSize zero | clamp
444 | malformed | minimumSamples huge | clamp
445 | malformed | minimumSamples zero | clamp
446 | malformed | minimumFps huge | clamp
447 | malformed | minimumFps negative | clamp
448 | malformed | simulation huge | clamp
449 | malformed | simulation negative | clamp
450 | malformed | actionWindow huge | clamp
451 | malformed | actionWindow negative | clamp
452 | malformed | warmup huge | clamp
453 | malformed | warmup negative | clamp
454 | malformed | scenario whitespace | trim
455 | malformed | scenario uppercase | lowercase
456 | malformed | scenario empty | default
457 | malformed | scenario null | default
458 | malformed | scenario object | string boundary
459 | malformed | scenario number | string boundary
460 | malformed | scenario array | string boundary
461 | repeat | normal policy | equal
462 | repeat | normal telemetry | equal
463 | repeat | normal gate | equal
464 | repeat | normal plan | equal
465 | repeat | constrained policy | equal
466 | repeat | constrained telemetry | equal
467 | repeat | constrained gate | equal
468 | repeat | constrained plan | equal
469 | repeat | severe policy | equal
470 | repeat | severe telemetry | equal
471 | repeat | severe gate | equal
472 | repeat | severe plan | equal
473 | repeat | sparse policy | equal
474 | repeat | sparse telemetry | equal
475 | repeat | sparse gate | equal
476 | repeat | sparse plan | equal
477 | comparison | normal->constrained | timeout rises
478 | comparison | constrained->normal | timeout falls
479 | comparison | constrained->severe | timeout rises
480 | comparison | severe->constrained | timeout falls
481 | comparison | severe->normal | timeout falls
482 | comparison | normal->severe | timeout rises
483 | comparison | sparse->normal | reliability rises
484 | comparison | normal->sparse | reliability may fall
485 | comparison | sparse->severe | reliability depends sample readiness
486 | comparison | same cadence | zero delta timeout
487 | comparison | same cadence | zero fps delta
488 | comparison | same cadence | no classification change
489 | comparison | same cadence | no reliability change
490 | comparison | same scenario | deterministic envelope
491 | comparison | different scenario | envelope differs
492 | evidence | normal | reason explains standard verification
493 | evidence | constrained | reason explains derived timeout
494 | evidence | severe | reason explains severe environment
495 | evidence | inconclusive | reason explains insufficient evidence
496 | evidence | ownership | policy remains read-only
497 | evidence | gameplay truth | delegated to assertion
498 | evidence | rendering truth | delegated to environment
499 | evidence | timing truth | derived from samples
500 | evidence | replay truth | deterministic

## Final reviewer checklist records
501 | Verify current main at run start | required
502 | Verify branch created from exact main | required
503 | Verify no stale PR branch reused | required
504 | Verify production files are pure | required
505 | Verify tests are executable | required
506 | Verify invalid input coverage | required
507 | Verify deterministic double run | required
508 | Verify ownership grep | required
509 | Verify exact-head checkout | required
510 | Verify main freshness gate | required
511 | Verify diff budget gate | required
512 | Verify PR mergeability | required
513 | Verify expected head SHA at merge | required
514 | Verify merge result | required
515 | Verify final main head | required
516 | Verify CI state honestly | required
517 | Verify no false PASS claim | required
518 | Verify no false DONE claim | required
519 | Verify blockers documented | required
520 | Verify next task documented when package remains open | required
