# Groundwater Surface Detail QA Vectors

Format: `id | environment | input variation | expected guard`.

V001 | peat wetland | table=2m | channels finite
V002 | peat wetland | table=5m | channels finite
V003 | peat wetland | table=10m | proximity bounded
V004 | peat wetland | table=20m | proximity bounded
V005 | peat wetland | slope=0 | puddle bounded
V006 | peat wetland | slope=4 | puddle bounded
V007 | peat wetland | slope=9 | puddle bounded
V008 | peat wetland | slope=18 | puddle bounded
V009 | peat wetland | rain=0 | recharge bounded
V010 | peat wetland | rain=1 | recharge bounded
V011 | peat wetland | runoff=0 | film bounded
V012 | peat wetland | runoff=1 | film bounded
V013 | peat wetland | wetDays=0 | memory finite
V014 | peat wetland | wetDays=28 | memory finite
V015 | peat wetland | dryDays=0 | recovery bounded
V016 | peat wetland | dryDays=42 | recovery bounded
V017 | peat wetland | temp=-5 | freeze bounded
V018 | peat wetland | temp=5 | freeze bounded
V019 | peat wetland | temp=20 | evaporation bounded
V020 | peat wetland | wind=0 | resistance finite
V021 | peat wetland | wind=1 | drying finite
V022 | peat wetland | drainage=0 | puddle finite
V023 | peat wetland | drainage=1 | puddle finite
V024 | peat wetland | moisture=0 | channels bounded
V025 | peat wetland | moisture=1 | channels bounded
V026 | peat wetland | water=0 | proximity bounded
V027 | peat wetland | water=160 | proximity bounded
V028 | peat wetland | water=5000 | proximity bounded
V029 | peat wetland | height=-10 | channels bounded
V030 | peat wetland | height=200 | channels bounded
V031 | silt wetland | table=2m | channels finite
V032 | silt wetland | table=5m | channels finite
V033 | silt wetland | table=12m | proximity bounded
V034 | silt wetland | table=24m | proximity bounded
V035 | silt wetland | slope=0 | puddle bounded
V036 | silt wetland | slope=5 | puddle bounded
V037 | silt wetland | slope=10 | puddle bounded
V038 | silt wetland | slope=20 | puddle bounded
V039 | silt wetland | rain=0 | recharge bounded
V040 | silt wetland | rain=1 | recharge bounded
V041 | silt wetland | runoff=0 | film bounded
V042 | silt wetland | runoff=1 | film bounded
V043 | silt wetland | wetDays=0 | memory finite
V044 | silt wetland | wetDays=28 | memory finite
V045 | silt wetland | dryDays=0 | recovery bounded
V046 | silt wetland | dryDays=42 | recovery bounded
V047 | silt wetland | temp=-5 | freeze bounded
V048 | silt wetland | temp=7 | freeze bounded
V049 | silt wetland | temp=22 | evaporation bounded
V050 | silt wetland | wind=1 | drying finite
V051 | loam temperate | table=4m | channels finite
V052 | loam temperate | table=9m | channels finite
V053 | loam temperate | table=18m | proximity bounded
V054 | loam temperate | table=38m | proximity bounded
V055 | loam temperate | slope=1 | puddle bounded
V056 | loam temperate | slope=6 | puddle bounded
V057 | loam temperate | slope=12 | puddle bounded
V058 | loam temperate | slope=24 | puddle bounded
V059 | loam temperate | rain=0 | recharge bounded
V060 | loam temperate | rain=1 | recharge bounded
V061 | loam temperate | runoff=0 | film bounded
V062 | loam temperate | runoff=1 | film bounded
V063 | loam temperate | wetDays=2 | memory finite
V064 | loam temperate | wetDays=24 | memory finite
V065 | loam temperate | dryDays=1 | recovery bounded
V066 | loam temperate | dryDays=60 | recovery bounded
V067 | loam temperate | temp=0 | freeze bounded
V068 | loam temperate | temp=12 | freeze bounded
V069 | loam temperate | temp=30 | evaporation bounded
V070 | loam temperate | wind=0 | resistance finite
V071 | loam temperate | wind=1 | drying finite
V072 | loam temperate | drainage=0 | puddle finite
V073 | loam temperate | drainage=1 | puddle finite
V074 | loam temperate | moisture=0 | channels bounded
V075 | loam temperate | moisture=1 | channels bounded
V076 | clay temperate | table=3m | capillary bounded
V077 | clay temperate | table=8m | capillary bounded
V078 | clay temperate | table=18m | capillary bounded
V079 | clay temperate | slope=2 | puddle bounded
V080 | clay temperate | slope=7 | puddle bounded
V081 | clay temperate | slope=14 | puddle bounded
V082 | clay temperate | slope=30 | puddle bounded
V083 | clay temperate | rain=0 | recharge bounded
V084 | clay temperate | rain=1 | recharge bounded
V085 | clay temperate | runoff=.2 | film bounded
V086 | clay temperate | runoff=.9 | film bounded
V087 | clay temperate | wetDays=0 | memory finite
V088 | clay temperate | wetDays=32 | memory finite
V089 | clay temperate | dryDays=0 | recovery bounded
V090 | clay temperate | dryDays=90 | recovery bounded
V091 | clay temperate | temp=-2 | freeze bounded
V092 | clay temperate | temp=8 | freeze bounded
V093 | clay temperate | temp=34 | evaporation bounded
V094 | clay temperate | permeability=0 | capillary bounded
V095 | clay temperate | permeability=1 | capillary bounded
V096 | gravel temperate | table=6m | proximity bounded
V097 | gravel temperate | table=24m | proximity bounded
V098 | gravel temperate | table=48m | proximity bounded
V099 | gravel temperate | slope=1 | puddle bounded
V100 | gravel temperate | slope=8 | puddle bounded
V101 | gravel temperate | slope=16 | puddle bounded
V102 | gravel temperate | slope=32 | puddle bounded
V103 | gravel temperate | rain=0 | recharge bounded
V104 | gravel temperate | rain=1 | recharge bounded
V105 | gravel temperate | runoff=0 | film bounded
V106 | gravel temperate | runoff=1 | film bounded
V107 | gravel temperate | wetDays=0 | memory finite
V108 | gravel temperate | wetDays=60 | memory finite
V109 | gravel temperate | dryDays=0 | recovery bounded
V110 | gravel temperate | dryDays=120 | recovery bounded
V111 | gravel temperate | temp=-8 | freeze bounded
V112 | gravel temperate | temp=15 | evaporation bounded
V113 | gravel temperate | temp=40 | evaporation bounded
V114 | gravel temperate | permeability=0 | capillary bounded
V115 | gravel temperate | permeability=1 | capillary bounded
V116 | sand dryland | table=10m | proximity bounded
V117 | sand dryland | table=50m | proximity bounded
V118 | sand dryland | table=100m | proximity bounded
V119 | sand dryland | slope=1 | puddle bounded
V120 | sand dryland | slope=6 | puddle bounded
V121 | sand dryland | slope=15 | puddle bounded
V122 | sand dryland | slope=28 | puddle bounded
V123 | sand dryland | rain=0 | recharge bounded
V124 | sand dryland | rain=1 | recharge bounded
V125 | sand dryland | runoff=0 | film bounded
V126 | sand dryland | runoff=1 | film bounded
V127 | sand dryland | wetDays=0 | memory finite
V128 | sand dryland | wetDays=8 | memory finite
V129 | sand dryland | dryDays=20 | recovery bounded
V130 | sand dryland | dryDays=180 | recovery bounded
V131 | sand dryland | temp=5 | freeze bounded
V132 | sand dryland | temp=25 | evaporation bounded
V133 | sand dryland | temp=45 | evaporation bounded
V134 | sand dryland | wind=0 | resistance finite
V135 | sand dryland | wind=1 | drying finite
V136 | gravel dryland | table=12m | proximity bounded
V137 | gravel dryland | table=60m | proximity bounded
V138 | gravel dryland | table=120m | proximity bounded
V139 | gravel dryland | slope=1 | puddle bounded
V140 | gravel dryland | slope=7 | puddle bounded
V141 | gravel dryland | slope=17 | puddle bounded
V142 | gravel dryland | slope=31 | puddle bounded
V143 | gravel dryland | rain=0 | recharge bounded
V144 | gravel dryland | rain=1 | recharge bounded
V145 | gravel dryland | runoff=0 | film bounded
V146 | gravel dryland | runoff=1 | film bounded
V147 | gravel dryland | dryDays=30 | recovery bounded
V148 | gravel dryland | dryDays=180 | recovery bounded
V149 | gravel dryland | temp=10 | evaporation bounded
V150 | gravel dryland | temp=50 | evaporation bounded
V151 | alluvium riparian | table=2m | proximity bounded
V152 | alluvium riparian | table=6m | proximity bounded
V153 | alluvium riparian | table=20m | proximity bounded
V154 | alluvium riparian | slope=1 | puddle bounded
V155 | alluvium riparian | slope=4 | puddle bounded
V156 | alluvium riparian | slope=9 | puddle bounded
V157 | alluvium riparian | slope=18 | puddle bounded
V158 | alluvium riparian | rain=0 | recharge bounded
V159 | alluvium riparian | rain=1 | recharge bounded
V160 | alluvium riparian | runoff=0 | film bounded
V161 | alluvium riparian | runoff=1 | film bounded
V162 | alluvium riparian | wetDays=0 | memory finite
V163 | alluvium riparian | wetDays=90 | memory finite
V164 | alluvium riparian | dryDays=0 | recovery bounded
V165 | alluvium riparian | dryDays=50 | recovery bounded
V166 | alluvium riparian | temp=3 | freeze bounded
V167 | alluvium riparian | temp=18 | evaporation bounded
V168 | alluvium riparian | wind=1 | drying finite
V169 | alluvium riparian | drainage=0 | puddle finite
V170 | alluvium riparian | drainage=1 | puddle finite
V171 | schist montane | table=20m | proximity bounded
V172 | schist montane | table=70m | proximity bounded
V173 | schist montane | table=150m | proximity bounded
V174 | schist montane | slope=5 | seepage bounded
V175 | schist montane | slope=15 | seepage bounded
V176 | schist montane | slope=24 | seepage bounded
V177 | schist montane | slope=42 | seepage bounded
V178 | schist montane | rain=0 | recharge bounded
V179 | schist montane | rain=1 | recharge bounded
V180 | schist montane | runoff=.1 | film bounded
V181 | schist montane | runoff=.9 | film bounded
V182 | schist montane | wetDays=0 | memory finite
V183 | schist montane | wetDays=60 | memory finite
V184 | schist montane | dryDays=0 | recovery bounded
V185 | schist montane | dryDays=100 | recovery bounded
V186 | schist montane | temp=-10 | freeze bounded
V187 | schist montane | temp=4 | freeze bounded
V188 | schist montane | temp=20 | evaporation bounded
V189 | schist montane | wind=0 | resistance finite
V190 | schist montane | wind=1 | drying finite
V191 | granite montane | table=25m | proximity bounded
V192 | granite montane | table=90m | proximity bounded
V193 | granite montane | table=180m | proximity bounded
V194 | granite montane | slope=7 | seepage bounded
V195 | granite montane | slope=18 | seepage bounded
V196 | granite montane | slope=32 | seepage bounded
V197 | granite montane | slope=48 | seepage bounded
V198 | granite montane | rain=0 | recharge bounded
V199 | granite montane | rain=1 | recharge bounded
V200 | granite montane | runoff=.2 | film bounded
V201 | granite montane | runoff=.8 | film bounded
V202 | granite montane | wetDays=0 | memory finite
V203 | granite montane | wetDays=45 | memory finite
V204 | granite montane | dryDays=0 | recovery bounded
V205 | granite montane | dryDays=120 | recovery bounded
V206 | granite montane | temp=-12 | freeze bounded
V207 | granite montane | temp=2 | freeze bounded
V208 | granite montane | temp=18 | evaporation bounded
V209 | granite montane | wind=0 | resistance finite
V210 | granite montane | wind=1 | drying finite
V211 | basalt alpine | table=80m | proximity bounded
V212 | basalt alpine | table=180m | proximity bounded
V213 | basalt alpine | table=300m | proximity bounded
V214 | basalt alpine | slope=12 | freeze bounded
V215 | basalt alpine | slope=28 | freeze bounded
V216 | basalt alpine | slope=45 | freeze bounded
V217 | basalt alpine | slope=60 | freeze bounded
V218 | basalt alpine | rain=0 | recharge bounded
V219 | basalt alpine | rain=1 | recharge bounded
V220 | basalt alpine | runoff=0 | film bounded
V221 | basalt alpine | runoff=1 | film bounded
V222 | basalt alpine | wetDays=0 | memory finite
V223 | basalt alpine | wetDays=30 | memory finite
V224 | basalt alpine | dryDays=0 | recovery bounded
V225 | basalt alpine | dryDays=180 | recovery bounded
V226 | basalt alpine | temp=-20 | freeze bounded
V227 | basalt alpine | temp=-5 | freeze bounded
V228 | basalt alpine | temp=10 | evaporation bounded
V229 | basalt alpine | wind=0 | resistance finite
V230 | basalt alpine | wind=1 | drying finite
V231 | tundra silt | table=30m | proximity bounded
V232 | tundra silt | table=90m | proximity bounded
V233 | tundra silt | table=190m | proximity bounded
V234 | tundra silt | slope=3 | puddle bounded
V235 | tundra silt | slope=12 | puddle bounded
V236 | tundra silt | slope=24 | seepage bounded
V237 | tundra silt | slope=38 | seepage bounded
V238 | tundra silt | rain=0 | recharge bounded
V239 | tundra silt | rain=1 | recharge bounded
V240 | tundra silt | runoff=.2 | film bounded
V241 | tundra silt | runoff=.9 | film bounded
V242 | tundra silt | wetDays=0 | memory finite
V243 | tundra silt | wetDays=100 | memory finite
V244 | tundra silt | dryDays=0 | recovery bounded
V245 | tundra silt | dryDays=150 | recovery bounded
V246 | tundra silt | temp=-30 | freeze bounded
V247 | tundra silt | temp=-2 | freeze bounded
V248 | tundra silt | temp=12 | evaporation bounded
V249 | tundra silt | wind=0 | resistance finite
V250 | tundra silt | wind=1 | drying finite
V251 | coastal silt | table=2m | proximity bounded
V252 | coastal silt | table=8m | proximity bounded
V253 | coastal silt | table=18m | proximity bounded
V254 | coastal silt | slope=1 | puddle bounded
V255 | coastal silt | slope=5 | puddle bounded
V256 | coastal silt | slope=11 | seepage bounded
V257 | coastal silt | slope=21 | seepage bounded
V258 | coastal silt | rain=0 | recharge bounded
V259 | coastal silt | rain=1 | recharge bounded
V260 | coastal silt | runoff=0 | film bounded
V261 | coastal silt | runoff=1 | film bounded
V262 | coastal silt | wetDays=0 | memory finite
V263 | coastal silt | wetDays=90 | memory finite
V264 | coastal silt | dryDays=0 | recovery bounded
V265 | coastal silt | dryDays=80 | recovery bounded
V266 | coastal silt | temp=0 | freeze bounded
V267 | coastal silt | temp=20 | evaporation bounded
V268 | coastal silt | temp=40 | evaporation bounded
V269 | coastal silt | wind=0 | resistance finite
V270 | coastal silt | wind=1 | drying finite
V271 | coastal sand | table=3m | proximity bounded
V272 | coastal sand | table=12m | proximity bounded
V273 | coastal sand | table=25m | proximity bounded
V274 | coastal sand | slope=1 | puddle bounded
V275 | coastal sand | slope=6 | puddle bounded
V276 | coastal sand | slope=13 | seepage bounded
V277 | coastal sand | slope=24 | seepage bounded
V278 | coastal sand | rain=0 | recharge bounded
V279 | coastal sand | rain=1 | recharge bounded
V280 | coastal sand | runoff=0 | film bounded
V281 | coastal sand | runoff=1 | film bounded
V282 | coastal sand | wetDays=0 | memory finite
V283 | coastal sand | wetDays=60 | memory finite
V284 | coastal sand | dryDays=0 | recovery bounded
V285 | coastal sand | dryDays=90 | recovery bounded
V286 | coastal sand | temp=3 | freeze bounded
V287 | coastal sand | temp=25 | evaporation bounded
V288 | coastal sand | temp=48 | evaporation bounded
V289 | coastal sand | wind=0 | resistance finite
V290 | coastal sand | wind=1 | drying finite
V291 | swamp peat | table=1m | proximity bounded
V292 | swamp peat | table=4m | proximity bounded
V293 | swamp peat | table=9m | proximity bounded
V294 | swamp peat | slope=.5 | puddle bounded
V295 | swamp peat | slope=2 | puddle bounded
V296 | swamp peat | slope=6 | puddle bounded
V297 | swamp peat | slope=12 | seepage bounded
V298 | swamp peat | rain=0 | recharge bounded
V299 | swamp peat | rain=1 | recharge bounded
V300 | swamp peat | runoff=0 | film bounded
V301 | swamp peat | runoff=1 | film bounded
V302 | swamp peat | wetDays=0 | memory finite
V303 | swamp peat | wetDays=120 | memory finite
V304 | swamp peat | dryDays=0 | recovery bounded
V305 | swamp peat | dryDays=42 | recovery bounded
V306 | swamp peat | temp=-8 | freeze bounded
V307 | swamp peat | temp=10 | evaporation bounded
V308 | swamp peat | temp=32 | evaporation bounded
V309 | swamp peat | wind=0 | resistance finite
V310 | swamp peat | wind=1 | drying finite
V311 | valley loam | table=3m | proximity bounded
V312 | valley loam | table=15m | proximity bounded
V313 | valley loam | table=40m | proximity bounded
V314 | valley loam | slope=1 | puddle bounded
V315 | valley loam | slope=5 | puddle bounded
V316 | valley loam | slope=10 | puddle bounded
V317 | valley loam | slope=18 | seepage bounded
V318 | valley loam | rain=0 | recharge bounded
V319 | valley loam | rain=1 | recharge bounded
V320 | valley loam | runoff=.1 | film bounded
V321 | valley loam | runoff=.8 | film bounded
V322 | valley loam | wetDays=0 | memory finite
V323 | valley loam | wetDays=75 | memory finite
V324 | valley loam | dryDays=0 | recovery bounded
V325 | valley loam | dryDays=100 | recovery bounded
V326 | valley loam | temp=1 | freeze bounded
V327 | valley loam | temp=18 | evaporation bounded
V328 | valley loam | temp=36 | evaporation bounded
V329 | valley loam | wind=0 | resistance finite
V330 | valley loam | wind=1 | drying finite
V331 | recharge loam | table=5m | recharge bounded
V332 | recharge loam | table=15m | recharge bounded
V333 | recharge loam | table=30m | recharge bounded
V334 | recharge loam | slope=2 | recharge bounded
V335 | recharge loam | slope=8 | recharge bounded
V336 | recharge loam | slope=18 | recharge bounded
V337 | recharge loam | slope=30 | recharge bounded
V338 | recharge loam | rain=0 | recharge bounded
V339 | recharge loam | rain=.5 | recharge bounded
V340 | recharge loam | rain=1 | recharge bounded
V341 | recharge loam | runoff=0 | recharge bounded
V342 | recharge loam | runoff=.5 | recharge bounded
V343 | recharge loam | runoff=1 | recharge bounded
V344 | recharge loam | soil=0 | recharge bounded
V345 | recharge loam | soil=.5 | recharge bounded
V346 | recharge loam | soil=2 | recharge bounded
V347 | recharge loam | permeability=0 | recharge bounded
V348 | recharge loam | permeability=.5 | recharge bounded
V349 | recharge loam | permeability=1 | recharge bounded
V350 | recharge loam | drainage=0 | recharge bounded
V351 | recharge loam | drainage=.5 | recharge bounded
V352 | recharge loam | drainage=1 | recharge bounded
V353 | recharge loam | temp=-10 | recharge bounded
V354 | recharge loam | temp=10 | recharge bounded
V355 | recharge loam | temp=30 | recharge bounded
V356 | recharge loam | water=0 | recharge bounded
V357 | recharge loam | water=100 | recharge bounded
V358 | recharge loam | water=1000 | recharge bounded
V359 | recharge loam | table=0 | recharge bounded
V360 | recharge loam | table=100 | recharge bounded
V361 | recharge loam | table=1000 | recharge bounded
V362 | recharge loam | wetDays=0 | recharge bounded
V363 | recharge loam | wetDays=30 | recharge bounded
V364 | recharge loam | wetDays=365 | recharge bounded
V365 | recharge loam | dryDays=0 | recharge bounded
V366 | recharge loam | dryDays=30 | recharge bounded
V367 | recharge loam | dryDays=365 | recharge bounded
V368 | recharge loam | wind=0 | recharge bounded
V369 | recharge loam | wind=1 | recharge bounded
V370 | recharge loam | day=0 | recharge bounded
V371 | recharge loam | day=359 | recharge bounded
V372 | recharge loam | day=360 | recharge bounded
V373 | recharge loam | day=-1 | recharge bounded
V374 | recharge loam | day=721 | recharge bounded
V375 | recharge loam | x=-1e6 | deterministic
V376 | recharge loam | x=1e6 | deterministic
V377 | recharge loam | z=-1e6 | deterministic
V378 | recharge loam | z=1e6 | deterministic
V379 | recharge loam | x=z=0 | deterministic
V380 | recharge loam | x=12,z=-18 | deterministic
V381 | event storm | intensity=0 | zero delta
V382 | event storm | intensity=.25 | finite delta
V383 | event storm | intensity=.5 | finite delta
V384 | event storm | intensity=.75 | finite delta
V385 | event storm | intensity=1 | finite delta
V386 | event drought | intensity=0 | zero delta
V387 | event drought | intensity=.25 | finite delta
V388 | event drought | intensity=.5 | finite delta
V389 | event drought | intensity=.75 | finite delta
V390 | event drought | intensity=1 | finite delta
V391 | event freeze-thaw | intensity=0 | zero delta
V392 | event freeze-thaw | intensity=.25 | finite delta
V393 | event freeze-thaw | intensity=.5 | finite delta
V394 | event freeze-thaw | intensity=.75 | finite delta
V395 | event freeze-thaw | intensity=1 | finite delta
V396 | event snowmelt | intensity=0 | zero delta
V397 | event snowmelt | intensity=.25 | finite delta
V398 | event snowmelt | intensity=.5 | finite delta
V399 | event snowmelt | intensity=.75 | finite delta
V400 | event snowmelt | intensity=1 | finite delta
V401 | event recovery | intensity=0 | zero delta
V402 | event recovery | intensity=.25 | finite delta
V403 | event recovery | intensity=.5 | finite delta
V404 | event recovery | intensity=.75 | finite delta
V405 | event recovery | intensity=1 | finite delta
V406 | event future | intensity=1 | neutral delta
V407 | event future | intensity=-1 | neutral delta
V408 | event future | intensity=2 | neutral delta
V409 | material base black | detail=wet | bounded color
V410 | material base white | detail=wet | bounded color
V411 | material roughness zero | detail=crust | bounded roughness
V412 | material roughness one | detail=crust | bounded roughness
V413 | material roughness invalid | detail=wet | clamped roughness
V414 | material normal invalid | detail=freeze | bounded normal
V415 | material wetness invalid | detail=storm | bounded wetness
V416 | blend lowland/upland | mix=.25 | bounded
V417 | blend lowland/upland | mix=.5 | bounded
V418 | blend lowland/upland | mix=.75 | bounded
V419 | blend storm/recovery | mix=.25 | bounded
V420 | blend storm/recovery | mix=.5 | bounded
V421 | blend drought/snowmelt | mix=.75 | bounded
V422 | blend freeze/drought | mix=.5 | bounded
V423 | blend identical | mix=.5 | identity
V424 | blend reversed | mix=.25 | complement
V425 | blend negative | mix=-1 | left identity
V426 | blend above one | mix=2 | right identity
V427 | grid 1x1 | default sample | one cell
V428 | grid 5x5 | default sample | twenty five cells
V429 | grid 10x10 | wet sample | one hundred cells
V430 | grid 40x40 | dry sample | capped sixteen hundred cells
V431 | grid 100x100 | sparse sample | capped sixteen hundred cells
V432 | neighborhood empty | no input | zero report
V433 | neighborhood one | one frame | count one
V434 | neighborhood 25 | mixed frames | finite stats
V435 | neighborhood 75 | fixtures | finite stats
V436 | neighborhood wet cohort | wet frames | finite contrast
V437 | neighborhood dry cohort | dry frames | finite contrast
V438 | neighborhood mixed extremes | hot/cold | finite contrast
V439 | signature same frame | repeat | equal
V440 | signature coordinate change | x delta | potentially different
V441 | signature day wrap | 0 vs 360 | deterministic cycle
V442 | signature day wrap | -360 vs 0 | deterministic cycle
V443 | comparison same | identical | zero deltas
V444 | comparison wet/dry | distinct | finite deltas
V445 | distance same | identical | zero
V446 | distance distinct | wet/dry | finite
V447 | classification puddle | high core | known class
V448 | classification marsh | high marsh | known class
V449 | classification seepage | high seepage | known class
V450 | classification crust | high crust | known class
V451 | classification capillary | high capillary | known class
V452 | classification freeze | high freeze | known class
V453 | classification drying | high drying | known class
V454 | classification wet rim | high rim | known class
V455 | classification neutral | low all | known class
V456 | render tier suppressed | confidence low | suppressed or known
V457 | render tier low | weak signal | low
V458 | render tier medium | moderate signal | medium
V459 | render tier high | strong signal | high
V460 | calibration wetland peat | lookup exact | matched
V461 | calibration temperate loam | lookup exact | matched
V462 | calibration dryland sand | lookup exact | matched
V463 | calibration alpine basalt | lookup exact | matched
V464 | calibration unknown biome | fallback | safe profile
V465 | calibration unknown substrate | fallback | safe profile
V466 | calibration malformed | missing key | safe profile
V467 | calibration audit | all profiles | passes
V468 | calibration signature | repeated | equal
V469 | calibration multipliers | minimum | within policy
V470 | calibration multipliers | maximum | within policy
V471 | shader helper hash | repeated point | equal
V472 | shader helper noise | repeated point | equal
V473 | shader helper ridge | repeated point | equal
V474 | shader common replacement | installed | true
V475 | shader color replacement | installed | true
V476 | shader roughness replacement | installed | true
V477 | shader normal replacement | installed | true
V478 | shader vertex displacement | source scan | absent
V479 | shader height write | source scan | absent
V480 | shader topology write | source scan | absent
V481 | shader random | source scan | absent
V482 | stack policy | renderOnly | true
V483 | stack policy | deterministic | true
V484 | stack policy | height unchanged | true
V485 | stack policy | hydrology unchanged | true
V486 | stack policy | coastline unchanged | true
V487 | stack policy | collider unchanged | true
V488 | stack policy | vegetation unchanged | true
V489 | stack policy | new geography | false
V490 | stack audit | valid frame | pass
V491 | stack health | valid frame | pass
V492 | stack statistics | valid batch | finite
V493 | stack batch | zero inputs | empty
V494 | stack batch | seventy inputs | seventy outputs
V495 | stack event | storm | bounded
V496 | stack event | drought | bounded
V497 | stack event | freeze-thaw | bounded
V498 | stack event | snowmelt | bounded
V499 | stack event | recovery | bounded
V500 | final gate | all focused checks | merge blocked until green
