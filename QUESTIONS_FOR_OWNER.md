# QUESTIONS_FOR_OWNER.md

Per `GOVERNANCE.md` §14: a real design/product decision logged here (with a temporary default)
instead of guessed at silently. Newest entry at the bottom.

- **(run 55, ADR-0075) What ground slope should count as "too steep to walk" for kingdom seats /
  future terrain features?** No code in this project enforces a walkable-slope limit yet
  (`physics.js`'s ground-height snap follows terrain regardless of steepness), so there was no
  existing project-defined value to reuse for `scripts/terrainSeatSafetyCheck.js`'s "gidilemez
  eğim" check. **Temporary default used:** 35° (stricter than Unity's default
  `CharacterController.slopeLimit`, 45°, and Unreal's default `WalkableFloorAngle`, ~44.7°). Revisit
  once real slope-based movement restriction (or a real playtest) exists to calibrate against.

- **(run 56, ADR-0076) What grade should a cart road refuse to comfortably climb — how much
  gentler than run 55's 35° foot-walkable default?** No existing project value answers "what's too
  steep for a horse-drawn cart" as distinct from "too steep for a person on foot". **Temporary
  defaults used:** `world/roadPathfinder.js`'s `ROAD_COMFORT_GRADE_DEGREES = 10°` (soft cost-curve
  target the A* search is biased toward) and `scripts/roadNetworkSafetyCheck.js`'s
  `ROAD_HARD_MAX_GRADE_DEGREES = 20°` (hard failure ceiling) — both this run's own engineering
  judgment (within this task's own suggested 15-20° range for the hard ceiling), not derived from
  real-world civil-engineering grade standards (which run steeper-terrain gamified worlds like this
  one don't really map onto directly). Revisit once a real cart/wagon vehicle (FAZ 6) exists to
  calibrate against actual vehicle physics, or if a human playtester finds a specific road segment
  reads as implausibly steep.

- **(run 56, ADR-0076) Is a second, thinner "patika" (footpath) road tier wanted, or is the single
  "at arabası yolu" (cart road) tier sufficient for now?** GOVERNANCE.md §18 item 2 names both; this
  run shipped only the wider cart-road tier (see ADR-0076's Decision point 3) since it was enough to
  prove routing/connectivity, and a second tier is a real, non-trivial follow-up (a second geometry
  pass plus a design call about *which* connections get the thinner tier — every edge, or only
  short/local ones like `olena`<->`berk`?). **Temporary default used:** single tier, deferred second
  tier noted in `3D_GAME_PROGRESS.md`'s "Next step". Revisit if/when a real product need for the
  visual distinction comes up (e.g. a future quest or NPC dialogue that references "the footpath"
  specifically).

- **(run 63, ADR-0081) 🔴 Security: leaked NVIDIA API key — needs owner action, not something this
  run could resolve unattended.** Commit `70bb43b` ("Create .env", 2026-08-03) committed a
  plaintext `NVIDIA_API_KEY` straight to `main`, alongside an unrelated `ndvi_nvidia.py` test script
  — neither has anything to do with the westeros-pwa 3D RPG. Both were still tracked at `HEAD` when
  this run started (i.e. the key ships in every fresh clone of `main` today). This run removed both
  files from the tracked tree and `.gitignore`'d `.env` (see DECISIONS.md ADR-0081), but deliberately
  did **not** rewrite git history to purge the key from `70bb43b`, and obviously cannot rotate the
  key itself. **Two owner actions needed:** (1) rotate/revoke this key at NVIDIA's API console — treat
  it as compromised regardless of the repo being private; (2) decide whether `main`'s history should
  be rewritten (`git filter-repo` + force-push) to remove `70bb43b`'s blob entirely, given this
  container's remote has separately rejected other force-style pushes (tag pushes, run 58) so the
  rewrite's own push may need to happen from the owner's own machine. **Temporary default used:** key
  treated as compromised, history left untouched, tree cleaned.

- **(run 66, ADR-0085) Should the dragon ever actually *hurt* the player — i.e. does this project
  want a health/damage system at all?** FAZ 7's dragon now genuinely hunts (leaves its castle, closes
  to ~65m, circles overhead for up to 18s, gives up). The obvious next increment is an attack, but
  that is blocked on a question no run should answer unilaterally: there is **no health, damage,
  death, or respawn concept anywhere in this codebase**, and adding one is a project-shaping decision
  (it implies combat, failure states, probably saves) far beyond "make the dragon better". **Temporary
  default used:** the dragon menaces and withdraws, dealing no damage — a threat that is never lethal.
  Revisit before any attack/fire-breath work starts.

- **(run 66, ADR-0085) Does the chase *feel* right at real frame rates — 18s engagement, 10 m/s
  pursuit speed, 55m tightened ring?** These were tuned against a 40-second simulated trajectory
  against the real terrain, which proves the mechanism but cannot tell you whether being chased reads
  as thrilling or merely annoying. Note 10 m/s deliberately beats `PLAYER_CONFIG.RUN_SPEED_MPS` (6.5),
  so a player cannot simply outrun it — only outlast it or break line of distance. **Temporary
  defaults used:** `pursuitMaxSeconds: 18`, `pursuitCenterSpeedMps: 10`, `pursuitCircleRadiusMeters:
  55` in `DRAGON_CONFIG.SPAWNS[0]` — all three are single-number edits if a playtest says otherwise.

- **(run 73, ADR-0096) Does the guard combat-stance reaction (turn-to-face + faster idle tempo) feel
  right at the chosen radius/speed, or too subtle/too aggressive?** No existing project value answered
  "how close before a guard notices you as a possible threat" or "how much faster should its idle read
  as tense" — `INTERACTION_CONFIG.PROMPT_RADIUS_METERS` (6m) answers a different question (dialogue
  range). **Temporary defaults used:** `NPC_CONFIG.COMBAT_STANCE_TRIGGER_RADIUS_METERS = 10` (larger
  than the 6m dialogue range, so the guard visibly notices before you're close enough to talk),
  `COMBAT_STANCE_IDLE_TIME_SCALE = 1.5` (matches `dragonController.js`'s own wing-flap telegraph
  default, ADR-0089, for consistency between the codebase's two no-dedicated-clip tension cues),
  `COMBAT_STANCE_TRANSITION_SECONDS = 0.3` (a near-instant ease, since this models a stationary human's
  posture snapping to attention rather than an airborne creature's momentum). All three are
  single-number edits in `gameplayConfig.js` if a playtest says otherwise.

- **(run 83, ADR-0058 revisited) Gece Nöbeti nöbetçisi `jon-guard-1` diyalog seçeneği almalı mı —
  yani FAZ 5 pilotu 14/14'e tamamlansın mı, yoksa 13'te bilinçli olarak kapalı mı kalsın?** Bu
  çalıştırma "FAZ 5: NPC diyalog 13/14" ifadesinin bir eksik iş sanılıp defalarca yeniden
  keşfedildiğini fark etti. Gerçekte 14. NPC bir unutma değil: ADR-0058'in "Alternatives considered"
  bölümü onu bilinçli olarak dışarıda bıraktı; gerekçe, Duvar nöbetçisinin kapalı ve uğursuz tek
  satırlık selamlamasının (`'Gece Nöbeti sınırdadır. Duvar'ın ötesinde ne olduğunu bilmek
  istemezsin.'`) ardına "istersen şunları sorabilirsin" listesi eklemenin o tonu zayıflatması. Bu
  sanatsal/tonal bir karar (API değil), ve ADR-0058'in kendi ifadesi de kesin değil, "arguably read
  better" diyor — yani makul biçimde iki türlü de gidilebilir. §14 gereği tek başıma tersine
  çevirmedim. **Geçici varsayılan:** ADR-0058'in kararı korundu, `jon-guard-1` seçeneksiz kalmaya
  devam ediyor ve FAZ 5 tasarım gereği TAMAM sayılıyor (GOVERNANCE.md §17 bu yönde netleştirildi).
  Tersini istersen tek bir küçük alt görev yeterli: `dialogueChoices.js`'e 2 seçenekli bir giriş
  (Duvar'ın ötesi / Gece Nöbeti yemini gibi temalarla) + mevcut 24/24 smoke suite'i zaten bu şekli
  doğruluyor.

- **(run 83, ADR-0109) 2D oyun çevrimdışı açıldığında veri yüklemesi otomatik başlıyor mu — sende
  gerçek cihazda kontrol edebilir misin?** Bu çalıştırma 2D oyunun çevrimdışıyken tamamen ölü
  olduğunu buldu ve düzeltti (`script.js` 2. satırda Firebase CDN'i yoksa çöküyordu, tüm oyun iptal
  oluyordu — ayrıntı ADR-0109). Düzeltmeden sonra `script.js` sonuna kadar çalışıyor ve
  `loadData()` elle çağrıldığında yerel veriye düzgün düşüyor (14 krallık, 74 işaret). Ekran
  görüntüsüyle doğrulandı: çevrimdışıyken açılış ekranı ("WESTEROS / YEDİ KRALLIK HARİTASI" +
  OYNAT düğmesi) artık düzgün geliyor — düzeltmeden önce `script.js` hiç çalışmadığı için burası
  ölüydü. Doğrulayamadığım tek şey OYNAT'a basıldıktan SONRAki harita durumu: başsız (headless)
  ortamda krallık verisi o aşamada boş kalıyor, ama harita zaten bu düğmenin arkasında olduğundan
  bunun gerçek bir sorun mu yoksa test ortamının bir kısıtı mı olduğunu ayırt edemedim. Her hâlükârda
  düzeltmeden ÖNCE de (hatta çok daha kötü biçimde) geçerliydi — yeni bir regresyon değil. **Geçici
  varsayılan:** çökme düzeltildi ve kalıcı testle korundu; açılış akışı olduğu gibi bırakıldı,
  §22'nin "aynı şeyde 2 başarısız denemeden sonra bırak" kuralı gereği zorlanmadı. **Senden
  istenen (1 dakikalık kontrol):** telefonunda PWA'yı kur, uçak moduna al, aç ve OYNAT'a bas —
  harita ve krallıklar geliyor mu? Gelmiyorsa kendi alt görevi olarak ele alınacak.

- **(run 86, ADR-0111) Dünya olayları artık gündüz/gece durumuna göre kısıtlanıyor (kuzey ışıkları
  vb. artık öğle vakti tetiklenmiyor, güneş tutulması artık gece yarısı tetiklenmiyor) — bu geçiş
  eşiği ("ne kadar karanlık olursa 'gece' sayılır") doğru mu hissettiriyor?** `gameplay/worldEvents.js`'e
  eklenen `NIGHT_THRESHOLD = 0.6` / `DAY_THRESHOLD = 0.15` (lighting.js'in 0=öğle..1=gece yarısı
  `nightFactor` ölçeğinde) bu çalıştırmanın kendi mühendislik tahmini — `lighting.js`'in alacakaranlık/
  şafak geçiş noktalarının (nightFactor 0.35) net biçimde dışında kalacak şekilde seçildi, ama gerçek
  bir oyun testiyle kalibre edilmedi. **Geçici varsayılan:** yukarıdaki iki sabit değer kullanılıyor;
  ADR-0111'de tam gerekçesi var. Eğer bir olay ("kuzey ışıkları" gibi) hâlâ çok erken/geç bir saatte
  tetikleniyormuş gibi hissettirirse, bu tek satırlık bir sabit değişikliği.

