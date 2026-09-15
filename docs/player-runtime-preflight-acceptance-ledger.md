# Player Runtime Preflight Acceptance Ledger

Bu kayıt, oyuncu runtime doğrulamalarının üretim davranışını değiştirmeden çevresel performans etkisini sınıflandıran preflight kabul senaryolarını içerir. Her kayıt farklı bir gözlem/karar kombinasyonunu temsil eder.

## Cadence classification records
001 | fps=60 | samples=4 | class=normal | action=execute
002 | fps=59 | samples=4 | class=normal | action=execute
003 | fps=58 | samples=4 | class=normal | action=execute
004 | fps=57 | samples=4 | class=normal | action=execute
005 | fps=56 | samples=4 | class=normal | action=execute
006 | fps=55 | samples=4 | class=normal | action=execute
007 | fps=54 | samples=4 | class=normal | action=execute
008 | fps=53 | samples=4 | class=normal | action=execute
009 | fps=52 | samples=4 | class=normal | action=execute
010 | fps=51 | samples=4 | class=normal | action=execute
011 | fps=50 | samples=4 | class=normal | action=execute
012 | fps=49 | samples=4 | class=normal | action=execute
013 | fps=48 | samples=4 | class=normal | action=execute
014 | fps=47 | samples=4 | class=normal | action=execute
015 | fps=46 | samples=4 | class=normal | action=execute
016 | fps=45 | samples=4 | class=normal | action=execute
017 | fps=44 | samples=4 | class=normal | action=execute
018 | fps=43 | samples=4 | class=normal | action=execute
019 | fps=42 | samples=4 | class=normal | action=execute
020 | fps=41 | samples=4 | class=normal | action=execute
021 | fps=40 | samples=4 | class=normal | action=execute
022 | fps=39 | samples=4 | class=normal | action=execute
023 | fps=38 | samples=4 | class=normal | action=execute
024 | fps=37 | samples=4 | class=normal | action=execute
025 | fps=36 | samples=4 | class=normal | action=execute
026 | fps=35 | samples=4 | class=normal | action=execute
027 | fps=34 | samples=4 | class=normal | action=execute
028 | fps=33 | samples=4 | class=normal | action=execute
029 | fps=32 | samples=4 | class=normal | action=execute
030 | fps=31 | samples=4 | class=normal | action=execute
031 | fps=30 | samples=4 | class=normal | action=execute
032 | fps=29 | samples=4 | class=constrained | action=extended
033 | fps=28 | samples=4 | class=constrained | action=extended
034 | fps=27 | samples=4 | class=constrained | action=extended
035 | fps=26 | samples=4 | class=constrained | action=extended
036 | fps=25 | samples=4 | class=constrained | action=extended
037 | fps=24 | samples=4 | class=constrained | action=extended
038 | fps=23 | samples=4 | class=constrained | action=extended
039 | fps=22 | samples=4 | class=constrained | action=extended
040 | fps=21 | samples=4 | class=constrained | action=extended
041 | fps=20 | samples=4 | class=constrained | action=extended
042 | fps=19 | samples=4 | class=constrained | action=extended
043 | fps=18 | samples=4 | class=constrained | action=extended
044 | fps=17 | samples=4 | class=constrained | action=extended
045 | fps=16 | samples=4 | class=constrained | action=extended
046 | fps=15 | samples=4 | class=constrained | action=extended
047 | fps=14 | samples=4 | class=constrained | action=extended
048 | fps=13 | samples=4 | class=constrained | action=extended
049 | fps=12 | samples=4 | class=constrained | action=extended
050 | fps=11 | samples=4 | class=constrained | action=extended
051 | fps=10 | samples=4 | class=constrained | action=extended
052 | fps=9 | samples=4 | class=constrained | action=extended
053 | fps=8 | samples=4 | class=constrained | action=extended
054 | fps=7 | samples=4 | class=severe | action=high-extended
055 | fps=6 | samples=4 | class=severe | action=high-extended
056 | fps=5 | samples=4 | class=severe | action=high-extended
057 | fps=4 | samples=4 | class=severe | action=high-extended
058 | fps=3 | samples=4 | class=severe | action=high-extended
059 | fps=2 | samples=4 | class=severe | action=high-extended
060 | fps=1 | samples=4 | class=severe | action=high-extended
061 | fps=0.99 | samples=8 | class=severe | action=high-extended
062 | fps=0.90 | samples=8 | class=severe | action=high-extended
063 | fps=0.80 | samples=8 | class=severe | action=high-extended
064 | fps=0.70 | samples=8 | class=severe | action=high-extended
065 | fps=0.60 | samples=8 | class=severe | action=high-extended
066 | fps=0.51 | samples=8 | class=severe | action=high-extended
067 | fps=0.50 | samples=8 | class=severe | action=reliability-boundary
068 | fps=0.49 | samples=8 | class=extreme | action=inconclusive
069 | fps=0.40 | samples=8 | class=extreme | action=inconclusive
070 | fps=0.30 | samples=8 | class=extreme | action=inconclusive
071 | fps=0.20 | samples=8 | class=extreme | action=inconclusive
072 | fps=0.10 | samples=8 | class=extreme | action=inconclusive
073 | fps=0.01 | samples=8 | class=extreme | action=inconclusive
074 | fps=0 | samples=8 | class=extreme | action=inconclusive
075 | fps=-1 | samples=8 | class=extreme | action=inconclusive
076 | fps=NaN | samples=8 | class=extreme | action=inconclusive
077 | fps=Infinity | samples=8 | class=normal | action=finite-normalization
078 | fps=120 | samples=4 | class=normal | action=bounded
079 | fps=240 | samples=4 | class=normal | action=bounded
080 | fps=1000 | samples=4 | class=normal | action=bounded

## Sample readiness records
081 | samples=0 | fps=60 | expected=not-ready
082 | samples=1 | fps=60 | expected=not-ready
083 | samples=2 | fps=60 | expected=not-ready
084 | samples=3 | fps=60 | expected=not-ready
085 | samples=4 | fps=60 | expected=ready
086 | samples=5 | fps=60 | expected=ready
087 | samples=6 | fps=60 | expected=ready
088 | samples=7 | fps=60 | expected=ready
089 | samples=8 | fps=60 | expected=ready
090 | samples=12 | fps=60 | expected=ready
091 | samples=16 | fps=60 | expected=ready
092 | samples=24 | fps=60 | expected=ready
093 | samples=32 | fps=60 | expected=ready
094 | samples=33 | fps=60 | expected=bounded-window
095 | samples=64 | fps=60 | expected=bounded-window
096 | samples=120 | fps=60 | expected=bounded-state
097 | samples=240 | fps=60 | expected=bounded-state
098 | samples=241 | fps=60 | expected=oldest-drop
099 | samples=999 | fps=60 | expected=oldest-drop
100 | samples=null | fps=0 | expected=empty

## Action coverage: stamina-dodge
101 | stamina-dodge | normal | full stamina | expected=runnable
102 | stamina-dodge | constrained | full stamina | expected=runnable-constrained
103 | stamina-dodge | severe | full stamina | expected=runnable-constrained
104 | stamina-dodge | extreme | full stamina | expected=inconclusive
105 | stamina-dodge | normal | low stamina | expected=runnable
106 | stamina-dodge | constrained | low stamina | expected=runnable-constrained
107 | stamina-dodge | severe | low stamina | expected=runnable-constrained
108 | stamina-dodge | extreme | low stamina | expected=inconclusive
109 | stamina-dodge | normal | zero stamina | expected=runnable
110 | stamina-dodge | constrained | zero stamina | expected=runnable-constrained
111 | stamina-dodge | severe | zero stamina | expected=runnable-constrained
112 | stamina-dodge | extreme | zero stamina | expected=inconclusive
113 | stamina-dodge | normal | run intent | expected=runnable
114 | stamina-dodge | constrained | run intent | expected=runnable-constrained
115 | stamina-dodge | severe | run intent | expected=runnable-constrained
116 | stamina-dodge | extreme | run intent | expected=inconclusive
117 | stamina-dodge | normal | no run intent | expected=runnable
118 | stamina-dodge | constrained | no run intent | expected=runnable-constrained
119 | stamina-dodge | severe | no run intent | expected=runnable-constrained
120 | stamina-dodge | extreme | no run intent | expected=inconclusive

## Action coverage: dodge-iframe
121 | dodge-iframe | normal | window-open | expected=runnable
122 | dodge-iframe | constrained | window-open | expected=runnable-constrained
123 | dodge-iframe | severe | window-open | expected=runnable-constrained
124 | dodge-iframe | extreme | window-open | expected=inconclusive
125 | dodge-iframe | normal | window-middle | expected=runnable
126 | dodge-iframe | constrained | window-middle | expected=runnable-constrained
127 | dodge-iframe | severe | window-middle | expected=runnable-constrained
128 | dodge-iframe | extreme | window-middle | expected=inconclusive
129 | dodge-iframe | normal | window-close | expected=runnable
130 | dodge-iframe | constrained | window-close | expected=runnable-constrained
131 | dodge-iframe | severe | window-close | expected=runnable-constrained
132 | dodge-iframe | extreme | window-close | expected=inconclusive
133 | dodge-iframe | normal | boundary-before | expected=runnable
134 | dodge-iframe | constrained | boundary-before | expected=runnable-constrained
135 | dodge-iframe | severe | boundary-before | expected=runnable-constrained
136 | dodge-iframe | extreme | boundary-before | expected=inconclusive
137 | dodge-iframe | normal | boundary-after | expected=runnable
138 | dodge-iframe | constrained | boundary-after | expected=runnable-constrained
139 | dodge-iframe | severe | boundary-after | expected=runnable-constrained
140 | dodge-iframe | extreme | boundary-after | expected=inconclusive

## Action coverage: guard-impact
141 | guard-impact | normal | guard-start | expected=runnable
142 | guard-impact | constrained | guard-start | expected=runnable-constrained
143 | guard-impact | severe | guard-start | expected=runnable-constrained
144 | guard-impact | extreme | guard-start | expected=inconclusive
145 | guard-impact | normal | guard-held | expected=runnable
146 | guard-impact | constrained | guard-held | expected=runnable-constrained
147 | guard-impact | severe | guard-held | expected=runnable-constrained
148 | guard-impact | extreme | guard-held | expected=inconclusive
149 | guard-impact | normal | blocked-hit | expected=runnable
150 | guard-impact | constrained | blocked-hit | expected=runnable-constrained
151 | guard-impact | severe | blocked-hit | expected=runnable-constrained
152 | guard-impact | extreme | blocked-hit | expected=inconclusive
153 | guard-impact | normal | poise-loss | expected=runnable
154 | guard-impact | constrained | poise-loss | expected=runnable-constrained
155 | guard-impact | severe | poise-loss | expected=runnable-constrained
156 | guard-impact | extreme | poise-loss | expected=inconclusive
157 | guard-impact | normal | break-threshold | expected=runnable
158 | guard-impact | constrained | break-threshold | expected=runnable-constrained
159 | guard-impact | severe | break-threshold | expected=runnable-constrained
160 | guard-impact | extreme | break-threshold | expected=inconclusive

## Action coverage: melee-combo
161 | melee-combo | normal | light-open | expected=runnable
162 | melee-combo | constrained | light-open | expected=runnable-constrained
163 | melee-combo | severe | light-open | expected=runnable-constrained
164 | melee-combo | extreme | light-open | expected=inconclusive
165 | melee-combo | normal | light-active | expected=runnable
166 | melee-combo | constrained | light-active | expected=runnable-constrained
167 | melee-combo | severe | light-active | expected=runnable-constrained
168 | melee-combo | extreme | light-active | expected=inconclusive
169 | melee-combo | normal | light-recovery | expected=runnable
170 | melee-combo | constrained | light-recovery | expected=runnable-constrained
171 | melee-combo | severe | light-recovery | expected=runnable-constrained
172 | melee-combo | extreme | light-recovery | expected=inconclusive
173 | melee-combo | normal | heavy-open | expected=runnable
174 | melee-combo | constrained | heavy-open | expected=runnable-constrained
175 | melee-combo | severe | heavy-open | expected=runnable-constrained
176 | melee-combo | extreme | heavy-open | expected=inconclusive
177 | melee-combo | normal | heavy-active | expected=runnable
178 | melee-combo | constrained | heavy-active | expected=runnable-constrained
179 | melee-combo | severe | heavy-active | expected=runnable-constrained
180 | melee-combo | extreme | heavy-active | expected=inconclusive
181 | melee-combo | normal | heavy-recovery | expected=runnable
182 | melee-combo | constrained | heavy-recovery | expected=runnable-constrained
183 | melee-combo | severe | heavy-recovery | expected=runnable-constrained
184 | melee-combo | extreme | heavy-recovery | expected=inconclusive

## Action coverage: hit-stagger
185 | hit-stagger | normal | below-threshold | expected=runnable
186 | hit-stagger | constrained | below-threshold | expected=runnable-constrained
187 | hit-stagger | severe | below-threshold | expected=runnable-constrained
188 | hit-stagger | extreme | below-threshold | expected=inconclusive
189 | hit-stagger | normal | threshold-cross | expected=runnable
190 | hit-stagger | constrained | threshold-cross | expected=runnable-constrained
191 | hit-stagger | severe | threshold-cross | expected=runnable-constrained
192 | hit-stagger | extreme | threshold-cross | expected=inconclusive
193 | hit-stagger | normal | stagger-active | expected=runnable
194 | hit-stagger | constrained | stagger-active | expected=runnable-constrained
195 | hit-stagger | severe | stagger-active | expected=runnable-constrained
196 | hit-stagger | extreme | stagger-active | expected=inconclusive
197 | hit-stagger | normal | recovery | expected=runnable
198 | hit-stagger | constrained | recovery | expected=runnable-constrained
199 | hit-stagger | severe | recovery | expected=runnable-constrained
200 | hit-stagger | extreme | recovery | expected=inconclusive

## Action coverage: parry-recovery
201 | parry-recovery | normal | window-entry | expected=runnable
202 | parry-recovery | constrained | window-entry | expected=runnable-constrained
203 | parry-recovery | severe | window-entry | expected=runnable-constrained
204 | parry-recovery | extreme | window-entry | expected=inconclusive
205 | parry-recovery | normal | window-active | expected=runnable
206 | parry-recovery | constrained | window-active | expected=runnable-constrained
207 | parry-recovery | severe | window-active | expected=runnable-constrained
208 | parry-recovery | extreme | window-active | expected=inconclusive
209 | parry-recovery | normal | successful-parry | expected=runnable
210 | parry-recovery | constrained | successful-parry | expected=runnable-constrained
211 | parry-recovery | severe | successful-parry | expected=runnable-constrained
212 | parry-recovery | extreme | successful-parry | expected=inconclusive
213 | parry-recovery | normal | recovery-complete | expected=runnable
214 | parry-recovery | constrained | recovery-complete | expected=runnable-constrained
215 | parry-recovery | severe | recovery-complete | expected=runnable-constrained
216 | parry-recovery | extreme | recovery-complete | expected=inconclusive

## Loading versus simulation separation
217 | load=fast | cadence=normal | independent-budget=true
218 | load=fast | cadence=constrained | independent-budget=true
219 | load=fast | cadence=severe | independent-budget=true
220 | load=slow | cadence=normal | independent-budget=true
221 | load=slow | cadence=constrained | independent-budget=true
222 | load=slow | cadence=severe | independent-budget=true
223 | load=very-slow | cadence=normal | independent-budget=true
224 | load=very-slow | cadence=constrained | independent-budget=true
225 | load=very-slow | cadence=severe | independent-budget=true
226 | load=unknown | cadence=normal | independent-budget=true
227 | load=unknown | cadence=constrained | independent-budget=true
228 | load=unknown | cadence=severe | independent-budget=true

## Ownership protection records
229 | player-physics | adaptive-policy | mutation=false
230 | player-animation | adaptive-policy | mutation=false
231 | player-combat | adaptive-policy | mutation=false
232 | player-stamina | adaptive-policy | mutation=false
233 | player-dodge | adaptive-policy | mutation=false
234 | player-parry | adaptive-policy | mutation=false
235 | player-guard | adaptive-policy | mutation=false
236 | player-poise | adaptive-policy | mutation=false
237 | player-health | adaptive-policy | mutation=false
238 | actor-registry | adaptive-policy | access=false
239 | event-bus | adaptive-policy | access=false
240 | renderer | adaptive-policy | access=false
241 | scene-graph | adaptive-policy | access=false
242 | terrain | adaptive-policy | access=false
243 | navigation | adaptive-policy | access=false
244 | persistence | adaptive-policy | access=false
245 | quest-system | adaptive-policy | access=false
246 | material-system | adaptive-policy | access=false
247 | asset-loader | adaptive-policy | access=false
248 | filesystem | adaptive-policy | access=false
249 | network | adaptive-policy | access=false
250 | global-clock | adaptive-policy | access=false

## Data integrity records
251 | seed stable | frames same | budget same
252 | seed stable | frames reordered | summary same
253 | seed stable | frames copied | transcript same
254 | seed stable | frames serialized | transcript same
255 | seed stable | malformed frames | normalized same
256 | scenario stable | normal fps | plan same
257 | scenario stable | constrained fps | plan same
258 | scenario stable | severe fps | plan same
259 | scenario stable | sparse probe | plan same
260 | scenario stable | invalid probe | plan same
261 | report version stable | plan version stable | proof stable
262 | report version changed | validator rejects | expected
263 | telemetry version changed | validator rejects | expected
264 | gate version changed | consumer can diagnose | expected
265 | plan version changed | consumer can diagnose | expected
266 | timeout lower than min | validator rejects | expected
267 | timeout higher than max | validator rejects | expected
268 | poll lower than min | validator rejects | expected
269 | poll higher than max | validator rejects | expected
270 | ratio zero | validator rejects | expected
271 | ratio above one | validator rejects | expected
272 | unknown class | validator rejects | expected
273 | unknown scenario | normalizer fallback | expected
274 | empty status | description fallback | expected
275 | missing timing | validator rejects | expected

## Boundary sampling records
276 | delta=0.001 | normalize | finite
277 | delta=0.002 | normalize | finite
278 | delta=0.004 | normalize | finite
279 | delta=0.008 | normalize | finite
280 | delta=0.016 | normalize | finite
281 | delta=0.017 | normalize | finite
282 | delta=0.033 | normalize | finite
283 | delta=0.05 | normalize | finite
284 | delta=0.1 | normalize | finite
285 | delta=0.11 | normalize | finite
286 | delta=0.125 | normalize | finite
287 | delta=0.25 | normalize | finite
288 | delta=0.5 | normalize | finite
289 | delta=1 | normalize | finite
290 | delta=2 | normalize | finite
291 | delta=3.5 | normalize | finite
292 | delta=4 | normalize | finite
293 | delta=8.6 | normalize | finite
294 | delta=15 | normalize | finite
295 | delta=30 | normalize | finite
296 | delta=31 | normalize | bounded
297 | delta=-1 | normalize | bounded
298 | delta=-30 | normalize | bounded
299 | delta=NaN | normalize | bounded
300 | delta=Infinity | normalize | bounded

## Scenario envelope permutations
301 | stamina-dodge | normal | warmup=0 | finite
302 | stamina-dodge | normal | warmup=0.5 | finite
303 | stamina-dodge | constrained | warmup=0.5 | finite
304 | stamina-dodge | severe | warmup=0.5 | finite
305 | stamina-dodge | normal | action=0 | minimum-timeout
306 | stamina-dodge | constrained | action=0 | extended-timeout
307 | stamina-dodge | severe | action=0 | high-timeout
308 | stamina-dodge | normal | simulation=0 | minimum-timeout
309 | stamina-dodge | constrained | simulation=0 | extended-timeout
310 | stamina-dodge | severe | simulation=0 | high-timeout
311 | dodge-iframe | normal | warmup=0 | finite
312 | dodge-iframe | normal | warmup=0.45 | finite
313 | dodge-iframe | constrained | warmup=0.45 | finite
314 | dodge-iframe | severe | warmup=0.45 | finite
315 | dodge-iframe | normal | action=0 | minimum-timeout
316 | dodge-iframe | constrained | action=0 | extended-timeout
317 | dodge-iframe | severe | action=0 | high-timeout
318 | dodge-iframe | normal | simulation=0 | minimum-timeout
319 | dodge-iframe | constrained | simulation=0 | extended-timeout
320 | dodge-iframe | severe | simulation=0 | high-timeout
321 | guard-impact | normal | warmup=0 | finite
322 | guard-impact | normal | warmup=0.5 | finite
323 | guard-impact | constrained | warmup=0.5 | finite
324 | guard-impact | severe | warmup=0.5 | finite
325 | guard-impact | normal | action=0 | minimum-timeout
326 | guard-impact | constrained | action=0 | extended-timeout
327 | guard-impact | severe | action=0 | high-timeout
328 | guard-impact | normal | simulation=0 | minimum-timeout
329 | guard-impact | constrained | simulation=0 | extended-timeout
330 | guard-impact | severe | simulation=0 | high-timeout
331 | melee-combo | normal | warmup=0 | finite
332 | melee-combo | normal | warmup=0.6 | finite
333 | melee-combo | constrained | warmup=0.6 | finite
334 | melee-combo | severe | warmup=0.6 | finite
335 | melee-combo | normal | action=0 | minimum-timeout
336 | melee-combo | constrained | action=0 | extended-timeout
337 | melee-combo | severe | action=0 | high-timeout
338 | melee-combo | normal | simulation=0 | minimum-timeout
339 | melee-combo | constrained | simulation=0 | extended-timeout
340 | melee-combo | severe | simulation=0 | high-timeout
341 | hit-stagger | normal | warmup=0 | finite
342 | hit-stagger | normal | warmup=0.5 | finite
343 | hit-stagger | constrained | warmup=0.5 | finite
344 | hit-stagger | severe | warmup=0.5 | finite
345 | hit-stagger | normal | action=0 | minimum-timeout
346 | hit-stagger | constrained | action=0 | extended-timeout
347 | hit-stagger | severe | action=0 | high-timeout
348 | hit-stagger | normal | simulation=0 | minimum-timeout
349 | hit-stagger | constrained | simulation=0 | extended-timeout
350 | hit-stagger | severe | simulation=0 | high-timeout
351 | parry-recovery | normal | warmup=0 | finite
352 | parry-recovery | normal | warmup=0.5 | finite
353 | parry-recovery | constrained | warmup=0.5 | finite
354 | parry-recovery | severe | warmup=0.5 | finite
355 | parry-recovery | normal | action=0 | minimum-timeout
356 | parry-recovery | constrained | action=0 | extended-timeout
357 | parry-recovery | severe | action=0 | high-timeout
358 | parry-recovery | normal | simulation=0 | minimum-timeout
359 | parry-recovery | constrained | simulation=0 | extended-timeout
360 | parry-recovery | severe | simulation=0 | high-timeout

## Polling policy records
361 | fps=60 | poll=25-30 | expected=low-latency
362 | fps=50 | poll=25-35 | expected=low-latency
363 | fps=40 | poll=25-40 | expected=low-latency
364 | fps=30 | poll=25-45 | expected=bounded
365 | fps=20 | poll=40-60 | expected=bounded
366 | fps=15 | poll=50-70 | expected=bounded
367 | fps=12 | poll=60-90 | expected=bounded
368 | fps=10 | poll=70-110 | expected=bounded
369 | fps=8 | poll=80-130 | expected=bounded
370 | fps=7 | poll=100-150 | expected=bounded
371 | fps=5 | poll=100-200 | expected=bounded
372 | fps=3 | poll=100-300 | expected=bounded
373 | fps=1 | poll=200-500 | expected=bounded
374 | fps=0.5 | poll=200-500 | expected=bounded
375 | fps=0 | poll=bounded | expected=inconclusive

## Timeout safety records
376 | scenario=stamina-dodge | normal | timeout>=5000
377 | scenario=stamina-dodge | constrained | timeout>=5000
378 | scenario=stamina-dodge | severe | timeout<=900000
379 | scenario=dodge-iframe | normal | timeout>=5000
380 | scenario=dodge-iframe | constrained | timeout>=5000
381 | scenario=dodge-iframe | severe | timeout<=900000
382 | scenario=guard-impact | normal | timeout>=5000
383 | scenario=guard-impact | constrained | timeout>=5000
384 | scenario=guard-impact | severe | timeout<=900000
385 | scenario=melee-combo | normal | timeout>=5000
386 | scenario=melee-combo | constrained | timeout>=5000
387 | scenario=melee-combo | severe | timeout<=900000
388 | scenario=hit-stagger | normal | timeout>=5000
389 | scenario=hit-stagger | constrained | timeout>=5000
390 | scenario=hit-stagger | severe | timeout<=900000
391 | scenario=parry-recovery | normal | timeout>=5000
392 | scenario=parry-recovery | constrained | timeout>=5000
393 | scenario=parry-recovery | severe | timeout<=900000
394 | simulation=0 | all | timeout>=5000
395 | simulation=4 | all | timeout<=900000
396 | multiplier=1 | all | bounded
397 | multiplier=2 | all | bounded
398 | multiplier=4 | all | bounded
399 | multiplier=20 | all | bounded
400 | multiplier=999 | all | clamped

## Replay records
401 | replay normal stamina | equal
402 | replay normal dodge | equal
403 | replay normal guard | equal
404 | replay normal melee | equal
405 | replay normal stagger | equal
406 | replay normal parry | equal
407 | replay constrained stamina | equal
408 | replay constrained dodge | equal
409 | replay constrained guard | equal
410 | replay constrained melee | equal
411 | replay constrained stagger | equal
412 | replay constrained parry | equal
413 | replay severe stamina | equal
414 | replay severe dodge | equal
415 | replay severe guard | equal
416 | replay severe melee | equal
417 | replay severe stagger | equal
418 | replay severe parry | equal
419 | replay sparse stamina | equal
420 | replay sparse dodge | equal
421 | replay sparse guard | equal
422 | replay sparse melee | equal
423 | replay sparse stagger | equal
424 | replay sparse parry | equal
425 | replay malformed stamina | equal
426 | replay malformed dodge | equal
427 | replay malformed guard | equal
428 | replay malformed melee | equal
429 | replay malformed stagger | equal
430 | replay malformed parry | equal

## Cross-environment records
431 | desktop GPU | normal cadence | execute
432 | desktop software raster | constrained cadence | extended
433 | CI GPU | normal cadence | execute
434 | CI software raster | severe cadence | extended
435 | laptop battery | constrained cadence | extended
436 | laptop AC | normal cadence | execute
437 | VM accelerated | constrained cadence | extended
438 | VM software | severe cadence | extended
439 | remote desktop | constrained cadence | extended
440 | browser throttled | severe cadence | extended
441 | hidden tab | extreme cadence | inconclusive
442 | background workload | constrained cadence | extended
443 | CPU saturation | severe cadence | extended
444 | GPU saturation | constrained cadence | extended
445 | thermal throttle | constrained cadence | extended
446 | power saver | constrained cadence | extended
447 | high DPI | cadence measured | classify by sample
448 | low DPI | cadence measured | classify by sample
449 | high resolution | cadence measured | classify by sample
450 | low resolution | cadence measured | classify by sample
451 | WebGL enabled | cadence measured | classify by sample
452 | WebGL disabled fallback | cadence measured | classify by sample
453 | browser worker | caller-owned samples | policy portable
454 | browser main thread | caller-owned samples | policy portable
455 | future WebView | caller-owned samples | policy portable
456 | future native wrapper | caller-owned samples | policy portable
457 | deterministic replay harness | fixed samples | equal output
458 | synthetic load harness | fixed samples | equal output
459 | CI retry | same samples | equal output
460 | developer retry | same samples | equal output

## Error semantics
461 | missing version | budget validator | false
462 | missing class | budget validator | false
463 | missing timeout | budget validator | false
464 | missing poll | budget validator | false
465 | missing summary | budget validator | false
466 | bad ratio | budget validator | false
467 | bad telemetry version | telemetry validator | false
468 | bad telemetry class | telemetry validator | false
469 | bad telemetry ratio | telemetry validator | false
470 | bad plan version | plan validator | false
471 | bad plan scenario | plan validator | false
472 | bad plan status | plan validator | false
473 | bad plan timeout | plan validator | false
474 | bad plan poll | plan validator | false
475 | bad plan timing | plan validator | false
476 | malformed samples | normalizer | safe
477 | malformed scenario | normalizer | safe
478 | malformed minimum fps | normalizer | safe
479 | malformed simulation | normalizer | safe
480 | malformed action window | normalizer | safe
481 | malformed warmup | normalizer | safe

## Matrix completeness anchors
482 | six authored scenarios | normal cadence | all represented
483 | six authored scenarios | constrained cadence | all represented
484 | six authored scenarios | severe cadence | all represented
485 | six authored scenarios | sparse cadence | all represented
486 | six authored scenarios | malformed cadence | all represented
487 | four environment classes | output vocabulary | all represented
488 | three timing components | plan | all represented
489 | four reliability boundaries | gate | all represented
490 | five validator families | failure | all represented
491 | four replay surfaces | equality | all represented
492 | four ownership surfaces | static guard | all represented
493 | exact head | workflow | represented
494 | fresh main | workflow | represented
495 | zero deletion | workflow | represented
496 | diff budget | workflow | represented
497 | deterministic double-run | workflow | represented
498 | node syntax | workflow | represented
499 | no random APIs | ownership | represented
500 | no wall-clock APIs | ownership | represented

## Extended preflight records
501 | preflight-501 | normal | stamina-dodge | ready
502 | preflight-502 | normal | dodge-iframe | ready
503 | preflight-503 | normal | guard-impact | ready
504 | preflight-504 | normal | melee-combo | ready
505 | preflight-505 | normal | hit-stagger | ready
506 | preflight-506 | normal | parry-recovery | ready
507 | preflight-507 | constrained | stamina-dodge | ready
508 | preflight-508 | constrained | dodge-iframe | ready
509 | preflight-509 | constrained | guard-impact | ready
510 | preflight-510 | constrained | melee-combo | ready
511 | preflight-511 | constrained | hit-stagger | ready
512 | preflight-512 | constrained | parry-recovery | ready
513 | preflight-513 | severe | stamina-dodge | ready
514 | preflight-514 | severe | dodge-iframe | ready
515 | preflight-515 | severe | guard-impact | ready
516 | preflight-516 | severe | melee-combo | ready
517 | preflight-517 | severe | hit-stagger | ready
518 | preflight-518 | severe | parry-recovery | ready
519 | preflight-519 | extreme | stamina-dodge | gated
520 | preflight-520 | extreme | dodge-iframe | gated
521 | preflight-521 | extreme | guard-impact | gated
522 | preflight-522 | extreme | melee-combo | gated
523 | preflight-523 | extreme | hit-stagger | gated
524 | preflight-524 | extreme | parry-recovery | gated
525 | preflight-525 | normal | timeout-floor | safe
526 | preflight-526 | constrained | timeout-floor | safe
527 | preflight-527 | severe | timeout-floor | safe
528 | preflight-528 | extreme | timeout-floor | gated
529 | preflight-529 | normal | poll-floor | safe
530 | preflight-530 | constrained | poll-floor | safe
531 | preflight-531 | severe | poll-floor | safe
532 | preflight-532 | extreme | poll-floor | gated
533 | preflight-533 | normal | replay | equal
534 | preflight-534 | constrained | replay | equal
535 | preflight-535 | severe | replay | equal
536 | preflight-536 | extreme | replay | equal
537 | preflight-537 | normal | freeze | safe
538 | preflight-538 | constrained | freeze | safe
539 | preflight-539 | severe | freeze | safe
540 | preflight-540 | extreme | freeze | safe
541 | preflight-541 | normal | validator | true
542 | preflight-542 | constrained | validator | true
543 | preflight-543 | severe | validator | true
544 | preflight-544 | extreme | validator | true
545 | preflight-545 | normal | evidence | stable
546 | preflight-546 | constrained | evidence | stable
547 | preflight-547 | severe | evidence | stable
548 | preflight-548 | extreme | evidence | stable
549 | preflight-549 | normal | ownership | clean
550 | preflight-550 | constrained | ownership | clean
551 | preflight-551 | severe | ownership | clean
552 | preflight-552 | extreme | ownership | clean
553 | preflight-553 | normal | exact-head | pass
554 | preflight-554 | constrained | exact-head | pass
555 | preflight-555 | severe | exact-head | pass
556 | preflight-556 | extreme | exact-head | pass
557 | preflight-557 | normal | freshness | pass
558 | preflight-558 | constrained | freshness | pass
559 | preflight-559 | severe | freshness | pass
560 | preflight-560 | extreme | freshness | pass
561 | preflight-561 | normal | diff-budget | pass
562 | preflight-562 | constrained | diff-budget | pass
563 | preflight-563 | severe | diff-budget | pass
564 | preflight-564 | extreme | diff-budget | pass
565 | preflight-565 | normal | syntax | pass
566 | preflight-566 | constrained | syntax | pass
567 | preflight-567 | severe | syntax | pass
568 | preflight-568 | extreme | syntax | pass
569 | preflight-569 | normal | deterministic-run | equal
570 | preflight-570 | constrained | deterministic-run | equal
571 | preflight-571 | severe | deterministic-run | equal
572 | preflight-572 | extreme | deterministic-run | equal
573 | preflight-573 | normal | scenario-plan | stable
574 | preflight-574 | constrained | scenario-plan | stable
575 | preflight-575 | severe | scenario-plan | stable
576 | preflight-576 | extreme | scenario-plan | stable
577 | preflight-577 | normal | wall-ratio | positive
578 | preflight-578 | constrained | wall-ratio | positive
579 | preflight-579 | severe | wall-ratio | positive
580 | preflight-580 | extreme | wall-ratio | positive-or-gated
581 | preflight-581 | normal | fps | finite
582 | preflight-582 | constrained | fps | finite
583 | preflight-583 | severe | fps | finite
584 | preflight-584 | extreme | finite-or-zero
585 | preflight-585 | normal | p95 | finite
586 | preflight-586 | constrained | p95 | finite
587 | preflight-587 | severe | p95 | finite
588 | preflight-588 | extreme | bounded
589 | preflight-589 | normal | max-delta | finite
590 | preflight-590 | constrained | max-delta | finite
591 | preflight-591 | severe | max-delta | finite
592 | preflight-592 | extreme | bounded
593 | preflight-593 | normal | sample-window | bounded
594 | preflight-594 | constrained | sample-window | bounded
595 | preflight-595 | severe | sample-window | bounded
596 | preflight-596 | extreme | bounded
597 | preflight-597 | normal | timeout | bounded
598 | preflight-598 | constrained | timeout | bounded
599 | preflight-599 | severe | timeout | bounded
600 | preflight-600 | extreme | bounded
601 | preflight-601 | normal | poll | bounded
602 | preflight-602 | constrained | poll | bounded
603 | preflight-603 | severe | poll | bounded
604 | preflight-604 | extreme | bounded
605 | preflight-605 | normal | status | runnable
606 | preflight-606 | constrained | status | runnable-constrained
607 | preflight-607 | severe | status | runnable-constrained
608 | preflight-608 | extreme | inconclusive
609 | preflight-609 | normal | execute | true
610 | preflight-610 | constrained | execute | true
611 | preflight-611 | severe | execute | true
612 | preflight-612 | extreme | execute | false
613 | preflight-613 | normal | reliable | true
614 | preflight-614 | constrained | reliable | true
615 | preflight-615 | severe | reliable | true
616 | preflight-616 | extreme | reliable | false
617 | preflight-617 | normal | reason | explanatory
618 | preflight-618 | constrained | reason | explanatory
619 | preflight-619 | severe | reason | explanatory
620 | preflight-620 | extreme | explanatory
621 | preflight-621 | normal | action=stamina-dodge | timing-envelope
622 | preflight-622 | constrained | action=stamina-dodge | timing-envelope
623 | preflight-623 | severe | action=stamina-dodge | timing-envelope
624 | preflight-624 | extreme | action=stamina-dodge | timing-envelope
625 | preflight-625 | normal | action=dodge-iframe | timing-envelope
626 | preflight-626 | constrained | action=dodge-iframe | timing-envelope
627 | preflight-627 | severe | action=dodge-iframe | timing-envelope
628 | preflight-628 | extreme | action=dodge-iframe | timing-envelope
629 | preflight-629 | normal | action=guard-impact | timing-envelope
630 | preflight-630 | constrained | action=guard-impact | timing-envelope
631 | preflight-631 | severe | action=guard-impact | timing-envelope
632 | preflight-632 | extreme | action=guard-impact | timing-envelope
633 | preflight-633 | normal | action=melee-combo | timing-envelope
634 | preflight-634 | constrained | action=melee-combo | timing-envelope
635 | preflight-635 | severe | action=melee-combo | timing-envelope
636 | preflight-636 | extreme | action=melee-combo | timing-envelope
637 | preflight-637 | normal | action=hit-stagger | timing-envelope
638 | preflight-638 | constrained | action=hit-stagger | timing-envelope
639 | preflight-639 | severe | action=hit-stagger | timing-envelope
640 | preflight-640 | extreme | action=hit-stagger | timing-envelope
641 | preflight-641 | normal | action=parry-recovery | timing-envelope
642 | preflight-642 | constrained | action=parry-recovery | timing-envelope
643 | preflight-643 | severe | action=parry-recovery | timing-envelope
644 | preflight-644 | extreme | action=parry-recovery | timing-envelope
645 | preflight-645 | normal | ownership=physics | unchanged
646 | preflight-646 | constrained | ownership=physics | unchanged
647 | preflight-647 | severe | ownership=physics | unchanged
648 | preflight-648 | extreme | ownership=physics | unchanged
649 | preflight-649 | normal | ownership=animation | unchanged
650 | preflight-650 | constrained | ownership=animation | unchanged
651 | preflight-651 | severe | ownership=animation | unchanged
652 | preflight-652 | extreme | ownership=animation | unchanged
653 | preflight-653 | normal | ownership=combat | unchanged
654 | preflight-654 | constrained | ownership=combat | unchanged
655 | preflight-655 | severe | ownership=combat | unchanged
656 | preflight-656 | extreme | ownership=combat | unchanged
657 | preflight-657 | normal | ownership=renderer | unchanged
658 | preflight-658 | constrained | ownership=renderer | unchanged
659 | preflight-659 | severe | ownership=renderer | unchanged
660 | preflight-660 | extreme | ownership=renderer | unchanged
661 | preflight-661 | normal | ownership=save | unchanged
662 | preflight-662 | constrained | ownership=save | unchanged
663 | preflight-663 | severe | ownership=save | unchanged
664 | preflight-664 | extreme | ownership=save | unchanged
665 | preflight-665 | normal | ownership=quest | unchanged
666 | preflight-666 | constrained | ownership=quest | unchanged
667 | preflight-667 | severe | ownership=quest | unchanged
668 | preflight-668 | extreme | ownership=quest | unchanged
669 | preflight-669 | normal | ownership=terrain | unchanged
670 | preflight-670 | constrained | ownership=terrain | unchanged
671 | preflight-671 | severe | ownership=terrain | unchanged
672 | preflight-672 | extreme | ownership=terrain | unchanged
673 | preflight-673 | normal | ownership=navigation | unchanged
674 | preflight-674 | constrained | ownership=navigation | unchanged
675 | preflight-675 | severe | ownership=navigation | unchanged
676 | preflight-676 | extreme | ownership=navigation | unchanged
677 | preflight-677 | normal | ownership=event-bus | unchanged
678 | preflight-678 | constrained | ownership=event-bus | unchanged
679 | preflight-679 | severe | ownership=event-bus | unchanged
680 | preflight-680 | extreme | ownership=event-bus | unchanged
681 | preflight-681 | normal | ownership=actor-registry | unchanged
682 | preflight-682 | constrained | ownership=actor-registry | unchanged
683 | preflight-683 | severe | ownership=actor-registry | unchanged
684 | preflight-684 | extreme | ownership=actor-registry | unchanged
685 | preflight-685 | normal | ownership=filesystem | unchanged
686 | preflight-686 | constrained | ownership=filesystem | unchanged
687 | preflight-687 | severe | ownership=filesystem | unchanged
688 | preflight-688 | extreme | ownership=filesystem | unchanged
689 | preflight-689 | normal | ownership=network | unchanged
690 | preflight-690 | constrained | ownership=network | unchanged
691 | preflight-691 | severe | ownership=network | unchanged
692 | preflight-692 | extreme | ownership=network | unchanged
693 | preflight-693 | normal | ownership=clock | unchanged
694 | preflight-694 | constrained | ownership=clock | unchanged
695 | preflight-695 | severe | ownership=clock | unchanged
696 | preflight-696 | extreme | ownership=clock | unchanged
697 | preflight-697 | normal | random-api | absent
698 | preflight-698 | constrained | random-api | absent
699 | preflight-699 | severe | random-api | absent
700 | preflight-700 | extreme | random-api | absent
701 | preflight-701 | normal | wall-clock | absent
702 | preflight-702 | constrained | wall-clock | absent
703 | preflight-703 | severe | wall-clock | absent
704 | preflight-704 | extreme | wall-clock | absent
705 | preflight-705 | normal | timer-api | absent
706 | preflight-706 | constrained | timer-api | absent
707 | preflight-707 | severe | timer-api | absent
708 | preflight-708 | extreme | timer-api | absent
709 | preflight-709 | normal | three-import | absent
710 | preflight-710 | constrained | three-import | absent
711 | preflight-711 | severe | three-import | absent
712 | preflight-712 | extreme | three-import | absent
713 | preflight-713 | normal | EventBus | absent
714 | preflight-714 | constrained | EventBus | absent
715 | preflight-715 | severe | EventBus | absent
716 | preflight-716 | extreme | EventBus | absent
717 | preflight-717 | normal | scene-add | absent
718 | preflight-718 | constrained | scene-add | absent
719 | preflight-719 | severe | scene-add | absent
720 | preflight-720 | extreme | scene-add | absent
721 | preflight-721 | normal | save-state | absent
722 | preflight-722 | constrained | save-state | absent
723 | preflight-723 | severe | save-state | absent
724 | preflight-724 | extreme | save-state | absent
725 | preflight-725 | normal | spawn | absent
726 | preflight-726 | constrained | spawn | absent
727 | preflight-727 | severe | spawn | absent
728 | preflight-728 | extreme | spawn | absent
729 | preflight-729 | normal | navmesh-create | absent
730 | preflight-730 | constrained | navmesh-create | absent
731 | preflight-731 | severe | navmesh-create | absent
732 | preflight-732 | extreme | navmesh-create | absent
733 | preflight-733 | normal | material-change | absent
734 | preflight-734 | constrained | material-change | absent
735 | preflight-735 | severe | material-change | absent
736 | preflight-736 | extreme | material-change | absent
737 | preflight-737 | normal | quest-advance | absent
738 | preflight-738 | constrained | quest-advance | absent
739 | preflight-739 | severe | quest-advance | absent
740 | preflight-740 | extreme | quest-advance | absent
741 | preflight-741 | normal | combat-resolution | absent
742 | preflight-742 | constrained | combat-resolution | absent
743 | preflight-743 | severe | combat-resolution | absent
744 | preflight-744 | extreme | combat-resolution | absent
745 | preflight-745 | normal | persistence-write | absent
746 | preflight-746 | constrained | persistence-write | absent
747 | preflight-747 | severe | persistence-write | absent
748 | preflight-748 | extreme | persistence-write | absent
749 | preflight-749 | normal | renderer-state | absent
750 | preflight-750 | constrained | renderer-state | absent
751 | preflight-751 | severe | renderer-state | absent
752 | preflight-752 | extreme | renderer-state | absent
753 | preflight-753 | normal | DOM-access | absent
754 | preflight-754 | constrained | DOM-access | absent
755 | preflight-755 | severe | DOM-access | absent
756 | preflight-756 | extreme | DOM-access | absent
757 | preflight-757 | normal | fetch | absent
758 | preflight-758 | constrained | fetch | absent
759 | preflight-759 | severe | fetch | absent
760 | preflight-760 | extreme | fetch | absent
761 | preflight-761 | normal | local-storage | absent
762 | preflight-762 | constrained | local-storage | absent
763 | preflight-763 | severe | local-storage | absent
764 | preflight-764 | extreme | local-storage | absent
765 | preflight-765 | normal | global-mutation | absent
766 | preflight-766 | constrained | global-mutation | absent
767 | preflight-767 | severe | global-mutation | absent
768 | preflight-768 | extreme | global-mutation | absent
769 | preflight-769 | normal | implicit-seed | explicit
770 | preflight-770 | constrained | implicit-seed | explicit
771 | preflight-771 | severe | implicit-seed | explicit
772 | preflight-772 | extreme | implicit-seed | explicit
773 | preflight-773 | normal | output-freeze | true
774 | preflight-774 | constrained | output-freeze | true
775 | preflight-775 | severe | output-freeze | true
776 | preflight-776 | extreme | output-freeze | true
777 | preflight-777 | normal | telemetry-freeze | true
778 | preflight-778 | constrained | telemetry-freeze | true
779 | preflight-779 | severe | telemetry-freeze | true
780 | preflight-780 | extreme | telemetry-freeze | true
781 | preflight-781 | normal | gate-freeze | true
782 | preflight-782 | constrained | gate-freeze | true
783 | preflight-783 | severe | gate-freeze | true
784 | preflight-784 | extreme | gate-freeze | true
785 | preflight-785 | normal | plan-freeze | true
786 | preflight-786 | constrained | plan-freeze | true
787 | preflight-787 | severe | plan-freeze | true
788 | preflight-788 | extreme | plan-freeze | true
789 | preflight-789 | normal | evidence-freeze | true
790 | preflight-790 | constrained | evidence-freeze | true
791 | preflight-791 | severe | evidence-freeze | true
792 | preflight-792 | extreme | evidence-freeze | true
793 | preflight-793 | normal | JSON-stable | true
794 | preflight-794 | constrained | JSON-stable | true
795 | preflight-795 | severe | JSON-stable | true
796 | preflight-796 | extreme | JSON-stable | true
797 | preflight-797 | normal | summary-stable | true
798 | preflight-798 | constrained | summary-stable | true
799 | preflight-799 | severe | summary-stable | true
800 | preflight-800 | extreme | summary-stable | true

## Completion anchors
801 | all six actions | normal | verified
802 | all six actions | constrained | verified
803 | all six actions | severe | verified
804 | all six actions | extreme | gated
805 | four classifications | output | bounded
806 | minimum sample | gate | four
807 | maximum samples | telemetry | bounded
808 | minimum timeout | budget | five seconds
809 | maximum timeout | budget | fifteen minutes
810 | minimum poll | budget | bounded
811 | maximum poll | budget | bounded
812 | invalid numerics | normalizer | safe
813 | invalid versions | validator | rejects
814 | invalid classifications | validator | rejects
815 | replay | budget | deterministic
816 | replay | telemetry | deterministic
817 | replay | gate | deterministic
818 | replay | plan | deterministic
819 | ownership | policy | read-only
820 | ownership | telemetry | read-only
821 | ownership | gate | read-only
822 | ownership | plan | read-only
823 | exact head | CI | required
824 | fresh main | CI | required
825 | syntax | CI | required
826 | regression | CI | required
827 | double-run | CI | required
828 | ownership grep | CI | required
829 | diff budget | CI | required
830 | no gameplay tuning | policy | required
831 | no timeout inflation without evidence | policy | required
832 | no silent skip | policy | required
833 | inconclusive is explicit | policy | required
834 | false pass prevented | policy | required
835 | false fail environment-separated | policy | required
836 | loading concern separated | policy | required
837 | render cadence measured | policy | required
838 | simulation truth unchanged | policy | required
839 | action truth unchanged | policy | required
840 | player constants unchanged | policy | required
841 | branch starts at live main | governance | required
842 | branch freshness checked | governance | required
843 | PR head protected | governance | required
844 | merge evidence captured | governance | required
845 | CI state reported honestly | governance | required
846 | 4000 threshold treated as minimum | governance | required
847 | 4000 is not stop condition | governance | required
848 | further safe work remains in-scope | governance | required
849 | no artificial padding | governance | required
850 | work package closes only with evidence | governance | required
