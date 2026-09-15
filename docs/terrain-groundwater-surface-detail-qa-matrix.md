# Groundwater Surface Detail QA Matrix

This matrix defines concrete review cases for the deterministic groundwater surface-detail layer.
Every case is intended to be executable by the focused regression or acceptance suite.
The matrix deliberately distinguishes presentation signals from canonical world ownership.

## A. Input normalization

A001 | worldX missing | expected normalized to zero.
A002 | worldZ missing | expected normalized to zero.
A003 | worldX numeric string | expected numeric conversion.
A004 | worldZ numeric string | expected numeric conversion.
A005 | worldX NaN | expected finite fallback.
A006 | worldZ Infinity | expected finite fallback.
A007 | height negative | expected accepted without mutation.
A008 | height very large | expected bounded downstream channels.
A009 | slope below zero | expected clamped slope.
A010 | slope above ninety | expected clamped slope.
A011 | moisture below zero | expected normalized to zero.
A012 | moisture above one | expected normalized to one.
A013 | rainfall below zero | expected normalized to zero.
A014 | rainfall above one | expected normalized to one.
A015 | runoff below zero | expected normalized to zero.
A016 | runoff above one | expected normalized to one.
A017 | soil depth below zero | expected normalized to zero.
A018 | soil depth above six | expected normalized to six.
A019 | permeability below zero | expected normalized to zero.
A020 | permeability above one | expected normalized to one.
A021 | water distance below zero | expected normalized to zero.
A022 | water distance above five thousand | expected bounded maximum.
A023 | groundwater depth below zero | expected normalized to zero.
A024 | groundwater depth above five thousand | expected bounded maximum.
A025 | wetDays below zero | expected normalized to zero.
A026 | wetDays above year | expected bounded maximum.
A027 | dryDays below zero | expected normalized to zero.
A028 | dryDays above year | expected bounded maximum.
A029 | dayOfYear negative | expected deterministic cycle wrapping.
A030 | dayOfYear over cycle | expected deterministic cycle wrapping.
A031 | temperature below allowed range | expected lower clamp.
A032 | temperature above allowed range | expected upper clamp.
A033 | drainage below zero | expected normalized to zero.
A034 | drainage above one | expected normalized to one.
A035 | wind exposure below zero | expected normalized to zero.
A036 | wind exposure above one | expected normalized to one.
A037 | missing substrate | expected safe fallback substrate.
A038 | missing biome | expected safe fallback biome.
A039 | null input object | expected safe normalized sample.
A040 | empty input object | expected finite state.

## B. Determinism

B001 | identical coordinates | signature must repeat.
B002 | identical climate | signature must repeat.
B003 | identical day | signature must repeat.
B004 | identical material base | response must repeat.
B005 | identical event | event delta must repeat.
B006 | identical blend | blend output must repeat.
B007 | identical grid origin | grid must repeat.
B008 | identical neighborhood | statistics must repeat.
B009 | identical shader policy | shader report must repeat.
B010 | identical calibration | calibration signature must repeat.
B011 | identical lowland fixture | detail must repeat.
B012 | identical upland fixture | detail must repeat.
B013 | identical transition fixture | detail must repeat.
B014 | negative coordinate pair | detail must repeat.
B015 | large coordinate pair | detail must repeat.
B016 | zero coordinates | detail must repeat.
B017 | seasonal boundary | detail must repeat.
B018 | cycle boundary day 359/360 | normalized output must repeat.
B019 | cycle boundary day 0/-360 | normalized output must repeat.
B020 | repeated telemetry call | telemetry must repeat.
B021 | repeated canonical audit | audit must repeat.
B022 | repeated envelope audit | envelope must repeat.
B023 | repeated material application | material must repeat.
B024 | repeated stack resolve | stack must repeat.
B025 | repeated stack event | event material must repeat.
B026 | repeated stack statistics | statistics must repeat.
B027 | repeated classification | classification must repeat.
B028 | repeated render tier | tier must repeat.
B029 | repeated distance calculation | distance must repeat.
B030 | repeated comparison | delta map must repeat.
B031 | repeated fixture corpus traversal | order must remain stable.
B032 | repeated calibration lookup | profile must remain stable.
B033 | repeated shader install intent | policy key must remain stable.
B034 | repeated detail blend | channels must remain stable.
B035 | repeated lowland grid | cell outputs must remain stable.
B036 | repeated upland grid | cell outputs must remain stable.
B037 | repeated transition grid | cell outputs must remain stable.
B038 | repeated extreme sample | channels must remain finite.
B039 | repeated sparse sample | channels must remain finite.
B040 | repeated malformed sample | channels must remain bounded.

## C. Wetness behavior

C001 | shallow wetland | puddle channel expected active.
C002 | shallow peat | capillary channel expected active.
C003 | shallow silt | fine film expected active.
C004 | shallow loam | wet rim expected active.
C005 | near water table | proximity expected active.
C006 | deep water table | proximity expected suppressed.
C007 | low drainage | puddle persistence expected stronger.
C008 | high drainage | puddle persistence expected weaker.
C009 | high wet history | recovery halo expected retained.
C010 | zero wet history | recovery halo expected lower.
C011 | high rainfall | recharge input expected stronger.
C012 | zero rainfall | recharge input expected weaker.
C013 | high runoff | fine transport expected stronger.
C014 | zero runoff | fine transport expected weaker.
C015 | shallow slope | puddle candidate expected stronger.
C016 | steep slope | puddle candidate expected weaker.
C017 | seepage slope band | seepage darkening expected possible.
C018 | outside seepage band | seepage darkening expected lower.
C019 | marsh lowland | marsh transition expected stronger.
C020 | highland | marsh transition expected lower.
C021 | high capillary | capillary damp expected stronger.
C022 | low capillary | capillary damp expected weaker.
C023 | complete wet sample | confidence expected finite.
C024 | sparse wet sample | confidence must not become NaN.
C025 | storm transition | wet response delta expected finite.
C026 | snowmelt transition | wet response delta expected finite.
C027 | recovery transition | wet response delta expected finite.
C028 | puddle core | wetness material response expected bounded.
C029 | puddle edge | normal response expected bounded.
C030 | saturation memory | retained wetness expected bounded.
C031 | wetland peat at day 1 | seasonal output expected bounded.
C032 | wetland peat at day 180 | seasonal output expected bounded.
C033 | wetland peat at day 359 | seasonal output expected bounded.
C034 | riparian alluvium | film and fine transport expected finite.
C035 | coastal silt | wet and mineral channels expected finite.
C036 | swamp clay | marsh and capillary channels expected finite.
C037 | valley lowland | groundwater proximity expected finite.
C038 | recharge slope | recharge contribution expected finite.
C039 | shallow table | capillary rise expected finite.
C040 | zero water distance | proximity must remain bounded.

## D. Dryness behavior

D001 | desert sand | evaporation front expected finite.
D002 | desert gravel | mineral crust expected finite.
D003 | hot dry sample | drying contrast expected stronger.
D004 | cool dry sample | drying contrast expected bounded.
D005 | high wind exposure | drying demand expected visible.
D006 | low wind exposure | resistance expected retained.
D007 | high drainage | drying risk expected finite.
D008 | low drainage | drying risk expected bounded.
D009 | high dry history | recovery expected suppressed.
D010 | zero dry history | recovery expected available.
D011 | high temperature | evaporation front expected finite.
D012 | low temperature | freeze channel may dominate.
D013 | no rainfall | dryness channels expected finite.
D014 | no runoff | dryness channels expected finite.
D015 | dry highland | mineral crust expected finite.
D016 | dry lowland | puddle/drying competition expected bounded.
D017 | plateau basalt | drying and relief expected finite.
D018 | plateau silt | drying and fine film expected finite.
D019 | desert day 120 | output expected finite.
D020 | desert day 240 | output expected finite.
D021 | desert day 350 | output expected finite.
D022 | drought event | roughness delta expected finite.
D023 | drought event | wetness delta expected finite.
D024 | evaporation front | material response expected bounded.
D025 | mineral crust | material response expected bounded.
D026 | drying contrast | material response expected bounded.
D027 | dry sparse input | output expected bounded.
D028 | dry malformed input | output expected bounded.
D029 | dry extreme coordinates | output expected deterministic.
D030 | dry high slope | puddle must not exceed range.
D031 | dry zero slope | puddle must not exceed range.
D032 | dry rock substrate | fine film expected finite.
D033 | dry sand substrate | crust expected finite.
D034 | dry gravel substrate | crust expected finite.
D035 | dry loam substrate | recovery expected finite.
D036 | dry clay substrate | capillary response expected finite.
D037 | dry coastal sample | salt ring expected finite.
D038 | dry valley sample | proximity remains bounded.
D039 | dry recharge sample | recharge remains bounded.
D040 | dry alpine sample | freeze edge remains bounded.

## E. Freeze-thaw

E001 | subzero wet sample | freeze edge expected finite.
E002 | subzero dry sample | freeze edge expected finite.
E003 | near-zero sample | freeze edge transition expected smooth.
E004 | mild positive temperature | freeze edge expected bounded.
E005 | extreme cold | freeze edge must remain <=1.
E006 | warm highland | freeze edge must remain <=1.
E007 | wet highland | freeze-wet competition expected bounded.
E008 | wet lowland | freeze-wet competition expected bounded.
E009 | steep alpine | micro relief expected bounded.
E010 | shallow tundra | marsh transition expected bounded.
E011 | freeze-thaw event at low intensity | delta expected finite.
E012 | freeze-thaw event at full intensity | delta expected finite.
E013 | repeated freeze-thaw event | delta expected deterministic.
E014 | freeze-thaw material apply | output expected bounded.
E015 | freeze-thaw signature | output expected deterministic.
E016 | freeze-thaw after snowmelt | output expected bounded.
E017 | freeze-thaw before drought | output expected bounded.
E018 | freeze-thaw during recovery | output expected bounded.
E019 | freeze-thaw with zero runoff | output expected bounded.
E020 | freeze-thaw with full runoff | output expected bounded.
E021 | freeze-thaw on basalt | relief expected finite.
E022 | freeze-thaw on granite | relief expected finite.
E023 | freeze-thaw on schist | seepage expected finite.
E024 | freeze-thaw on peat | wet edge expected finite.
E025 | freeze-thaw on clay | capillary response expected finite.
E026 | freeze-thaw at cycle start | day normalization expected stable.
E027 | freeze-thaw at cycle end | day normalization expected stable.
E028 | cold high wind | drying plus freeze expected bounded.
E029 | cold low wind | recovery plus freeze expected bounded.
E030 | cold deep table | proximity expected bounded.
E031 | cold shallow table | capillary response expected bounded.
E032 | cold high slope | puddle expected bounded.
E033 | cold low slope | puddle expected bounded.
E034 | cold wet history | recovery expected bounded.
E035 | cold dry history | drying expected bounded.
E036 | cold high rainfall | recharge expected bounded.
E037 | cold zero rainfall | recharge expected bounded.
E038 | cold high drainage | seepage expected bounded.
E039 | cold low drainage | puddle expected bounded.
E040 | cold sparse sample | confidence expected finite.

## F. Shader integration

F001 | common include | shader helper insertion expected.
F002 | color include | color hook expected.
F003 | roughness include | roughness hook expected.
F004 | normal include | normal hook expected.
F005 | vertex displacement token | must be absent.
F006 | height write token | must be absent.
F007 | position write token | must be absent.
F008 | random function | must be absent.
F009 | deterministic hash | must be present.
F010 | deterministic fbm | must be present.
F011 | world XZ read | expected.
F012 | world height read | expected.
F013 | normal slope estimation | expected.
F014 | normal budget | must remain bounded.
F015 | roughness floor | must remain protected.
F016 | idempotent install | second install must not duplicate state.
F017 | custom cache key | detail key expected.
F018 | userData marker | detail shader marker expected.
F019 | render-only marker | expected true.
F020 | vertex displacement marker | expected false.
F021 | shader policy frozen | expected true.
F022 | invariant list frozen | expected true.
F023 | replacement report frozen | expected true.
F024 | shader report all true | expected.
F025 | color hook call | expected exact helper name.
F026 | roughness hook call | expected exact helper name.
F027 | normal hook call | expected exact helper name.
F028 | shader detail hash | deterministic across frames.
F029 | shader detail noise | deterministic across frames.
F030 | shader detail ridge | deterministic across frames.
F031 | shader wet cue | bounded.
F032 | shader capillary cue | bounded.
F033 | shader seepage cue | bounded.
F034 | shader puddle cue | bounded.
F035 | shader crust cue | bounded.
F036 | shader evaporation cue | bounded.
F037 | shader freeze cue | bounded.
F038 | shader marsh cue | bounded.
F039 | shader fine-film cue | bounded.
F040 | shader normal strength | bounded.

## G. Stack composition

G001 | base material only | stack remains valid.
G002 | groundwater stage | stack policy remains valid.
G003 | detail stage | detail policy must be present.
G004 | final budget | stack order remains valid.
G005 | stack manifest | stage count remains explicit.
G006 | stack audit | expected true for valid frame.
G007 | stack health | expected true for valid frame.
G008 | stack tier | expected known value.
G009 | stack statistics | expected finite.
G010 | stack event | expected material result.
G011 | stack blend | expected bounded channels.
G012 | stack batch | expected one frame per input.
G013 | stack sparse input | expected valid frame.
G014 | stack extreme input | expected bounded frame.
G015 | stack null base color | expected fallback.
G016 | stack low detail weight | expected interpolation.
G017 | stack full detail weight | expected detail response.
G018 | stack zero detail weight | expected original material.
G019 | stack repeated resolve | deterministic.
G020 | stack repeated event | deterministic.
G021 | stack userData | canonical flags expected.
G022 | stack source policy | groundwater policy expected.
G023 | stack shader policy | detail shader policy expected.
G024 | stack stage count | expected explicit integer.
G025 | stack order freeze | expected frozen array.
G026 | stack canonical height | true.
G027 | stack canonical hydrology | true.
G028 | stack canonical coastline | true.
G029 | stack canonical collider | true.
G030 | stack canonical vegetation | true.
G031 | stack new geography | false.
G032 | stack event storm | wetness bounded.
G033 | stack event drought | dryness bounded.
G034 | stack event freeze-thaw | normal bounded.
G035 | stack event snowmelt | wetness bounded.
G036 | stack event recovery | wetness bounded.
G037 | stack health suppressed | confidence controls tier.
G038 | stack health high | strong detail controls tier.
G039 | stack batch empty | empty frozen array.
G040 | stack statistics empty | safe zero report.

## H. Canonical ownership

H001 | detail state height flag | must be true.
H002 | detail state hydrology flag | must be true.
H003 | detail state coastline flag | must be true.
H004 | detail state collider flag | must be true.
H005 | detail state vegetation flag | must be true.
H006 | detail state new geography | must be false.
H007 | shader vertex modification | must be false.
H008 | shader displacement modification | must be false.
H009 | stack canonical height | must be true.
H010 | stack canonical hydrology | must be true.
H011 | stack canonical coastline | must be true.
H012 | stack canonical collider | must be true.
H013 | stack canonical vegetation | must be true.
H014 | stack new geography | must be false.
H015 | detail audit mutation count | must be zero.
H016 | detail audit failures | must be empty.
H017 | detail envelope errors | must be empty.
H018 | shader invariant list | must include no vertex write.
H019 | shader invariant list | must include no height write.
H020 | shader invariant list | must include no topology write.
H021 | material response | must not create geometry.
H022 | event response | must not persist simulation state.
H023 | blend response | must not mutate inputs.
H024 | neighborhood stats | must not mutate detail frames.
H025 | fixture traversal | must not mutate fixtures.
H026 | calibration lookup | must not mutate profiles.
H027 | telemetry | must be read-only.
H028 | diagnostics | must be read-only.
H029 | cache key | must be string-only identity.
H030 | policy objects | must be frozen.
H031 | channel arrays | must be frozen.
H032 | canonical arrays | must be frozen.
H033 | shader replacement report | must be frozen.
H034 | stack manifest | must be frozen.
H035 | health report | must be frozen.
H036 | statistics report | must be frozen.
H037 | event delta | must be frozen.
H038 | material result | must be frozen.
H039 | detail result | must be frozen.
H040 | state result | must be frozen.

## I. Performance

I001 | single detail resolve | should complete without allocation spikes.
I002 | repeated detail resolve | should remain deterministic.
I003 | grid helper | dimensions must be capped.
I004 | neighborhood helper | empty input must return immediately.
I005 | stack batch | input count must be preserved.
I006 | shader noise | octaves must remain fixed.
I007 | shader loop count | must not depend on world data.
I008 | material installation | second call must be idempotent.
I009 | shader cache key | must be stable.
I010 | calibration lookup | linear profile count should remain small.
I011 | fixture imports | test-only consumption.
I012 | docs matrix | not loaded by production runtime.
I013 | event delta | no dynamic recursion.
I014 | statistics | single traversal per channel set.
I015 | detail signature | fixed channel order.
I016 | detail comparison | fixed channel order.
I017 | canonical audit | constant-size flag set.
I018 | envelope audit | fixed channel set.
I019 | render tier | constant-size decision tree.
I020 | material response | constant-size arithmetic.
I021 | event application | constant-size arithmetic.
I022 | grid cap | maximum forty columns.
I023 | grid cap | maximum forty rows.
I024 | empty neighborhood | no spread operation.
I025 | cache | no random eviction logic.
I026 | shader source | no texture allocation.
I027 | shader source | no vertex writes.
I028 | shader source | no buffer writes.
I029 | CPU state | immutable output objects.
I030 | fixture corpus | loaded only by QA.

## J. Review decision

J001 | policy identity | approved when exact id is present.
J002 | source identity | approved when groundwater policy matches.
J003 | channel count | approved at fourteen channels.
J004 | bounds | approved when all channels are in range.
J005 | confidence | approved when finite and bounded.
J006 | canonical | approved when all ownership flags pass.
J007 | material | approved when outputs are bounded.
J008 | events | approved when all event types stay finite.
J009 | shader | approved when all replacement guards pass.
J010 | stack | approved when audit passes.
J011 | fixtures | approved when all fixture details resolve.
J012 | determinism | approved when signatures repeat.
J013 | blend | approved when endpoint identity holds.
J014 | grid | approved when requested dimensions are honored within caps.
J015 | statistics | approved when means and contrasts are finite.
J016 | calibration | approved when factors are inside policy range.
J017 | performance | approved when helper caps remain active.
J018 | no mutation | approved when mutation count remains zero.
J019 | no geography | approved when newGeographyIntroduced is false.
J020 | final merge | blocked until all focused gates pass and current-main ancestry is fresh.
