# Groundwater Surface Detail Review Cases

Each row below is a concrete review assertion for the current render-only detail stack.

## Wet surface review

W001 | wet peat + shallow table | puddle core remains bounded.
W002 | wet peat + deep table | water-table proximity remains bounded.
W003 | wet silt + low drainage | wet rim remains bounded.
W004 | wet loam + high drainage | puddle persistence remains bounded.
W005 | wet alluvium + high runoff | fine film remains bounded.
W006 | wet clay + low permeability | capillary damp remains bounded.
W007 | wet gravel + high permeability | capillary damp remains bounded.
W008 | wet coastal silt | salt ring remains bounded.
W009 | wet marsh | marsh transition remains bounded.
W010 | wet valley | seepage band remains bounded.
W011 | wet foothill | seepage band remains bounded.
W012 | wet low slope | puddle core remains finite.
W013 | wet medium slope | puddle edge remains finite.
W014 | wet steep slope | puddle core remains finite.
W015 | wet high wind | drying contrast remains bounded.
W016 | wet low wind | recovery halo remains bounded.
W017 | wet high temperature | evaporation front remains finite.
W018 | wet low temperature | freeze edge remains finite.
W019 | wet high wet history | recovery halo remains finite.
W020 | wet high dry history | recovery halo remains finite.
W021 | wet storm event | event delta remains bounded.
W022 | wet snowmelt event | event delta remains bounded.
W023 | wet recovery event | event delta remains bounded.
W024 | wet freeze-thaw event | event delta remains bounded.
W025 | wet drought event | event delta remains bounded.
W026 | wet complete sample | confidence remains finite.
W027 | wet sparse sample | confidence remains finite.
W028 | wet malformed sample | confidence remains finite.
W029 | wet large coordinates | field remains deterministic.
W030 | wet negative coordinates | field remains deterministic.

## Dry surface review

D001 | dry sand + high temperature | evaporation front remains bounded.
D002 | dry gravel + high temperature | mineral crust remains bounded.
D003 | dry loam + high drainage | drying contrast remains bounded.
D004 | dry clay + low drainage | capillary response remains bounded.
D005 | dry alluvium + no runoff | fine film remains bounded.
D006 | dry peat + long dry history | recovery remains bounded.
D007 | dry plateau + strong wind | evaporation remains bounded.
D008 | dry plateau + weak wind | recovery remains finite.
D009 | dry desert + zero rain | all channels remain finite.
D010 | dry desert + maximum rain | all channels remain finite.
D011 | dry highland + zero wet days | memory remains finite.
D012 | dry highland + maximum wet days | memory remains finite.
D013 | dry coastal + salt exposure | crust remains bounded.
D014 | dry valley + shallow table | proximity remains bounded.
D015 | dry valley + deep table | proximity remains bounded.
D016 | dry slope zero | puddle remains bounded.
D017 | dry slope thirty | puddle remains bounded.
D018 | dry slope seventy | puddle remains bounded.
D019 | dry slope eighty-nine | puddle remains bounded.
D020 | dry negative height | material remains bounded.
D021 | dry extreme height | material remains bounded.
D022 | dry cold event | freeze edge remains finite.
D023 | dry hot event | evaporation remains finite.
D024 | drought event full intensity | material remains bounded.
D025 | drought event zero intensity | delta is zero.
D026 | unknown event | delta is zero.
D027 | dry complete sample | confidence remains finite.
D028 | dry sparse sample | confidence remains finite.
D029 | dry malformed sample | confidence remains finite.
D030 | dry extreme coordinates | field remains deterministic.

## Freeze and thaw review

F001 | -40C + wet soil | freeze edge is finite.
F002 | -20C + wet soil | freeze edge is finite.
F003 | -10C + wet soil | freeze edge is finite.
F004 | -5C + wet soil | freeze edge is finite.
F005 | -1C + wet soil | freeze edge is finite.
F006 | 0C + wet soil | freeze edge is finite.
F007 | 2C + wet soil | freeze edge is finite.
F008 | 5C + wet soil | freeze edge is finite.
F009 | 10C + wet soil | freeze edge is finite.
F010 | 20C + wet soil | freeze edge is finite.
F011 | alpine basalt + freeze | micro relief stays bounded.
F012 | alpine granite + freeze | micro relief stays bounded.
F013 | alpine schist + freeze | seepage stays bounded.
F014 | tundra silt + freeze | marsh transition stays bounded.
F015 | tundra basalt + freeze | crust stays bounded.
F016 | wetland peat + freeze | wet rim stays bounded.
F017 | clay + freeze | capillary remains bounded.
F018 | gravel + freeze | puddle remains bounded.
F019 | high wind + freeze | drying remains bounded.
F020 | low wind + freeze | recovery remains bounded.
F021 | zero runoff + freeze | all channels finite.
F022 | full runoff + freeze | all channels finite.
F023 | zero rainfall + freeze | all channels finite.
F024 | full rainfall + freeze | all channels finite.
F025 | zero wet history + freeze | memory remains finite.
F026 | maximum wet history + freeze | memory remains finite.
F027 | zero dry history + freeze | memory remains finite.
F028 | maximum dry history + freeze | memory remains finite.
F029 | cycle start + freeze | signature repeats.
F030 | cycle end + freeze | signature repeats.

## Snowmelt review

S001 | shallow snowmelt table | capillary remains bounded.
S002 | deep snowmelt table | proximity remains bounded.
S003 | shallow slope snowmelt | puddle remains bounded.
S004 | steep slope snowmelt | puddle remains bounded.
S005 | high runoff snowmelt | fine film remains bounded.
S006 | low runoff snowmelt | fine film remains bounded.
S007 | high soil depth snowmelt | capillary remains bounded.
S008 | low soil depth snowmelt | capillary remains bounded.
S009 | high permeability snowmelt | capillary remains bounded.
S010 | low permeability snowmelt | capillary remains bounded.
S011 | cold snowmelt | freeze edge remains finite.
S012 | warm snowmelt | drying remains finite.
S013 | storm followed by snowmelt | event delta remains finite.
S014 | drought followed by snowmelt | event delta remains finite.
S015 | freeze followed by snowmelt | event delta remains finite.
S016 | recovery followed by snowmelt | event delta remains finite.
S017 | low drainage snowmelt | puddle remains bounded.
S018 | high drainage snowmelt | puddle remains bounded.
S019 | coastal snowmelt | salt ring remains bounded.
S020 | marsh snowmelt | marsh transition remains bounded.
S021 | valley snowmelt | proximity remains bounded.
S022 | foothill snowmelt | seepage remains bounded.
S023 | montane snowmelt | freeze edge remains bounded.
S024 | alpine snowmelt | freeze edge remains bounded.
S025 | complete snowmelt sample | confidence finite.
S026 | sparse snowmelt sample | confidence finite.
S027 | malformed snowmelt sample | confidence finite.
S028 | repeated snowmelt | signature repeats.
S029 | full snowmelt intensity | material bounded.
S030 | zero snowmelt intensity | delta is zero.

## Storm review

R001 | storm + wetland | puddle remains bounded.
R002 | storm + riparian | film remains bounded.
R003 | storm + temperate | fine transport remains bounded.
R004 | storm + dryland | wetness remains bounded.
R005 | storm + desert | wetness remains bounded.
R006 | storm + coastal | salt ring remains bounded.
R007 | storm + forest | seepage remains bounded.
R008 | storm + montane | runoff presentation remains bounded.
R009 | storm + alpine | freeze competition remains bounded.
R010 | storm + tundra | wet edge remains bounded.
R011 | storm + zero drainage | puddle remains bounded.
R012 | storm + full drainage | puddle remains bounded.
R013 | storm + zero permeability | capillary remains bounded.
R014 | storm + full permeability | capillary remains bounded.
R015 | storm + zero soil | surface remains bounded.
R016 | storm + deep soil | surface remains bounded.
R017 | storm + zero water distance | proximity remains bounded.
R018 | storm + large water distance | proximity remains bounded.
R019 | storm + shallow groundwater | wetness remains bounded.
R020 | storm + deep groundwater | wetness remains bounded.
R021 | storm + zero wet history | memory remains bounded.
R022 | storm + maximum wet history | memory remains bounded.
R023 | storm + zero dry history | memory remains bounded.
R024 | storm + maximum dry history | memory remains bounded.
R025 | storm day one | signature finite.
R026 | storm day one hundred eighty | signature finite.
R027 | storm day three hundred fifty-nine | signature finite.
R028 | storm negative day | normalized signature finite.
R029 | storm overflow day | normalized signature finite.
R030 | storm extreme coordinates | deterministic signature.

## Drought review

T001 | drought + sand | crust remains bounded.
T002 | drought + gravel | crust remains bounded.
T003 | drought + clay | capillary remains bounded.
T004 | drought + loam | drying remains bounded.
T005 | drought + silt | fine film remains bounded.
T006 | drought + peat | recovery remains bounded.
T007 | drought + high wind | evaporation remains bounded.
T008 | drought + low wind | recovery remains bounded.
T009 | drought + hot temperature | evaporation remains bounded.
T010 | drought + cold temperature | freeze remains bounded.
T011 | drought + shallow table | proximity remains bounded.
T012 | drought + deep table | proximity remains bounded.
T013 | drought + low drainage | puddle remains bounded.
T014 | drought + high drainage | drying remains bounded.
T015 | drought + low slope | puddle remains bounded.
T016 | drought + high slope | puddle remains bounded.
T017 | drought + zero rain | dryness remains bounded.
T018 | drought + full rain | wetness remains bounded.
T019 | drought + zero runoff | fine film remains bounded.
T020 | drought + full runoff | fine film remains bounded.
T021 | drought + low soil | material remains bounded.
T022 | drought + deep soil | material remains bounded.
T023 | drought + low permeability | capillary remains bounded.
T024 | drought + high permeability | capillary remains bounded.
T025 | drought + coastal | mineral crust remains finite.
T026 | drought + wetland | drying contrast remains finite.
T027 | drought + alpine | freeze contrast remains finite.
T028 | drought + tundra | freeze contrast remains finite.
T029 | drought repeated | signature repeats.
T030 | drought intensity zero | delta is zero.

## Blend review

B001 | mix zero | left channel identity is preserved.
B002 | mix one | right channel identity is preserved.
B003 | mix half | channel bounds are preserved.
B004 | mix negative | clamped to left.
B005 | mix greater than one | clamped to right.
B006 | wet + dry | output remains bounded.
B007 | lowland + upland | output remains bounded.
B008 | coastal + inland | output remains bounded.
B009 | storm frame + recovery frame | output remains bounded.
B010 | drought frame + snowmelt frame | output remains bounded.
B011 | freeze frame + wet frame | output remains bounded.
B012 | high confidence + low confidence | output remains bounded.
B013 | identical frames | distance is zero.
B014 | nearby frames | distance finite.
B015 | distant frames | distance finite.
B016 | repeated blend | signature repeats.
B017 | reversed blend | complementary result.
B018 | all channels present | all keys preserved.
B019 | missing left channel | safe zero fallback.
B020 | missing right channel | safe zero fallback.
B021 | NaN left channel | safe zero fallback.
B022 | Infinity right channel | safe zero fallback.
B023 | empty channel map | safe result.
B024 | frozen left | no mutation.
B025 | frozen right | no mutation.
B026 | detail signature after blend | deterministic.
B027 | material after blend | bounded.
B028 | wetness after blend | bounded.
B029 | dryness after blend | bounded.
B030 | hydro balance after blend | finite.

## Material review

M001 | default base color | response is finite.
M002 | black base color | response remains bounded.
M003 | white base color | response remains bounded.
M004 | saturated base color | response remains bounded.
M005 | roughness zero | response remains bounded.
M006 | roughness one | response remains bounded.
M007 | negative roughness | response clamps.
M008 | roughness above one | response clamps.
M009 | strong puddle | roughness remains bounded.
M010 | strong crust | roughness remains bounded.
M011 | strong wet rim | roughness remains bounded.
M012 | strong drying | roughness remains bounded.
M013 | strong micro relief | normal remains bounded.
M014 | strong freeze edge | normal remains bounded.
M015 | strong fine film | normal remains bounded.
M016 | zero detail | material remains valid.
M017 | full detail | material remains valid.
M018 | repeated response | signature repeats.
M019 | event-applied response | bounded.
M020 | storm-applied response | bounded.
M021 | drought-applied response | bounded.
M022 | freeze-applied response | bounded.
M023 | snowmelt-applied response | bounded.
M024 | recovery-applied response | bounded.
M025 | missing base color | safe fallback.
M026 | missing roughness | safe fallback.
M027 | malformed material | safe fallback.
M028 | material object freeze | expected true.
M029 | color object freeze | expected true.
M030 | final wetness | bounded.

## Confidence review

C001 | complete environment | high confidence is possible.
C002 | missing moisture | confidence remains finite.
C003 | missing rainfall | confidence remains finite.
C004 | missing runoff | confidence remains finite.
C005 | missing soil depth | confidence remains finite.
C006 | missing permeability | confidence remains finite.
C007 | missing water distance | confidence remains finite.
C008 | missing groundwater depth | confidence remains finite.
C009 | missing wet days | confidence remains finite.
C010 | missing dry days | confidence remains finite.
C011 | missing temperature | confidence remains finite.
C012 | missing drainage | confidence remains finite.
C013 | missing wind exposure | confidence remains finite.
C014 | malformed coordinates | confidence remains finite.
C015 | extreme coordinate | confidence remains finite.
C016 | sparse object | confidence remains finite.
C017 | empty object | confidence remains finite.
C018 | null-like object | confidence remains finite.
C019 | repeated sparse input | signature repeats.
C020 | sparse stack input | audit passes.
C021 | low confidence detail | render tier may suppress.
C022 | complete detail | render tier remains known.
C023 | high wet detail | render tier remains known.
C024 | high dry detail | render tier remains known.
C025 | mixed detail | render tier remains known.
C026 | confidence in signature | deterministic.
C027 | confidence in telemetry | deterministic.
C028 | confidence in grid | finite.
C029 | confidence after blend | bounded.
C030 | confidence after event | bounded.

## Canonical ownership review

K001 | detail resolve | height remains unchanged.
K002 | detail resolve | hydrology remains unchanged.
K003 | detail resolve | coastline remains unchanged.
K004 | detail resolve | collider remains unchanged.
K005 | detail resolve | vegetation remains unchanged.
K006 | detail resolve | new geography remains false.
K007 | detail event | height remains unchanged.
K008 | detail event | hydrology remains unchanged.
K009 | detail event | coastline remains unchanged.
K010 | detail event | collider remains unchanged.
K011 | detail event | vegetation remains unchanged.
K012 | detail blend | height remains unchanged.
K013 | detail blend | hydrology remains unchanged.
K014 | detail blend | coastline remains unchanged.
K015 | detail blend | collider remains unchanged.
K016 | detail blend | vegetation remains unchanged.
K017 | stack resolve | height remains unchanged.
K018 | stack resolve | hydrology remains unchanged.
K019 | stack resolve | coastline remains unchanged.
K020 | stack resolve | collider remains unchanged.
K021 | stack resolve | vegetation remains unchanged.
K022 | shader | no vertex write.
K023 | shader | no displacement write.
K024 | shader | no height write.
K025 | shader | no topology write.
K026 | shader | no collider write.
K027 | shader | no vegetation write.
K028 | diagnostics | read-only semantics.
K029 | telemetry | no mutation.
K030 | fixtures | test-only ownership.

## Decision rules

Q001 | any NaN channel | reject.
Q002 | any channel below zero | reject.
Q003 | any channel above one | reject.
Q004 | canonical flag false | reject.
Q005 | vertex displacement present | reject.
Q006 | height write present | reject.
Q007 | topology write present | reject.
Q008 | unstable signature | reject.
Q009 | unstable blend | reject.
Q010 | unstable event | reject.
Q011 | unbounded material roughness | reject.
Q012 | unbounded material normal | reject.
Q013 | unbounded material wetness | reject.
Q014 | unknown classification | reject.
Q015 | unknown render tier | reject.
Q016 | broken stack policy | reject.
Q017 | broken shader policy | reject.
Q018 | broken source policy | reject.
Q019 | broken fixture import | reject.
Q020 | failed acceptance gate | reject.
Q021 | stale main ancestry | rebase before merge.
Q022 | diff below turn target | continue development.
Q023 | focused regression failure | fix before merge.
Q024 | browser smoke failure | investigate before merge.
Q025 | repo-wide infrastructure failure | record separately.
