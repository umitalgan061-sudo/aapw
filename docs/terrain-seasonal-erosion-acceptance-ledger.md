# Seasonal erosion acceptance ledger

A001 — profile data loads deterministically.
A002 — profile IDs remain unique.
A003 — climate labels are normalized.
A004 — substrate labels are normalized.
A005 — profile climate lookup returns only matching families.
A006 — profile substrate lookup returns only matching materials.
A007 — profile statistics remain finite.
A008 — profile rainfall is non-negative.
A009 — profile snowfall is non-negative.
A010 — profile freeze-cycle count is non-negative.
A011 — saturation stays normalized.
A012 — drainage stays normalized.
A013 — exposure stays normalized.
A014 — erosion stays normalized.
A015 — frost wear stays normalized.
A016 — dry crust stays normalized.
A017 — mud tint stays normalized.
A018 — moss retention stays normalized.
A019 — dust retention stays normalized.
A020 — canonical height remains untouched.
A021 — canonical hydrology remains untouched.
A022 — canonical coastline remains untouched.
A023 — canonical collider remains untouched.
A024 — canonical vegetation placement remains untouched.
A025 — no new geography is introduced.
A026 — day one maps to spring.
A027 — day ninety maps to spring.
A028 — day ninety-one maps to summer.
A029 — day one-eighty maps to summer.
A030 — day one-eighty-one maps to autumn.
A031 — day two-seventy maps to autumn.
A032 — day two-seventy-one maps to winter.
A033 — day three-sixty maps to winter.
A034 — day three-sixty-one wraps to spring.
A035 — day zero wraps to winter.
A036 — negative day wraps safely.
A037 — two authored years remain in one cycle.
A038 — seasonal phase is continuous.
A039 — warmth remains normalized.
A040 — rain forcing remains normalized.
A041 — dry forcing remains normalized.
A042 — frost forcing remains normalized.
A043 — snowmelt forcing remains normalized.
A044 — snowpack remains bounded.
A045 — frozen fraction remains bounded.
A046 — melt fraction remains bounded.
A047 — snowmelt runoff remains bounded.
A048 — freeze-thaw cycle remains bounded.
A049 — freeze-thaw crack remains bounded.
A050 — brittle rock amplification is explicit.
A051 — granite remains restrained.
A052 — basalt remains restrained.
A053 — shale receives brittle response.
A054 — schist receives brittle response.
A055 — tuff receives brittle response.
A056 — talus receives frost response.
A057 — moisture memory is finite.
A058 — moisture memory is gradual.
A059 — drought memory is finite.
A060 — drought memory increases with dry duration.
A061 — frost memory is finite.
A062 — frost memory increases with cycle count.
A063 — runoff pulse is finite.
A064 — rill response remains bounded.
A065 — sheet response remains bounded.
A066 — retention remains bounded.
A067 — wind ventilation remains bounded.
A068 — wind drying remains bounded.
A069 — shelter remains bounded.
A070 — canopy reduces ventilation.
A071 — wetness reduces drying.
A072 — high exposure increases drying.
A073 — high slope increases concentration.
A074 — low slope preserves sheet character.
A075 — snowmelt can increase runoff.
A076 — snowmelt cannot create geometry.
A077 — runoff cannot rewrite hydrology.
A078 — frost cannot move vertices.
A079 — drying cannot move vegetation.
A080 — material color is clamped.
A081 — material roughness is clamped.
A082 — normal strength is clamped.
A083 — specular damping is clamped.
A084 — base color remains the starting point.
A085 — base roughness remains the starting point.
A086 — seasonal composition remains render-only.
A087 — sediment composition is retained.
A088 — existing sediment response is consumed rather than replaced.
A089 — runtime context exposes season.
A090 — runtime context exposes forcing.
A091 — runtime context exposes transition.
A092 — runtime context exposes a stable runtime key.
A093 — runtime key contains world X.
A094 — runtime key contains world Z.
A095 — runtime key contains day.
A096 — runtime key contains hour.
A097 — runtime key contains climate.
A098 — runtime key contains substrate.
A099 — material cache key is stable.
A100 — material cache key changes on day.
A101 — material cache key changes on coordinate.
A102 — material cache key changes on profile index.
A103 — deterministic probe returns stable material.
A104 — deterministic probe returns stable key.
A105 — repeated runtime samples are equivalent.
A106 — world-space translation changes spatial signal.
A107 — different days change seasonal signal.
A108 — different climates change profile selection.
A109 — different substrates change frost response.
A110 — daily matrix remains bounded.
A111 — daily matrix retains day/night pairs.
A112 — response book contains regional context.
A113 — response book stats remain finite.
A114 — biome atlas contains four seasons.
A115 — biome atlas contains climate diversity.
A116 — biome atlas response values remain finite.
A117 — event list remains stable.
A118 — event scores remain bounded.
A119 — event ranking remains deterministic.
A120 — event plans validate.
A121 — event transitions remain explainable.
A122 — event material intent remains finite.
A123 — scenario ledger contains multiple climates.
A124 — scenario ledger contains multiple seasons.
A125 — scenario ledger contains multiple substrates.
A126 — scenario ledger validates.
A127 — edge-case catalog contains calendar checks.
A128 — edge-case catalog contains default-value checks.
A129 — edge-case catalog contains material checks.
A130 — edge-case catalog contains shader checks.
A131 — long-grid samples remain non-collapsed.
A132 — stress matrix covers steep slopes.
A133 — stress matrix covers wet basins.
A134 — stress matrix covers dry ridges.
A135 — stress matrix covers alpine frost.
A136 — stress matrix covers volcanic surfaces.
A137 — stress matrix includes porous materials.
A138 — stress matrix includes brittle materials.
A139 — stress matrix includes coarse materials.
A140 — acceptance suite checks every climate.
A141 — acceptance suite checks every season.
A142 — acceptance suite checks material bounds.
A143 — acceptance suite checks boundary markers.
A144 — edge-case suite checks null shader input.
A145 — edge-case suite checks shader idempotence.
A146 — edge-case suite checks snow extremes.
A147 — edge-case suite checks freeze extremes.
A148 — edge-case suite checks runoff extremes.
A149 — edge-case suite checks wind extremes.
A150 — shader source contains deterministic hash.
A151 — shader source contains fixed FBM loop.
A152 — shader source contains wet mask.
A153 — shader source contains frost mask.
A154 — shader source contains erosion mask.
A155 — shader source contains roughness hook.
A156 — shader source contains color hook.
A157 — shader source contains normal hook.
A158 — shader source avoids vertex height writes.
A159 — shader source avoids hydrology writes.
A160 — shader source avoids vegetation writes.
A161 — shader install is idempotent.
A162 — shader cache identity is versioned.
A163 — integration manifest declares profile policy.
A164 — integration manifest declares cycle policy.
A165 — integration manifest declares runtime policy.
A166 — integration manifest declares event policy.
A167 — integration manifest declares response-book policy.
A168 — integration manifest declares shader policy.
A169 — integration manifest declares render-only contract.
A170 — integration manifest declares deterministic contract.
A171 — integration manifest declares geometry boundary.
A172 — integration manifest exposes dependency graph.
A173 — integration manifest exposes topological order.
A174 — integration manifest exposes boundary contract.
A175 — runtime sample exposes canonical marker.
A176 — seasonal state exposes canonical marker.
A177 — adapter exposes schema version.
A178 — adapter preserves base material.
A179 — adapter preserves sediment state.
A180 — adapter visual weight remains bounded.
A181 — shader policy remains render-only.
A182 — shader policy remains deterministic.
A183 — shader policy preserves height.
A184 — shader policy preserves hydrology.
A185 — shader policy preserves coastline.
A186 — shader policy preserves colliders.
A187 — shader policy preserves vegetation placement.
A188 — cycle schema remains versioned.
A189 — runtime contract remains versioned.
A190 — event policy remains versioned.
A191 — scenario policy remains versioned.
A192 — edge-case policy remains versioned.
A193 — profile policy remains versioned.
A194 — response-book policy remains versioned.
A195 — biome policy remains versioned.
A196 — acceptance data is deterministic.
A197 — acceptance data is reviewable.
A198 — acceptance data avoids hidden randomness.
A199 — acceptance data stays separate from canonical geometry.
A200 — merge decision uses actual PR diff.
