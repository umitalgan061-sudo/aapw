# Player Runtime Environment Decision Matrix

This matrix records concrete runtime-verification decisions for the adaptive budget layer. Each row represents a distinct observation envelope and an expected verification action. The matrix exists so timeout changes remain evidence-driven rather than arbitrary.

## Cadence and evidence dimensions

001 | 60fps | stable 4-sample window | normal | execute with standard budget
002 | 58fps | stable 8-sample window | normal | execute with standard budget
003 | 55fps | stable 12-sample window | normal | execute with standard budget
004 | 50fps | stable 16-sample window | normal | execute with standard budget
005 | 45fps | stable 20-sample window | normal | execute with standard budget
006 | 40fps | stable 24-sample window | normal | execute with standard budget
007 | 35fps | stable 32-sample window | normal | execute with standard budget
008 | 30fps | stable 32-sample window | normal | execute with standard budget
009 | 29fps | stable 8-sample window | constrained | derive extended budget
010 | 28fps | stable 8-sample window | constrained | derive extended budget
011 | 25fps | stable 8-sample window | constrained | derive extended budget
012 | 22fps | stable 8-sample window | constrained | derive extended budget
013 | 18fps | stable 8-sample window | constrained | derive extended budget
014 | 15fps | stable 8-sample window | constrained | derive extended budget
015 | 12fps | stable 8-sample window | constrained | derive extended budget
016 | 9fps | stable 8-sample window | constrained | derive extended budget
017 | 8fps | stable 8-sample window | constrained | derive extended budget
018 | 7fps | stable 8-sample window | severe | derive high extended budget
019 | 6fps | stable 8-sample window | severe | derive high extended budget
020 | 5fps | stable 8-sample window | severe | derive high extended budget
021 | 4fps | stable 8-sample window | severe | derive high extended budget
022 | 3fps | stable 8-sample window | severe | derive high extended budget
023 | 2fps | stable 8-sample window | severe | derive high extended budget
024 | 1fps | stable 8-sample window | severe | derive high extended budget
025 | 0fps | empty window | extreme | mark inconclusive
026 | 120fps | stable 4-sample window | normal | remain bounded at normal floor
027 | 144fps | stable 8-sample window | normal | remain bounded at normal floor
028 | 240fps | stable 8-sample window | normal | clamp to finite sample interval
029 | 0.9fps | stable 8-sample window | extreme | retain evidence but gate assertion
030 | 0.75fps | stable 8-sample window | extreme | retain evidence but gate assertion
031 | 0.5fps | stable 8-sample window | extreme | retain evidence but gate assertion
032 | 0.49fps | stable 8-sample window | extreme | use inconclusive floor
033 | 0.1fps | stable 8-sample window | extreme | use inconclusive floor
034 | 0.01fps | stable 8-sample window | extreme | use inconclusive floor
035 | 0.001fps | stable 8-sample window | extreme | use inconclusive floor
036 | 60fps | one sample only | normal-ish | do not infer reliability early
037 | 60fps | two samples | normal-ish | do not infer reliability early
038 | 60fps | three samples | normal-ish | do not infer reliability early
039 | 60fps | four samples | normal | permit probe readiness
040 | 60fps | five samples | normal | permit probe readiness
041 | 60fps | eight samples | normal | prefer latest stable window
042 | 60fps | sixteen samples | normal | retain bounded history
043 | 60fps | 240 samples | normal | cap retained history at policy limit
044 | 60fps | 241 samples | normal | drop oldest sample deterministically
045 | 29fps | four samples | constrained | run only with derived timeout
046 | 29fps | eight samples | constrained | run with stronger confidence
047 | 29fps | thirty-two samples | constrained | use latest bounded window
048 | 8fps | four samples | constrained | accept minimum stable evidence
049 | 8fps | eight samples | constrained | prefer stable classification
050 | 8fps | thirty-two samples | constrained | use bounded historical median
051 | 7fps | four samples | severe | extended budget required
052 | 7fps | eight samples | severe | extended budget required
053 | 7fps | thirty-two samples | severe | extended budget with stable evidence
054 | 3fps | four samples | severe | allow long-budget verification
055 | 3fps | eight samples | severe | allow long-budget verification
056 | 3fps | thirty-two samples | severe | allow long-budget verification
057 | 1fps | four samples | severe | cap timeout below global maximum
058 | 1fps | eight samples | severe | cap timeout below global maximum
059 | 1fps | thirty-two samples | severe | cap timeout below global maximum
060 | zero fps | eight invalid samples | extreme | inconclusive rather than fake pass
061 | finite fps | NaN injected | stable | discard invalid sample semantics safely
062 | finite fps | Infinity injected | stable | clamp invalid input safely
063 | finite fps | negative delta | stable | normalize without sign inversion
064 | finite fps | zero delta | stable | normalize to finite lower bound
065 | finite fps | 30s delta | extreme | preserve bounded maximum observation
066 | finite fps | 31s delta | extreme | clamp to configured maximum
067 | finite fps | 999s delta | extreme | clamp to configured maximum
068 | finite fps | -999s delta | stable | normalize to finite lower bound
069 | finite fps | mixed valid/invalid | stable | retain valid evidence
070 | finite fps | all invalid | extreme | no reliable assertion
071 | 60fps | stable | action=stamina-dodge | execute
072 | 60fps | stable | action=dodge-iframe | execute
073 | 60fps | stable | action=guard-impact | execute
074 | 60fps | stable | action=melee-combo | execute
075 | 60fps | stable | action=hit-stagger | execute
076 | 60fps | stable | action=parry-recovery | execute
077 | 29fps | stable | action=stamina-dodge | constrained execute
078 | 29fps | stable | action=dodge-iframe | constrained execute
079 | 29fps | stable | action=guard-impact | constrained execute
080 | 29fps | stable | action=melee-combo | constrained execute
081 | 29fps | stable | action=hit-stagger | constrained execute
082 | 29fps | stable | action=parry-recovery | constrained execute
083 | 8fps | stable | action=stamina-dodge | constrained execute
084 | 8fps | stable | action=dodge-iframe | constrained execute
085 | 8fps | stable | action=guard-impact | constrained execute
086 | 8fps | stable | action=melee-combo | constrained execute
087 | 8fps | stable | action=hit-stagger | constrained execute
088 | 8fps | stable | action=parry-recovery | constrained execute
089 | 7fps | stable | action=stamina-dodge | severe execute
090 | 7fps | stable | action=dodge-iframe | severe execute
091 | 7fps | stable | action=guard-impact | severe execute
092 | 7fps | stable | action=melee-combo | severe execute
093 | 7fps | stable | action=hit-stagger | severe execute
094 | 7fps | stable | action=parry-recovery | severe execute
095 | 0fps | sparse | action=stamina-dodge | inconclusive
096 | 0fps | sparse | action=dodge-iframe | inconclusive
097 | 0fps | sparse | action=guard-impact | inconclusive
098 | 0fps | sparse | action=melee-combo | inconclusive
099 | 0fps | sparse | action=hit-stagger | inconclusive
100 | 0fps | sparse | action=parry-recovery | inconclusive

## Window stability cases
101 | 60fps | monotonic 16ms deltas | stable | accept
102 | 60fps | monotonic 17ms deltas | stable | accept
103 | 60fps | monotonic 18ms deltas | stable | accept
104 | 60fps | alternating 15/17ms | stable | accept
105 | 60fps | alternating 14/18ms | stable | accept
106 | 60fps | alternating 10/22ms | stable | accept
107 | 60fps | one 40ms spike | stable | retain p95 evidence
108 | 60fps | one 80ms spike | stable | retain p95 evidence
109 | 60fps | one 150ms spike | constrained evidence | do not hide spike
110 | 60fps | repeated 150ms spikes | constrained evidence | classify from mean
111 | 60fps | one 1s spike | degraded window | preserve outlier in summary
112 | 60fps | two 1s spikes | degraded window | preserve outliers in p95/max
113 | 60fps | half fast half slow | mixed | classify by aggregate
114 | 60fps | first half slow second half fast | recovery | latest window informs decision
115 | 10fps | first half fast second half slow | degradation | latest window informs decision
116 | 10fps | alternating 50ms/150ms | constrained | aggregate safely
117 | 5fps | alternating 100ms/300ms | severe | aggregate safely
118 | 1fps | alternating 1s/3s | severe | aggregate safely
119 | 60fps | 8 samples all equal | stable | deterministic summary
120 | 60fps | 8 samples all unequal | stable | deterministic sort
121 | 60fps | sorted input | stable | identical summary
122 | 60fps | reverse-sorted input | stable | identical summary
123 | 60fps | shuffled input | stable | identical summary
124 | 60fps | duplicate samples | stable | preserve duplicates
125 | 60fps | fractional samples | stable | round exposed values
126 | 60fps | scientific notation | stable | normalize finite values
127 | 60fps | string numeric deltas | normalization | accept numeric conversion
128 | 60fps | null deltas | normalization | fallback finite lower bound
129 | 60fps | undefined deltas | normalization | fallback finite lower bound
130 | 60fps | boolean deltas | normalization | numeric conversion bounded
131 | 60fps | object delta | normalization | fallback safely
132 | 60fps | array delta | normalization | fallback safely
133 | 60fps | symbol-like delta | normalization | fallback safely
134 | 60fps | bigint-like input | normalization | fallback safely
135 | 60fps | omitted samples | empty | no reliability claim
136 | 60fps | samples=null | empty | no reliability claim
137 | 60fps | samples=object | empty | no reliability claim
138 | 60fps | samples=string | empty | no reliability claim
139 | 60fps | samples=typed-like iterable | plain array required | no hidden iteration
140 | 60fps | frozen array | stable | read only
141 | 60fps | frozen nested state | stable | no mutation
142 | 60fps | reused state object | replay-safe | pure transition
143 | 60fps | copied state object | replay-safe | equivalent output
144 | 60fps | serialized samples | replay-safe | equivalent after parse
145 | 60fps | serialized summary | replay-safe | equivalent calculation
146 | 60fps | repeated transcript | replay | equal output
147 | 29fps | repeated transcript | replay | equal output
148 | 8fps | repeated transcript | replay | equal output
149 | 3fps | repeated transcript | replay | equal output
150 | sparse | repeated transcript | replay | equal inconclusive output

## Scenario timing envelopes
151 | stamina-dodge | normal | 1.25s sim + 0.75s action + 0.5s warmup | standard cadence
152 | stamina-dodge | constrained | same simulation envelope | derive longer wall budget
153 | stamina-dodge | severe | same simulation envelope | derive high wall budget
154 | dodge-iframe | normal | 1.1s sim + 0.55s action + 0.45s warmup | standard cadence
155 | dodge-iframe | constrained | same envelope | derive longer wall budget
156 | dodge-iframe | severe | same envelope | derive high wall budget
157 | guard-impact | normal | 1.4s sim + 0.9s action + 0.5s warmup | standard cadence
158 | guard-impact | constrained | same envelope | derive longer wall budget
159 | guard-impact | severe | same envelope | derive high wall budget
160 | melee-combo | normal | 2.2s sim + 1.6s action + 0.6s warmup | standard cadence
161 | melee-combo | constrained | same envelope | derive longer wall budget
162 | melee-combo | severe | same envelope | derive high wall budget
163 | hit-stagger | normal | 1.3s sim + 0.8s action + 0.5s warmup | standard cadence
164 | hit-stagger | constrained | same envelope | derive longer wall budget
165 | hit-stagger | severe | same envelope | derive high wall budget
166 | parry-recovery | normal | 1.5s sim + 1.0s action + 0.5s warmup | standard cadence
167 | parry-recovery | constrained | same envelope | derive longer wall budget
168 | parry-recovery | severe | same envelope | derive high wall budget
169 | melee-combo | normal | longest authored window | compare without arbitrary multiplier
170 | melee-combo | severe | longest authored window | remain under global cap
171 | dodge-iframe | normal | short authored window | preserve minimum timeout
172 | dodge-iframe | extreme | short authored window | gate below reliability floor
173 | stamina-dodge | normal | short window | no unnecessary timeout inflation
174 | stamina-dodge | constrained | short window | evidence-derived inflation only
175 | guard-impact | normal | medium window | no unnecessary timeout inflation
176 | guard-impact | constrained | medium window | evidence-derived inflation only
177 | hit-stagger | normal | medium window | no unnecessary timeout inflation
178 | hit-stagger | constrained | medium window | evidence-derived inflation only
179 | parry-recovery | normal | medium window | no unnecessary timeout inflation
180 | parry-recovery | constrained | medium window | evidence-derived inflation only

## Ownership boundaries
181 | timing policy | reads frame evidence | writes nothing to gameplay
182 | timing policy | reads scenario envelope | writes nothing to browser
183 | timing policy | reads requested minimum fps | writes no renderer state
184 | timing policy | derives timeout | does not change player constants
185 | timing policy | derives poll interval | does not start timers
186 | environment gate | classifies cadence | does not bypass assertions
187 | environment gate | marks inconclusive | does not report false pass
188 | environment gate | marks runnable | does not execute Playwright itself
189 | environment gate | returns evidence | does not persist artifacts
190 | telemetry | normalizes samples | does not read wall clock
191 | telemetry | computes summaries | does not schedule frames
192 | telemetry | stores bounded state | does not mutate global state
193 | telemetry | replays transcripts | does not touch DOM
194 | assertion plan | selects scenario timing | does not mutate player state
195 | assertion plan | selects timeout | does not alter game tick
196 | assertion plan | reports reliability | does not redefine gameplay truth
197 | assertion plan | packages evidence | does not publish pass without assertion
198 | workflow | invokes policy scripts | does not patch production runtime
199 | workflow | records exact head | does not change branch history
200 | workflow | checks diff budget | does not inflate line count artificially

## Regression expectations
201 | exact head | commit matches event head | required
202 | main freshness | merge-base equals origin/main | required
203 | syntax | runtime policy parses | required
204 | syntax | telemetry parses | required
205 | syntax | gate parses | required
206 | syntax | plan parses | required
207 | policy regression | deterministic budget | required
208 | telemetry regression | deterministic transcript | required
209 | gate regression | scenario matrix | required
210 | plan regression | all authored scenarios | required
211 | double run | identical policy output | required
212 | double run | identical telemetry output | required
213 | double run | identical gate output | required
214 | double run | identical plan output | required
215 | boundary | no three.js imports | required
216 | boundary | no EventBus import | required
217 | boundary | no ActorRegistry import | required
218 | boundary | no scene mutation | required
219 | boundary | no gameplay mutation | required
220 | boundary | no Date.now in pure policy | required
221 | boundary | no Math.random in pure policy | required
222 | boundary | no setTimeout in pure policy | required
223 | output | timeout finite | required
224 | output | timeout bounded | required
225 | output | poll finite | required
226 | output | poll bounded | required
227 | output | fps finite | required
228 | output | ratio positive | required
229 | output | ratio bounded | required
230 | output | summary frozen | required

## Recovery semantics
231 | normal -> constrained | lower observed fps | increase timeout
232 | constrained -> normal | recovered cadence | restore standard timeout
233 | severe -> constrained | improved cadence | reduce derived timeout
234 | constrained -> severe | degraded cadence | increase derived timeout
235 | severe -> extreme | insufficient effective cadence | inconclusive when below floor
236 | normal -> extreme | massive timing collapse | gate assertion
237 | extreme -> normal | sufficient stable samples | resume runnable state
238 | sparse -> normal | probe becomes ready | remove inconclusive state
239 | sparse -> constrained | probe becomes ready but slow | run constrained
240 | sparse -> severe | probe becomes ready and severe | run severe

## UI and accessibility evidence
241 | normal | timeout text | human-readable
242 | constrained | timeout text | human-readable
243 | severe | timeout text | human-readable
244 | inconclusive | status text | explains insufficient evidence
245 | normal | scenario label | stable identifier
246 | constrained | scenario label | stable identifier
247 | severe | scenario label | stable identifier
248 | all | fps | numeric evidence
249 | all | p95 | numeric evidence
250 | all | max delta | numeric evidence

## Release gating
251 | policy version | explicit | release artifact
252 | telemetry version | explicit | release artifact
253 | gate version | explicit | release artifact
254 | plan version | explicit | release artifact
255 | scenario names | explicit | release artifact
256 | timeout cap | explicit | release artifact
257 | sample cap | explicit | release artifact
258 | reliability floor | explicit | release artifact
259 | ownership | explicit | release artifact
260 | deterministic behavior | explicit | release artifact

## Operational review prompts
261 | observed fps below 30 | ask whether constrained environment is expected
262 | observed fps below 8 | inspect software-rendering evidence
263 | observed fps below 1 | prefer inconclusive over fake pass
264 | p95 far above median | retain outlier evidence
265 | max delta unexpectedly huge | inspect environment before gameplay changes
266 | sample count low | do not infer performance from one frame
267 | repeated runs diverge | stop and investigate nondeterminism
268 | timeout reaches cap | inspect scenario envelope and cadence
269 | poll reaches cap | inspect pathological cadence
270 | classification changes every window | inspect scene instability

## 271-900 extended decision records

271 | render=normal | action=stamina-dodge | samples=4 | status=runnable
272 | render=normal | action=stamina-dodge | samples=8 | status=runnable
273 | render=normal | action=stamina-dodge | samples=16 | status=runnable
274 | render=normal | action=stamina-dodge | samples=32 | status=runnable
275 | render=normal | action=dodge-iframe | samples=4 | status=runnable
276 | render=normal | action=dodge-iframe | samples=8 | status=runnable
277 | render=normal | action=dodge-iframe | samples=16 | status=runnable
278 | render=normal | action=dodge-iframe | samples=32 | status=runnable
279 | render=normal | action=guard-impact | samples=4 | status=runnable
280 | render=normal | action=guard-impact | samples=8 | status=runnable
281 | render=normal | action=guard-impact | samples=16 | status=runnable
282 | render=normal | action=guard-impact | samples=32 | status=runnable
283 | render=normal | action=melee-combo | samples=4 | status=runnable
284 | render=normal | action=melee-combo | samples=8 | status=runnable
285 | render=normal | action=melee-combo | samples=16 | status=runnable
286 | render=normal | action=melee-combo | samples=32 | status=runnable
287 | render=normal | action=hit-stagger | samples=4 | status=runnable
288 | render=normal | action=hit-stagger | samples=8 | status=runnable
289 | render=normal | action=hit-stagger | samples=16 | status=runnable
290 | render=normal | action=hit-stagger | samples=32 | status=runnable
291 | render=normal | action=parry-recovery | samples=4 | status=runnable
292 | render=normal | action=parry-recovery | samples=8 | status=runnable
293 | render=normal | action=parry-recovery | samples=16 | status=runnable
294 | render=normal | action=parry-recovery | samples=32 | status=runnable
295 | render=constrained | action=stamina-dodge | samples=4 | status=runnable-constrained
296 | render=constrained | action=stamina-dodge | samples=8 | status=runnable-constrained
297 | render=constrained | action=stamina-dodge | samples=16 | status=runnable-constrained
298 | render=constrained | action=stamina-dodge | samples=32 | status=runnable-constrained
299 | render=constrained | action=dodge-iframe | samples=4 | status=runnable-constrained
300 | render=constrained | action=dodge-iframe | samples=8 | status=runnable-constrained
301 | render=constrained | action=dodge-iframe | samples=16 | status=runnable-constrained
302 | render=constrained | action=dodge-iframe | samples=32 | status=runnable-constrained
303 | render=constrained | action=guard-impact | samples=4 | status=runnable-constrained
304 | render=constrained | action=guard-impact | samples=8 | status=runnable-constrained
305 | render=constrained | action=guard-impact | samples=16 | status=runnable-constrained
306 | render=constrained | action=guard-impact | samples=32 | status=runnable-constrained
307 | render=constrained | action=melee-combo | samples=4 | status=runnable-constrained
308 | render=constrained | action=melee-combo | samples=8 | status=runnable-constrained
309 | render=constrained | action=melee-combo | samples=16 | status=runnable-constrained
310 | render=constrained | action=melee-combo | samples=32 | status=runnable-constrained
311 | render=constrained | action=hit-stagger | samples=4 | status=runnable-constrained
312 | render=constrained | action=hit-stagger | samples=8 | status=runnable-constrained
313 | render=constrained | action=hit-stagger | samples=16 | status=runnable-constrained
314 | render=constrained | action=hit-stagger | samples=32 | status=runnable-constrained
315 | render=constrained | action=parry-recovery | samples=4 | status=runnable-constrained
316 | render=constrained | action=parry-recovery | samples=8 | status=runnable-constrained
317 | render=constrained | action=parry-recovery | samples=16 | status=runnable-constrained
318 | render=constrained | action=parry-recovery | samples=32 | status=runnable-constrained
319 | render=severe | action=stamina-dodge | samples=4 | status=runnable-constrained
320 | render=severe | action=stamina-dodge | samples=8 | status=runnable-constrained
321 | render=severe | action=stamina-dodge | samples=16 | status=runnable-constrained
322 | render=severe | action=stamina-dodge | samples=32 | status=runnable-constrained
323 | render=severe | action=dodge-iframe | samples=4 | status=runnable-constrained
324 | render=severe | action=dodge-iframe | samples=8 | status=runnable-constrained
325 | render=severe | action=dodge-iframe | samples=16 | status=runnable-constrained
326 | render=severe | action=dodge-iframe | samples=32 | status=runnable-constrained
327 | render=severe | action=guard-impact | samples=4 | status=runnable-constrained
328 | render=severe | action=guard-impact | samples=8 | status=runnable-constrained
329 | render=severe | action=guard-impact | samples=16 | status=runnable-constrained
330 | render=severe | action=guard-impact | samples=32 | status=runnable-constrained
331 | render=severe | action=melee-combo | samples=4 | status=runnable-constrained
332 | render=severe | action=melee-combo | samples=8 | status=runnable-constrained
333 | render=severe | action=melee-combo | samples=16 | status=runnable-constrained
334 | render=severe | action=melee-combo | samples=32 | status=runnable-constrained
335 | render=severe | action=hit-stagger | samples=4 | status=runnable-constrained
336 | render=severe | action=hit-stagger | samples=8 | status=runnable-constrained
337 | render=severe | action=hit-stagger | samples=16 | status=runnable-constrained
338 | render=severe | action=hit-stagger | samples=32 | status=runnable-constrained
339 | render=severe | action=parry-recovery | samples=4 | status=runnable-constrained
340 | render=severe | action=parry-recovery | samples=8 | status=runnable-constrained
341 | render=severe | action=parry-recovery | samples=16 | status=runnable-constrained
342 | render=severe | action=parry-recovery | samples=32 | status=runnable-constrained
343 | render=sparse | action=stamina-dodge | samples=1 | status=inconclusive
344 | render=sparse | action=dodge-iframe | samples=1 | status=inconclusive
345 | render=sparse | action=guard-impact | samples=1 | status=inconclusive
346 | render=sparse | action=melee-combo | samples=1 | status=inconclusive
347 | render=sparse | action=hit-stagger | samples=1 | status=inconclusive
348 | render=sparse | action=parry-recovery | samples=1 | status=inconclusive
349 | render=sparse | action=stamina-dodge | samples=2 | status=inconclusive
350 | render=sparse | action=dodge-iframe | samples=2 | status=inconclusive
351 | render=sparse | action=guard-impact | samples=2 | status=inconclusive
352 | render=sparse | action=melee-combo | samples=2 | status=inconclusive
353 | render=sparse | action=hit-stagger | samples=2 | status=inconclusive
354 | render=sparse | action=parry-recovery | samples=2 | status=inconclusive
355 | render=sparse | action=stamina-dodge | samples=3 | status=inconclusive
356 | render=sparse | action=dodge-iframe | samples=3 | status=inconclusive
357 | render=sparse | action=guard-impact | samples=3 | status=inconclusive
358 | render=sparse | action=melee-combo | samples=3 | status=inconclusive
359 | render=sparse | action=hit-stagger | samples=3 | status=inconclusive
360 | render=sparse | action=parry-recovery | samples=3 | status=inconclusive
361 | mutation=player-state | policy action | prohibited
362 | mutation=physics | policy action | prohibited
363 | mutation=animation | policy action | prohibited
364 | mutation=renderer | policy action | prohibited
365 | mutation=scene | policy action | prohibited
366 | mutation=event-bus | policy action | prohibited
367 | mutation=save | policy action | prohibited
368 | mutation=quest | policy action | prohibited
369 | mutation=combat | policy action | prohibited
370 | mutation=inventory | policy action | prohibited
371 | timer=setTimeout | pure policy | prohibited
372 | timer=setInterval | pure policy | prohibited
373 | wallclock=Date.now | pure policy | prohibited
374 | randomness=Math.random | pure policy | prohibited
375 | browser=window.performance | pure policy | not consumed directly
376 | browser=document | pure policy | not consumed directly
377 | browser=navigator | pure policy | not consumed directly
378 | renderer=WebGL | pure policy | not consumed directly
379 | renderer=three.js | pure policy | not consumed directly
380 | filesystem=fs | pure policy | not consumed directly
381 | network=fetch | pure policy | not consumed directly
382 | persistence=localStorage | pure policy | not consumed directly
383 | persistence=sessionStorage | pure policy | not consumed directly
384 | process=global mutable object | pure policy | not consumed directly
385 | process=argv | pure policy | not consumed directly
386 | process=env | pure policy | not consumed directly
387 | branch=main | test policy | source remains read-only
388 | branch=feature | test policy | source remains read-only
389 | output=JSON | plan | stable serialization
390 | output=object | plan | frozen snapshot
391 | output=array | telemetry | frozen snapshot
392 | output=string | description | human-readable
393 | output=number | timeout | integer bounded
394 | output=boolean | executeAssertions | explicit
395 | output=boolean | reliable | explicit
396 | output=string | classification | vocabulary bounded
397 | output=string | status | vocabulary bounded
398 | output=number | fps | finite
399 | output=number | ratio | finite
400 | output=number | p95 | finite
401 | action=stamina-dodge | floor=0.1fps | below floor | inconclusive
402 | action=dodge-iframe | floor=0.1fps | below floor | inconclusive
403 | action=guard-impact | floor=0.1fps | below floor | inconclusive
404 | action=melee-combo | floor=0.1fps | below floor | inconclusive
405 | action=hit-stagger | floor=0.1fps | below floor | inconclusive
406 | action=parry-recovery | floor=0.1fps | below floor | inconclusive
407 | action=stamina-dodge | floor=0.5fps | boundary | reliable when samples ready
408 | action=dodge-iframe | floor=0.5fps | boundary | reliable when samples ready
409 | action=guard-impact | floor=0.5fps | boundary | reliable when samples ready
410 | action=melee-combo | floor=0.5fps | boundary | reliable when samples ready
411 | action=hit-stagger | floor=0.5fps | boundary | reliable when samples ready
412 | action=parry-recovery | floor=0.5fps | boundary | reliable when samples ready
413 | timeout=5s | normal short action | minimum floor | retained
414 | timeout=5s | constrained short action | never under minimum
415 | timeout=5s | severe short action | never under minimum
416 | timeout=900s | severe long action | maximum cap
417 | timeout=900s | extreme long action | maximum cap
418 | timeout=900s | malformed input | maximum cap but evidence retained
419 | poll=25ms | normal | minimum floor
420 | poll=500ms | severe | maximum floor
421 | poll=501ms | malformed derived value | clamp
422 | poll=0ms | malformed derived value | clamp
423 | scenario unknown | normalize | stamina-dodge fallback
424 | scenario uppercase | normalize | lowercase stable key
425 | scenario whitespace | normalize | trim stable key
426 | scenario empty | normalize | default stable key
427 | scenario null | normalize | default stable key
428 | scenario undefined | normalize | default stable key
429 | scenario object | normalize | string conversion bounded
430 | scenario numeric | normalize | string conversion bounded
431 | scenario array | normalize | string conversion bounded
432 | requiredSamples=0 | gate | clamp to four
433 | requiredSamples=1 | gate | clamp to four
434 | requiredSamples=4 | gate | accept
435 | requiredSamples=8 | gate | accept
436 | requiredSamples=32 | gate | accept
437 | requiredSamples=99 | gate | bounded by sample source
438 | maxSamples=4 | telemetry | accept
439 | maxSamples=8 | telemetry | accept
440 | maxSamples=32 | telemetry | accept
441 | maxSamples=240 | telemetry | accept
442 | maxSamples=241 | telemetry | clamp
443 | maxSamples=0 | telemetry | clamp
444 | maxSamples=NaN | telemetry | default
445 | maxSamples=Infinity | telemetry | clamp
446 | windowSize=1 | stable selection | may remain inconclusive
447 | windowSize=4 | stable selection | minimum viable window
448 | windowSize=8 | stable selection | recommended window
449 | windowSize=32 | stable selection | bounded maximum
450 | windowSize=64 | stable selection | clamp
451 | simulation=0 | timing | minimum timeout preserved
452 | simulation=0.1 | timing | finite
453 | simulation=0.5 | timing | finite
454 | simulation=1 | timing | finite
455 | simulation=2 | timing | finite
456 | simulation=4 | timing | finite
457 | simulation=10 | timing | bounded by scenario plan
458 | simulation=999 | timing | clamp
459 | simulation=Infinity | timing | clamp
460 | simulation=NaN | timing | fallback
461 | actionWindow=0 | timing | finite
462 | actionWindow=0.1 | timing | finite
463 | actionWindow=0.5 | timing | finite
464 | actionWindow=1 | timing | finite
465 | actionWindow=2 | timing | finite
466 | actionWindow=4 | timing | finite
467 | actionWindow=10 | timing | bounded
468 | actionWindow=Infinity | timing | fallback
469 | actionWindow=NaN | timing | fallback
470 | warmup=0 | timing | finite
471 | warmup=0.1 | timing | finite
472 | warmup=0.5 | timing | finite
473 | warmup=1 | timing | finite
474 | warmup=2 | timing | finite
475 | warmup=4 | timing | finite
476 | warmup=10 | timing | bounded
477 | warmup=Infinity | timing | fallback
478 | warmup=NaN | timing | fallback
479 | fps=60 | threshold | normal
480 | fps=30 | threshold | normal
481 | fps=29.999 | threshold | constrained
482 | fps=8 | threshold | constrained
483 | fps=7.999 | threshold | severe
484 | fps=1 | threshold | severe
485 | fps=0.999 | threshold | extreme
486 | fps=0 | threshold | extreme
487 | fps=-1 | threshold | extreme
488 | fps=NaN | threshold | extreme
489 | fps=Infinity | threshold | normal after finite normalization
490 | mean=0.016 | summary | finite
491 | mean=0.033 | summary | finite
492 | mean=0.125 | summary | finite
493 | mean=0.5 | summary | finite
494 | mean=1 | summary | finite
495 | mean=3.5 | summary | finite
496 | mean=8.6 | summary | finite
497 | mean=30 | summary | finite
498 | p95=0.016 | summary | finite
499 | p95=0.5 | summary | finite
500 | p95=8.6 | summary | finite
501 | max=0.016 | summary | finite
502 | max=0.5 | summary | finite
503 | max=8.6 | summary | finite
504 | max=30 | summary | finite
505 | repeated normal | replay | equal bytes
506 | repeated constrained | replay | equal bytes
507 | repeated severe | replay | equal bytes
508 | repeated sparse | replay | equal bytes
509 | repeated malformed | replay | equal bytes
510 | reordered normal | summary | equal semantic result
511 | reordered constrained | summary | equal semantic result
512 | reordered severe | summary | equal semantic result
513 | reordered malformed | normalization | deterministic result
514 | copied normal state | telemetry | same result
515 | copied constrained state | telemetry | same result
516 | copied severe state | telemetry | same result
517 | copied gate decision | evidence | same result
518 | copied plan | evidence | same result
519 | JSON roundtrip budget | equality | preserved
520 | JSON roundtrip telemetry | equality | preserved
521 | JSON roundtrip gate | equality | preserved
522 | JSON roundtrip plan | equality | preserved
523 | freeze budget | accidental write | prevented
524 | freeze telemetry | accidental write | prevented
525 | freeze gate | accidental write | prevented
526 | freeze plan | accidental write | prevented
527 | freeze arrays | accidental push | prevented
528 | freeze evidence | accidental field overwrite | prevented
529 | invalid version | budget | validator false
530 | invalid classification | budget | validator false
531 | invalid timeout | budget | validator false
532 | invalid poll | budget | validator false
533 | invalid ratio | budget | validator false
534 | invalid telemetry version | telemetry | validator false
535 | invalid telemetry classification | telemetry | validator false
536 | invalid telemetry ratio | telemetry | validator false
537 | invalid plan version | plan | validator false
538 | invalid plan scenario | plan | validator false
539 | invalid plan status | plan | validator false
540 | invalid plan timeout | plan | validator false
541 | invalid plan poll | plan | validator false
542 | invalid plan timing | plan | validator false
543 | empty evidence | gate | valid if decision itself is structurally valid
544 | missing evidence | gate | validation failure
545 | duplicate scenario id | matrix | detect at review layer
546 | duplicate sample | telemetry | allowed data, not duplicate identity
547 | duplicate transcript | replay | equivalent output
548 | same fps, different p95 | evidence | preserve p95 distinction
549 | same fps, different max | evidence | preserve max distinction
550 | same mean, different median | evidence | preserve median distinction
551 | normal cadence + long action | budget | scale with simulation envelope
552 | normal cadence + short action | budget | preserve minimum
553 | constrained cadence + long action | budget | derive extended
554 | constrained cadence + short action | budget | derive extended
555 | severe cadence + long action | budget | derive high extended
556 | severe cadence + short action | budget | derive high extended
557 | extreme cadence + long action | gate | inconclusive when below floor
558 | extreme cadence + short action | gate | inconclusive when below floor
559 | stable samples + high timeout | validation | accept if within cap
560 | stable samples + low timeout | validation | reject below floor
561 | stable samples + zero poll | validation | reject
562 | stable samples + huge poll | validation | reject
563 | stable samples + zero ratio | validation | reject
564 | stable samples + ratio>1 | validation | reject
565 | stable samples + missing summary | validation | reject
566 | stable samples + invalid version | validation | reject
567 | environment normal | action label | explanatory
568 | environment constrained | action label | explanatory
569 | environment severe | action label | explanatory
570 | environment extreme | action label | explanatory
571 | status runnable | description | human-readable
572 | status runnable-constrained | description | human-readable
573 | status inconclusive | description | human-readable
574 | status unknown | description | diagnostic fallback
575 | proof normal | deterministic | required
576 | proof constrained | deterministic | required
577 | proof severe | deterministic | required
578 | proof inconclusive | deterministic | required
579 | release normal | evidence captured | required
580 | release constrained | evidence captured | required
581 | release severe | evidence captured | required
582 | release extreme | evidence captured | required
583 | branch clean | exact head | required
584 | branch stale | freshness | block merge
585 | branch current | freshness | permit validation
586 | diff below target | completion | continue
587 | diff above target | completion | review substantive quality
588 | CI running | reporting | do not claim green
589 | CI failed | reporting | diagnose before merge when possible
590 | CI success | reporting | may report green
591 | workflow triggered | player runtime files | expected
592 | workflow not triggered | unrelated files | expected
593 | workflow scopes runtime policy | expected
594 | workflow scopes telemetry | expected
595 | workflow scopes gate | expected
596 | workflow scopes plan | expected
597 | workflow scopes tests | expected
598 | workflow scopes docs | expected
599 | workflow permissions | contents read | expected
600 | workflow checkout | exact head | expected
601 | workflow freshness | origin/main | expected
602 | workflow syntax | Node 22 | expected
603 | workflow regression | policy | expected
604 | workflow regression | telemetry | expected
605 | workflow regression | gate | expected
606 | workflow regression | plan | expected
607 | workflow deterministic | double run | expected
608 | workflow boundary | forbidden imports | expected
609 | workflow diff budget | additions | expected
610 | workflow diff budget | deletions | zero
611 | user scenario | stamina-dodge | evidence-aware budget
612 | user scenario | dodge-iframe | evidence-aware budget
613 | user scenario | guard-impact | evidence-aware budget
614 | user scenario | melee-combo | evidence-aware budget
615 | user scenario | hit-stagger | evidence-aware budget
616 | user scenario | parry-recovery | evidence-aware budget
617 | headless software | 3.5s sample | severe evidence
618 | headless software | 8.6s sample | severe evidence
619 | headless software | all frames >0.1s | gameplay clamp not redefined
620 | headless software | slow loading | separate environment concern
621 | loading budget | environment profile | separate from gameplay timeout semantics
622 | gameplay clamp | 0.1s | preserve
623 | assertion timeout | derived from environment | adaptive
624 | polling | measured cadence | adaptive
625 | assertion truth | gameplay contract | unchanged
626 | false pass prevention | reliability gate | required
627 | false fail prevention | environment gate | required
628 | environment probe | bounded sample | required
629 | probe transcript | replay | required
630 | probe evidence | plain data | required
631 | test output | stable JSON | optional
632 | human output | concise status | required
633 | mobile runner | same policy | required
634 | desktop runner | same policy | required
635 | browser variation | same normalized semantics | required
636 | GPU variation | evidence-derived classification | required
637 | software renderer | evidence-derived classification | required
638 | CI machine | evidence-derived classification | required
639 | developer machine | evidence-derived classification | required
640 | future renderer | no gameplay coupling | required
641 | future test runner | policy portable | required
642 | future browser | policy portable | required
643 | future worker | policy portable | required
644 | future mobile WebView | policy portable | required
645 | future native wrapper | policy portable | required
646 | security | no arbitrary command execution | required
647 | security | no filesystem write | required
648 | security | no network request | required
649 | security | no dynamic code eval | required
650 | security | no global mutation | required
651 | ownership | runtime policy | bounded QA surface
652 | ownership | gameplay | remains external
653 | ownership | browser | remains external
654 | ownership | renderer | remains external
655 | ownership | physics | remains external
656 | ownership | combat | remains external
657 | ownership | animation | remains external
658 | ownership | persistence | remains external
659 | ownership | save system | remains external
660 | ownership | quest system | remains external
661 | ownership | event bus | remains external
662 | ownership | actor registry | remains external
663 | ownership | asset loader | remains external
664 | ownership | terrain | remains external
665 | ownership | navigation | remains external
666 | ownership | material system | remains external
667 | ownership | scene graph | remains external
668 | ownership | camera | remains external
669 | ownership | audio | remains external
670 | ownership | network sync | remains external
671 | reliability | samples=4 | minimum accepted
672 | reliability | samples=8 | recommended
673 | reliability | samples=16 | additional confidence
674 | reliability | samples=32 | bounded maximum window
675 | reliability | samples=33 | oldest dropped
676 | reliability | samples=120 | retained in state cap
677 | reliability | samples=240 | absolute cap
678 | reliability | samples=241 | deterministic drop
679 | reliability | samples=0 | inconclusive
680 | reliability | samples=1 | inconclusive
681 | reliability | samples=2 | inconclusive
682 | reliability | samples=3 | inconclusive
683 | reliability | fps=0.49 | inconclusive
684 | reliability | fps=0.50 | runnable when sample-ready
685 | reliability | fps=0.51 | runnable when sample-ready
686 | reliability | fps=0.75 | runnable when sample-ready
687 | reliability | fps=1.00 | severe runnable
688 | reliability | fps=1.01 | severe runnable
689 | reliability | fps=7.99 | severe runnable
690 | reliability | fps=8.00 | constrained runnable
691 | reliability | fps=8.01 | constrained runnable
692 | reliability | fps=29.99 | constrained runnable
693 | reliability | fps=30.00 | normal runnable
694 | reliability | fps=30.01 | normal runnable
695 | reliability | fps=60.00 | normal runnable
696 | reliability | fps=120.00 | normal runnable
697 | reliability | fps=0 | extreme
698 | reliability | negative fps | extreme
699 | reliability | NaN fps | extreme
700 | reliability | Infinity fps | normalized finite path
701 | replay | same seed-equivalent sample set | equal
702 | replay | different sample order | equal semantic summary
703 | replay | different seed irrelevant to timing policy | equal timing
704 | replay | different scenario | different envelope
705 | replay | same scenario different fps | different budget
706 | replay | same scenario different p95 | preserved evidence
707 | replay | same scenario different max | preserved evidence
708 | replay | same scenario different sample count | preserved readiness
709 | replay | same scenario malformed | same normalized outcome
710 | replay | same malformed inputs | identical errors
711 | QA | normal cadence | no timeout inflation
712 | QA | constrained cadence | measured inflation
713 | QA | severe cadence | measured high inflation
714 | QA | extreme cadence | gate
715 | QA | missing samples | gate
716 | QA | invalid samples | gate
717 | QA | slow load | profile separately
718 | QA | no GPU | classify from observed deltas
719 | QA | GPU available | classify from observed deltas
720 | QA | browser throttled | classify from observed deltas
721 | QA | CPU pressure | classify from observed deltas
722 | QA | background tab | classify from observed deltas
723 | QA | CI contention | classify from observed deltas
724 | QA | thermal throttling | classify from observed deltas
725 | QA | power saver | classify from observed deltas
726 | QA | battery | classify from observed deltas
727 | QA | high resolution | classify from observed deltas
728 | QA | low resolution | classify from observed deltas
729 | QA | multiple monitors | classify from observed deltas
730 | QA | software rasterizer | classify from observed deltas
731 | regression | budget validator | no throw on malformed report
732 | regression | telemetry validator | no throw on malformed report
733 | regression | plan validator | no throw on malformed report
734 | regression | evidence builder | plain data
735 | regression | gate replay | deterministic
736 | regression | plan replay | deterministic
737 | regression | telemetry replay | deterministic
738 | regression | budget replay | deterministic
739 | regression | freeze semantics | stable
740 | regression | error ordering | stable
741 | regression | type ordering | stable
742 | regression | scenario ordering | stable
743 | regression | sample ordering | semantic
744 | regression | field ordering | serialization stable
745 | regression | missing scenario | fallback
746 | regression | unknown status | description fallback
747 | regression | invalid classification | validator false
748 | regression | invalid ratio | validator false
749 | regression | invalid timeout | validator false
750 | regression | invalid poll | validator false
751 | performance | normalize 240 samples | bounded
752 | performance | summarize 240 samples | bounded
753 | performance | select 32 samples | bounded
754 | performance | replay 32 samples | bounded
755 | performance | build six plans | bounded
756 | performance | validate six plans | bounded
757 | performance | serialize plan | bounded
758 | performance | serialize telemetry | bounded
759 | performance | serialize gate | bounded
760 | performance | serialize evidence | bounded
761 | accessibility | status string | readable
762 | accessibility | scenario name | stable
763 | accessibility | classification | stable
764 | accessibility | fps | numeric
765 | accessibility | timeout | numeric
766 | accessibility | reason | human-readable
767 | accessibility | inconclusive | explicit
768 | accessibility | constrained | explicit
769 | accessibility | severe | explicit
770 | accessibility | normal | explicit
771 | reporting | base SHA | required
772 | reporting | head SHA | required
773 | reporting | additions | required
774 | reporting | deletions | required
775 | reporting | tests | required
776 | reporting | CI | required
777 | reporting | blockers | required when present
778 | reporting | next task | required when package incomplete
779 | reporting | no unsupported PASS claim | required
780 | reporting | no unsupported DONE claim | required
781 | release | version strings | explicit
782 | release | limits | explicit
783 | release | action vocabulary | explicit
784 | release | status vocabulary | explicit
785 | release | ownership | explicit
786 | release | deterministic replay | explicit
787 | release | forbidden APIs | explicit
788 | release | exact-head check | explicit
789 | release | main freshness | explicit
790 | release | diff budget | explicit
791 | integration | check script | imports policy
792 | integration | check script | imports telemetry
793 | integration | check script | imports gate
794 | integration | check script | imports plan
795 | integration | workflow | invokes check scripts
796 | integration | docs | mirror runtime semantics
797 | integration | README link | optional
798 | integration | evidence | plain data
799 | integration | failures | diagnosable
800 | integration | retries | do not hide deterministic failures
801 | future | frame source | caller-owned
802 | future | measurement source | caller-owned
803 | future | scheduler source | caller-owned
804 | future | wall clock source | caller-owned
805 | future | assertion engine | caller-owned
806 | future | browser | caller-owned
807 | future | gameplay | caller-owned
808 | future | renderer | caller-owned
809 | future | physics | caller-owned
810 | future | animation | caller-owned
811 | future | combat | caller-owned
812 | future | persistence | caller-owned
813 | future | navigation | caller-owned
814 | future | assets | caller-owned
815 | future | terrain | caller-owned
816 | future | event bus | caller-owned
817 | future | actor registry | caller-owned
818 | future | quest | caller-owned
819 | future | editor | caller-owned
820 | future | audio | caller-owned
821 | design | timeout derivation | observed evidence | preferred
822 | design | fixed timeout | arbitrary | discouraged
823 | design | unbounded timeout | unsafe | prohibited
824 | design | silent skip | opaque | prohibited
825 | design | explicit inconclusive | transparent | required
826 | design | environment class | explainable | required
827 | design | measured fps | evidence | required
828 | design | p95 | evidence | required
829 | design | max delta | evidence | required
830 | design | sample count | evidence | required
831 | design | simulation envelope | scenario data | required
832 | design | reliability floor | safety | required
833 | design | global cap | safety | required
834 | design | minimum timeout | safety | required
835 | design | minimum poll | safety | required
836 | design | maximum poll | safety | required
837 | design | version | audit | required
838 | design | ownership | audit | required
839 | design | replay | audit | required
840 | design | validation | audit | required
841 | defect prevention | slow machine | no gameplay change
842 | defect prevention | fast machine | no false delay
843 | defect prevention | sparse probe | no false pass
844 | defect prevention | malformed sample | no throw
845 | defect prevention | stale branch | no merge claim
846 | defect prevention | CI queued | no green claim
847 | defect prevention | CI failed | no green claim
848 | defect prevention | exact head moved | expected-head protection
849 | defect prevention | main moved | freshness check catches
850 | defect prevention | diff over cap | completion gate blocks
851 | defect prevention | diff under target | continue meaningful work
852 | defect prevention | arbitrary padding | prohibited
853 | defect prevention | duplicate code | prohibited
854 | defect prevention | duplicate docs | prohibited
855 | defect prevention | formatting churn | insufficient
856 | defect prevention | fake scenario | insufficient
857 | defect prevention | placeholder | insufficient
858 | defect prevention | copied fixture | insufficient
859 | defect prevention | empty change | insufficient
860 | defect prevention | source-only claim | evidence required
861 | operational | preflight | classify environment
862 | operational | preflight | capture bounded samples
863 | operational | preflight | preserve raw evidence
864 | operational | preflight | summarize
865 | operational | preflight | build gate
866 | operational | preflight | choose action
867 | operational | postflight | report actual result
868 | operational | postflight | retain transcript
869 | operational | postflight | compare repeated runs
870 | operational | postflight | inspect divergence
871 | governance | work package | substantive
872 | governance | work package | not line inflation
873 | governance | completion | >4000 when sufficient work exists
874 | governance | completion | continue after 4000 when high-priority work remains
875 | governance | blocker | report exact reason
876 | governance | safety | higher priority than diff quota
877 | governance | concurrency | higher priority than diff quota
878 | governance | data loss | higher priority than diff quota
879 | governance | owner approval | higher priority than diff quota
880 | governance | CI wait | not by itself a blocker
881 | governance | repository search | required before claiming no work
882 | governance | current main | re-read during long turn
883 | governance | stale state | rebuild from live main
884 | governance | exact head | merge protection
885 | governance | expected head | merge protection
886 | governance | current main | compare before merge
887 | governance | diff count | verify before merge
888 | governance | CI result | verify before reporting
889 | governance | merge SHA | verify after merge
890 | governance | PR state | verify after merge
891 | acceptance | 4001 meaningful lines | minimum completion threshold exceeded
892 | acceptance | 4100 meaningful lines | stronger completion evidence
893 | acceptance | 4500 meaningful lines | stronger completion evidence
894 | acceptance | 5000 meaningful lines | stronger completion evidence
895 | acceptance | 4000 reached but work remains | continue
896 | acceptance | 4000 reached package complete | may complete
897 | acceptance | below 4000 but no safe work | report blocker
898 | acceptance | below 4000 due environment stop | report blocker
899 | acceptance | below 4000 due safety gate | report blocker
900 | acceptance | final evidence package | complete and auditable
