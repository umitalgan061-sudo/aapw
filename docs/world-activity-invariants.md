# World Activity Invariants

IA001 activity output is deterministic for identical inputs.
IA002 activity output is deeply frozen.
IA003 activity output never owns actor spawning.
IA004 activity output never owns terrain mutation.
IA005 activity output never owns road mutation.
IA006 activity output never owns save mutation.
IA007 activity output exposes bounded activity count.
IA008 activity output exposes bounded signal count.
IA009 activity output clamps scores to zero through one.
IA010 activity output clamps distance to policy maximum.
IA011 clear weather keeps travel viable.
IA012 fog weather lowers observation confidence.
IA013 storm weather can produce warning activity.
IA014 snow weather increases rest preference.
IA015 sleet weather increases rest preference.
IA016 rain weather increases shelter preference.
IA017 dawn prefers orientation.
IA018 morning prefers productive work.
IA019 midday permits social activity.
IA020 dusk keeps return readable.
IA021 evening prefers rest and social.
IA022 night prefers rest and observation.
IA023 gateway lane prefers travel.
IA024 market lane prefers trade.
IA025 tavern lane prefers rest or social.
IA026 craft lane prefers craft.
IA027 farm lane prefers farming.
IA028 military lane prefers guard.
IA029 stable lane prefers travel.
IA030 home lane prefers rest.
IA031 river lane prefers gather or observe.
IA032 ridge lane prefers observe.
IA033 high risk reduces exposed travel.
IA034 fatigue increases recovery preference.
IA035 mobile keeps semantic activity types.
IA036 mobile reduces activity count.
IA037 mobile preserves deterministic order.
IA038 warning is only advisory evidence.
IA039 activity context never creates UI nodes.
IA040 activity context never creates audio nodes.
IA041 activity context never creates particles.
IA042 activity context never creates colliders.
IA043 cadence never owns timers.
IA044 scheduler returns presentation hints only.
IA045 shelter context returns evidence only.
IA046 journey context composes child evidence.
IA047 journey context keeps child fingerprints stable.
IA048 malformed weather falls back safely.
IA049 malformed hour stays finite.
IA050 malformed fatigue stays finite.
IA051 null player remains safe.
IA052 null surface remains safe.
IA053 null settlement remains inherited from traversal defaults.
IA054 unknown activity is rejected by validation.
IA055 duplicate activity identifiers are invalid.
IA056 signal count remains bounded.
IA057 activity count remains bounded.
IA058 priority remains normalized.
IA059 readiness remains normalized.
IA060 fingerprints use sorted keys.
IA061 fingerprints do not use wall clock.
IA062 fingerprints do not use random.
IA063 replay compares complete fingerprints.
IA064 summaries remain compact.
IA065 APIs expose versions.
IA066 APIs expose bounded vocabularies.
IA067 APIs expose named functions.
IA068 APIs are immutable.
IA069 schedule window is canonical.
IA070 schedule entry scores are finite.
IA071 shelter need is normalized.
IA072 shelter visibility is normalized.
IA073 cadence pulse is normalized.
IA074 cadence interval remains positive.
IA075 journey confidence is normalized.
IA076 top activity is canonical.
IA077 top activity remains deterministic.
IA078 storm can prioritize warning.
IA079 fog can prioritize caution.
IA080 snow can prioritize shelter.
IA081 gateway availability can emit entry signal.
IA082 blocked gateway can emit warning signal.
IA083 settlement service remains campaign-owned.
IA084 geographic context remains world-owned.
IA085 traversal remains planning-owned.
IA086 activity remains derived evidence.
IA087 scheduler remains derived evidence.
IA088 cadence remains derived evidence.
IA089 shelter remains derived evidence.
IA090 journey remains derived evidence.
IA091 scenario ledger remains regression input.
IA092 profile matrix remains regression input.
IA093 no second quest ledger exists.
IA094 no second inventory authority exists.
IA095 no second combat authority exists.
IA096 no second actor registry exists.
IA097 no second navmesh exists.
IA098 no second road system exists.
IA099 no second weather system exists.
IA100 no second material system exists.
IA101 travel is preferred when clear and far.
IA102 observe is preferred on ridge at night.
IA103 rest is preferred in tavern at night.
IA104 craft is preferred near blacksmith in daytime.
IA105 trade is preferred in market at midday.
IA106 guard is preferred at military lane.
IA107 farm is preferred in productive daylight.
IA108 gather is preferred near river in clear weather.
IA109 warning is preferred in storm exposure.
IA110 quiet remains a safe fallback.
IA111 stage affects activity priority.
IA112 lane affects activity priority.
IA113 weather affects activity priority.
IA114 mobile affects presentation density.
IA115 confidence affects scheduler scores.
IA116 shelter need affects journey focus.
IA117 cadence state affects journey focus.
IA118 route lane affects activity composition.
IA119 gateway state affects entry cues.
IA120 checkpoint state remains diagnostic.
IA121 no hidden async work.
IA122 no hidden interval work.
IA123 no hidden timeout work.
IA124 no persistence side effect.
IA125 no mutation side effect.
IA126 no renderer dependency.
IA127 no editor dependency.
IA128 no direct three import.
IA129 no model attachment.
IA130 no primitive geometry.
IA131 no terrain height write.
IA132 no hydrology write.
IA133 no road geometry write.
IA134 no navigation mesh write.
IA135 no AI controller creation.
IA136 no combat state creation.
IA137 no quest mutation.
IA138 no save mutation.
IA139 no input mutation.
IA140 no camera mutation.
IA141 context records world chunk identity.
IA142 context records settlement identity.
IA143 context records weather identity.
IA144 context records stage identity.
IA145 context records lane identity.
IA146 context records phase identity.
IA147 context records mobile identity.
IA148 scheduler records window identity.
IA149 cadence records cadence state.
IA150 shelter records preferred shelter.
IA151 journey records focus.
IA152 journey records confidence.
IA153 validation returns error arrays.
IA154 validators avoid throwing on plain objects.
IA155 validators return deterministic fingerprints.
IA156 summaries return deterministic fingerprints.
IA157 frozen API arrays resist mutation.
IA158 frozen result arrays resist mutation.
IA159 finite numeric fallback is mandatory.
IA160 normalized score range is mandatory.
IA161 duplicate identifiers remain disallowed.
IA162 empty activity list uses quiet fallback.
IA163 empty signal list remains valid.
IA164 mobile activity cap is lower than desktop.
IA165 mobile scheduler cadence stays finite.
IA166 mobile shelter semantics remain equal.
IA167 mobile journey semantics remain equal.
IA168 accessibility semantics remain caller-owned.
IA169 UI copy remains bounded.
IA170 metadata remains bounded.
IA171 activity distance never exceeds 240 meters.
IA172 scheduler entries remain bounded.
IA173 scheduler priority remains bounded.
IA174 cadence interval remains positive.
IA175 shelter need remains between zero and one.
IA176 shelter visibility remains between zero and one.
IA177 journey confidence remains between zero and one.
IA178 activity score remains between zero and one.
IA179 activity priority remains finite.
IA180 signal score remains finite.
IA181 weather lookup defaults clear.
IA182 phase lookup defaults midday.
IA183 lane lookup defaults gateway.
IA184 stage lookup defaults travel.
IA185 mode lookup stays canonical.
IA186 summary never exposes mutable children.
IA187 validators never write input.
IA188 replay never writes input.
IA189 parser never mutates source.
IA190 ledger entries remain inspectable.
IA191 profile entries remain inspectable.
IA192 scenario identifiers remain unique.
IA193 profile identifiers remain unique.
IA194 deterministic sorting uses stable identifiers.
IA195 deterministic sorting uses stable score.
IA196 deterministic sorting has explicit tiebreakers.
IA197 weather penalties remain bounded.
IA198 fatigue influence remains bounded.
IA199 service bonus remains bounded.
IA200 mobile reduction remains bounded.

IA201 far stage can prioritize observation.
IA202 approach stage can prioritize travel.
IA203 threshold stage can prioritize entry.
IA204 inside stage can prioritize social.
IA205 service stage can prioritize service.
IA206 departure stage can prioritize return.
IA207 resume stage can prioritize recovery.
IA208 clear weather can prioritize travel.
IA209 cloud weather preserves route readability.
IA210 fog weather suppresses long-range observation.
IA211 rain weather suppresses exposed travel.
IA212 snow weather suppresses exposed gather.
IA213 storm weather suppresses exposed travel.
IA214 wind weather keeps travel viable but cautious.
IA215 sleet weather increases rest.
IA216 gateway lane maps to entry role.
IA217 market lane maps to commerce role.
IA218 tavern lane maps to rest role.
IA219 craft lane maps to craft role.
IA220 farm lane maps to survival role.
IA221 military lane maps to training role.
IA222 stable lane maps to travel role.
IA223 home lane maps to persistence role.
IA224 river lane maps to water-route role.
IA225 ridge lane maps to high-ground role.
IA226 activity IDs remain stable for same input.
IA227 activity order remains stable for same input.
IA228 signal order remains stable for same input.
IA229 schedule order remains stable for same input.
IA230 journey order remains stable for same input.
IA231 cadence state remains stable for same input.
IA232 shelter type remains stable for same input.
IA233 weather normalization remains stable.
IA234 hour normalization remains stable.
IA235 fatigue normalization remains stable.
IA236 mobile normalization remains stable.
IA237 malformed number handling remains stable.
IA238 malformed string handling remains stable.
IA239 null handling remains stable.
IA240 empty object handling remains stable.
IA241 activity context can feed scheduler.
IA242 activity context can feed cadence.
IA243 activity context can feed shelter.
IA244 cadence can feed journey.
IA245 shelter can feed journey.
IA246 journey can feed UI.
IA247 scheduler can feed UI.
IA248 shelter can feed UI.
IA249 cadence can feed UI.
IA250 none of these can mutate world state.
IA251 no direct actor spawn command exists.
IA252 no direct road edit command exists.
IA253 no direct terrain edit command exists.
IA254 no direct navmesh edit command exists.
IA255 no direct save command exists.
IA256 no direct quest command exists.
IA257 no direct economy command exists.
IA258 no direct combat command exists.
IA259 no direct material command exists.
IA260 no direct model command exists.
IA261 scenario records are descriptive.
IA262 profile records are descriptive.
IA263 scheduler records are descriptive.
IA264 journey records are descriptive.
IA265 shelter records are descriptive.
IA266 cadence records are descriptive.
IA267 activity records are descriptive.
IA268 signal records are descriptive.
IA269 route records are advisory.
IA270 risk records are advisory.
IA271 no renderer lifecycle ownership.
IA272 no resource loader ownership.
IA273 no background worker ownership.
IA274 no network ownership.
IA275 no filesystem ownership.
IA276 no analytics mutation.
IA277 no telemetry mutation.
IA278 no hidden state cache.
IA279 no global singleton.
IA280 no global mutable map.
IA281 functions accept options objects.
IA282 functions provide safe defaults.
IA283 functions return plain serializable objects.
IA284 functions return frozen objects.
IA285 functions use bounded lists.
IA286 functions use normalized numbers.
IA287 functions use canonical strings.
IA288 functions use deterministic hashes.
IA289 functions expose validation.
IA290 functions expose summaries.
IA291 API constants are immutable.
IA292 vocabulary arrays are immutable.
IA293 policy constants are immutable.
IA294 scenario rows are immutable.
IA295 profile rows are immutable.
IA296 schedule rows are immutable.
IA297 cadence rows are immutable.
IA298 shelter rows are immutable.
IA299 journey rows are immutable.
IA300 review contract remains read-only.
