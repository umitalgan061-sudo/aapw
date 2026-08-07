# QUESTIONS_FOR_OWNER.md

Per `GOVERNANCE.md` §14: a real design/product decision logged here (with a temporary default)
instead of guessed at silently. Newest entry at the bottom.

**(run 151 not, 2026-08-07)** Bu dosyadaki 🔴 güvenlik maddesi (run 63, ADR-0081 — açık NVIDIA API
anahtarı) ve üç açık yapısal madde (run 142/ADR-0166 mobil radius-5, run 145 `game3d.js` bölünmesi,
run 149/ADR-0172 world-event determinism-checksum) run 151'de bir push bildirimiyle sahibe aktif
olarak iletildi — artık yalnızca bu dosyada sessizce bekleyen kayıtlar değil. Sahip yanıt verene
kadar gelecekteki runlar bu maddeleri tekrar bildirmeyecek (spam önleme), yalnız normal Session
Snapshot'ta okuyup geçici varsayılanlara uymaya devam edecek.

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

- **✅ ÇÖZÜLDÜ (run 66, ADR-0085 → run 90, ADR-0116) Should the dragon ever actually *hurt* the
  player — i.e. does this project want a health/damage system at all?** Owner answered directly,
  live, in their own words (2026-08-06): "Ejderha'ların olduğu yerde saldırganlığı da olsun.
  Kışkırtılırsa Ejderha'lar saldırsın." (Dragons should be aggressive where they exist; if provoked,
  they should attack.) Implemented run 90: a new generic `gameplay/health.js` state (this project's
  first health/damage system of any kind) + `ui/healthBar.js` HUD, and `gameplay/dragonController.js`
  gained a real attack-lunge escalation on top of the existing menace-dive — sustained proximity now
  lands a real, damage-dealing hit once fully committed. Death respawns the player at their spawn
  point, fully healed (no persistence — no `SaveSystem` exists yet, see the deferred rule in
  `GOVERNANCE.md` §16). Full reasoning in ADR-0116. This entry stays in the file, marked resolved
  rather than deleted, as a record of the question and its answer — the calibration constants that
  *implement* this decision are their own fresh entry at the bottom of this file, same pattern every
  other guessed-constant question already follows.

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

- **(run 87, ADR-0112) Yıldız titreşimi (twinkle) doğru hızda/genlikte mi hissettiriyor?**
  `stars.js`'e eklenen `TWINKLE_BASE = 0.65` / `TWINKLE_AMPLITUDE = 0.35` (parlaklık hiçbir zaman tam
  sıfıra inmiyor — "titreşim" değil "arıza" gibi görünmesin diye) ve `TWINKLE_FREQ_MIN/MAX = 0.4-1.3`
  rad/s (her yıldız ~5-16 saniyede bir tam döngü) bu çalıştırmanın kendi mühendislik tahmini, gerçek
  bir oyun testiyle kalibre edilmedi — ADR-0089/ADR-0096/ADR-0111'in aynı "gerçek biri izlemeden
  kalibre edilemeyen his değeri" deseni. **Geçici varsayılan:** yukarıdaki dört sabit kullanılıyor;
  hepsi `stars.js`'de tek satırlık düzenlemeler. Titreşim çok göze batıyor/çok belli belirsiz
  hissettirirse tersi de mümkün.


- **(run 90, ADR-0116) Ejderha saldırısının kalibrasyon sabitleri gerçek bir oyun testiyle ayarlanmadı
  — doğru hissettiriyor mu?** Sahip "kışkırtılırsa saldırsın" dedi, ama "ne kadar kışkırtma", "ne kadar
  hasar", "ne kadar can" gibi hissiyat sabitlerini kalibre edecek gerçek bir oyun testi yoktu — bu
  projenin ilk sağlık/hasar sistemi olduğu için hiçbir referans değer de yoktu. **Geçici varsayılanlar
  kullanıldı:** `PLAYER_CONFIG.MAX_HEALTH = 100`; `DRAGON_CONFIG.SPAWNS[0]`'da `biteDamage: 20`
  (5 isabetle yenilgi), `attackLateralPullFraction: 0.9`/`attackDropMeters: 78` (saldırı ne kadar
  yakına iniyor); `dragonController.js`'nin kendi varsayılanları `attackTriggerSeconds: 2.5`
  (kaç saniye sürekli kışkırtma gerekiyor), `biteRadiusMeters: 15` (ısırık menzili),
  `biteCooldownSeconds: 4` (iki ısırık arası minimum süre). Hepsi tek satırlık sabit değişiklikleri —
  bir oyun testi "çok kolay ölüyorum"/"hiç saldırmıyor" derse ilk bakılacak yer bu sabitler. Ayrıca
  şu an ölümde can yenilenmesi dışında bir bedel yok (ceza/geri yükleme mekaniği yok) — bunun
  yeterli mi yoksa ileride bir bedel eklenmeli mi, ayrı bir tasarım kararı olarak açık bırakıldı.

- **(run 133/137, ADR-0157, GOVERNANCE.md §2 madde 9) Mobil World Coverage'ı bounded-streaming
  yarıçapını (`world/chunkManager.js`'in run-130 `streamTowards` sarmalayıcısı) 3'ten büyütmek,
  additive-only guard ile mevcut `scripts/checkMobileChunkStreaming.js`'in sabit literal beklenti
  değerleri (`result.initial.loaded === 49`, `area === 12.25`) arasında gerçek bir çakışmaya
  giriyor — yeni bir radius sarmalayıcısı eklemek (run-130/134/136'nın kendi üzerine bindiği desen)
  additive-only kalır, ama bu, mevcut testin sabit beklentilerini artık YANLIŞ hâle getirir ve test
  gerçek bir regresyon olarak FAIL eder; testin kendisini sabit literaller yerine dinamik/türetilmiş
  beklenen değerlere geçirmek ise mevcut satırların silinmesini/değiştirilmesini gerektirir — bu da
  additive-only guard'ın kendisiyle çelişir. Run 133 bunu denedi, teknik engeli belgeledi
  (ADR-0157), radius artışını commit ETMEDEN geri aldı; run 134/136 bunun yerine terrain/vegetation
  LOD ile performans marjı biriktirdi (radius artışını çözmüyor, sadece hazırlık). **Geçici
  varsayılan:** radius 3'te sabit kalınıyor, mobil resident footprint ~%8.9 (49 chunk/12.25 km²)
  değişmiyor. **Sahipten istenen karar (ikisinden biri):** (1) `checkMobileChunkStreaming.js`'in bu
  tek dosya için additive-only guard'dan istisna tutulmasına (gerçek bir satır değiştirme/silme
  içeren bir "dinamik beklenen değer" yeniden yazımına) açık onay, YA DA (2) mevcut radius-3 sınırının
  kalıcı olarak kabul edilmesi (bu durumda bu madde kapatılır, gelecekteki mobil coverage çalışması
  yalnızca LOD/culling'e odaklanır, radius büyütme bir daha denenmez).

- **(run 111, ADR-0138) Yeni prosedürel ağaç sistemi (`world/vegetation.js`) ne kadar yoğun/seyrek
  olmalı — 30 ağaç/km² doğru mu hissettiriyor?** Bu projenin ilk gerçek bitki örtüsü eklemesi, gerçek
  bir oyun testiyle kalibre edilmedi (bu türden hiçbir önceki referans değer de yok).
  **Geçici varsayılan:** `world/vegetation.js`'in `TARGET_DENSITY_PER_KM2 = 30` sabiti kullanılıyor —
  tek satırlık bir değişiklik. Çok seyrek/çok yoğun hissettirirse veya belirli bir bölgede (örn.
  kale çevresi kümeleri) farklı yoğunluk istenirse, bu sabit ilk bakılacak yer.

- **(run 112, ADR-0139) İki ağaç türünün (pine/round) 60/40 karışım oranı doğru mu hissettiriyor?**
  `world/vegetation.js`'in `SPECIES` tablosundaki `weight: 0.6`/`weight: 0.4` değerleri de gerçek bir
  oyun testiyle kalibre edilmedi — run 111'in yoğunluk sorusuyla aynı desen. **Geçici varsayılan:**
  yukarıdaki iki ağırlık kullanılıyor; ikisi de tek satırlık sabitler. Bir tür çok baskın/çok nadir
  hissettirirse veya üçüncü bir tür eklenmek istenirse, bu ağırlıklar ilk bakılacak yer.

- **(run 113, ADR-0140) Yeni kale-çevresi ağaç kümesi (seat-local clustering ring) ne kadar
  yoğun/geniş olmalı — 220 ağaç/km² (temel dağılımın ~7 katı) ve 260m dış yarıçap doğru mu
  hissettiriyor?** `world/vegetation.js`'in `CLUSTER_DENSITY_PER_KM2 = 220` /
  `CLUSTER_RING_OUTER_RADIUS_METERS = 260` sabitleri de gerçek bir oyun testiyle kalibre edilmedi —
  run 111/112'nin yoğunluk/karışım oranı sorularıyla aynı desen. **Geçici varsayılan:** yukarıdaki
  iki sabit kullanılıyor; ikisi de tek satırlık değerler. Halka çok yoğun/çok seyrek hissettirirse
  veya kale başına farklı bir halka boyutu istenirse, bu sabitler ilk bakılacak yer. Not: bu özellik
  şu an masaüstünde 14 koltuktan 12'sinde aktif (Xaro ve Night King, önizleme diskinin dışında kaldığı
  için hariç), mobilde hiçbirinde (bkz. ADR-0140'ın Qualification-rule scope notu) — bu bilinçli bir
  kapsam kararı, hata değil.


- **✅ ÇÖZÜLDÜ (run 140, ADR-0164) Mobil World Coverage radius 3→4 için run 133/137'deki
  additive-only / sabit regression testi çatışması:** Proje sahibi 2026-08-07'de doğrudan
  **"Devam et"** diyerek radius büyütme çalışmasına devam edilmesini istedi. Run 140, iki seçenekten
  birini zorla seçmek yerine üçüncü ve daha güvenli additive yolu uyguladı: eski generic radius-3
  regression testi aynen çalışır bırakıldı; yalnız gerçek `sceneManager` tarafından settlement
  flatten-pad setiyle oluşturulan canlı mobil dünya manager'ı radius 4'e opt-in edildi. Böylece
  hiçbir mevcut kaynak/test satırı silinmedi veya değiştirilmedi, eski 49-chunk sözleşmesi tarihsel
  guard olarak yaşamaya devam ederken canlı oyun 81 resident chunk / 20.25 km²'ye çıktı.

- **(run 142, ADR-0166) Radius 4→5 aynı additive-only çatışmasını BİR SONRAKİ artışta da tekrar
  üretti — bu artık tek seferlik değil, YAPISAL/TEKRARLI bir kısıt görünüyor.** Run 140'ın kendi
  `scripts/checkMobileRadius4LiveWorld.js` testi, run 130'un `checkMobileChunkStreaming.js`'inin
  aksine, canlı oyunla AYNI "flattenPads.length >= 14" sinyalini kullanan bir manager kuruyor (bilinçli
  bir tasarım: gerçek canlı-dünya yolunu test etmek için). Bu, onu run 130'un testinin sahip olduğu
  doğal bağışıklığı vermiyor: radius 4'ten radius 5'e run-140 tekniğinin BİREBİR aynısıyla (aynı
  dosyada zaten var olan `_loadSquareBeforeMobileRadius4Run140`/`_streamTowardsBeforeMobileRadius4Run140`
  referanslarını radius 5 ile yeniden kullanan, hiçbir satırı silmeyen/değiştirmeyen bir sarmalayıcı)
  geçmek denendi ve **run öncesi node ile doğrulandı** — ölçülebilir performans marjı bol (radius-5
  readiness kanıtı: 74 draw call / 192.409 üçgen, 500/500.000 bütçesine göre — bkz.
  `scripts/checkMobileRadius5Readiness.js`). Ama canlı davranış radius 5'e geçtiği an
  `checkMobileRadius4LiveWorld.js`'in kendi sabit `loaded===81`/`area===20.25` beklentisi gerçek bir
  regresyon olarak FAIL etti (additive-only guard bu satırların düzeltilmesini yasaklıyor). Değişiklik
  bu run'da commit EDİLMEDİ — geri alındı, yalnız kanıt scripti (`checkMobileRadius5Readiness.js`,
  runtime davranışı değiştirmiyor) kaldı. **Yapısal gözlem:** her gelecekteki radius artışı, bir
  öncekinin kendi "canlı-dünya" testini aynı sebeple bozacak — çünkü o testin TÜM amacı o anki tam
  sözleşmeyi sabitlemek. Bu, additive-only kuralı DEĞİŞMEDİKÇE mobil radius büyümesine fiilen bir tavan
  koyuyor (şu an: 4, 81 chunk / 20.25 km² / ~%14.7 resident footprint). **Sahipten istenen karar
  (üçünden biri):** (1) Yalnızca bu tarz "o anki canlı-dünya sözleşmesini doğrulayan" dev-only test
  dosyaları (`scripts/checkMobile*LiveWorld.js` deseni) için additive-only guard'dan istisna — bir
  sonraki artış geldiğinde eskisi SİLİNİP yenisiyle değiştirilebilsin (silinen tek şey kendi eski
  sözleşmesini doğrulayan bir test, gameplay/render kaynak kodu değil). (2) Radius 4'ü kalıcı tavan
  kabul et — bu durumda bu madde ve run 133/137/140/141/142'nin tamamı kapatılır, gelecekteki mobil
  coverage çalışması yalnızca LOD/culling'e odaklanır. (3) Gelecekteki bu tarz testler baştan "floor"
  (`loaded >= N`) biçiminde yazılsın ki bir sonraki artışta hâlâ PASS etsinler — ama bu yalnız BİR
  sonraki artışı kurtarır, ondan sonrakini kurtarmaz (aynı sorun birkaç artış sonra geri döner), yine
  de (1)'e göre daha az invaziftir ve owner onayı gerektirmez, bu yüzden owner (1) yerine bunu tercih
  ederse run 143+ bunu uygulayabilir. Geçici varsayılan: hiçbiri seçilmedi, radius 4'te sabit kalınıyor
  (run 140'ın durumu aynen korunuyor), gelecekteki runlar bu maddeye owner yanıtı gelene kadar tekrar
  radius artışı denemeyecek.

- **(run 145) `game3d.js`'in 545/600 satır teknik borcu, additive-only guard nedeniyle YAPISAL olarak
  çözülemez hâle geldi — ADR-0166'daki mobil radius-5 çatışmasıyla aynı kısıt.** Bu dosyayı 600
  satır tavanının altına indirmenin tek gerçek yolu bir kısmını ayrı bir modüle taşımaktır, ama bu
  hem `game3d.js`'ten satır SİLMEYİ hem de o satırları başka bir dosyaya EKLEMEYİ gerektirir —
  `scripts/checkAdditiveOnlyDiff.js` ilkini (kaynak dosyadan satır silme) kesin olarak yasaklıyor.
  Dosya henüz 600 tavanını AŞMADI (545/600, `checkSmokeCheckRegistry.js`'in WARN eşiği), bu yüzden
  şu an engelleyici değil — ama tavana ulaştığında (her yeni runtime wiring satırıyla yaklaşıyor)
  aynı seçenek üçlüsüyle karşılaşılacak: (1) salt-refactor/dosya-taşıma commit'leri için
  additive-only guard'dan dar kapsamlı bir istisna (yalnızca "aynı kodu başka dosyaya taşıma", yeni
  davranış değişikliği yok, ayrı bir commit + ADR ile), (2) 600 satır tavanını `game3d.js` için
  esnet/kaldır (Altın Kural 7'nin bir istisnası olarak, gerekçesiyle GOVERNANCE.md'ye işlenir), (3)
  hiçbir şey yapma — dosya 600'e ulaştığında yeni runtime wiring kodu zorunlu olarak zaten var olan
  ayrı modüllere yönlendirilir (bu, `game3d.js`'in kendisinin büyümesini durdurur ama mevcut 545
  satırını küçültmez, teknik borç sayacı kalıcı olarak 1'de sabit kalır). **Geçici varsayılan:**
  hiçbiri seçilmedi; gelecekteki runlar `game3d.js`'e yeni satır eklemekten kaçınıp (3)'ü fiilen
  uygulayarak dosyayı 600'ün altında tutmaya çalışacak, tavana ulaşılırsa (1) ya da (2) için owner
  yanıtı beklenecek.

- **(run 149, ADR-0172) FAZ 8 dünya-olayı kataloğuna yeni içerik eklemek artık run 148'in kendi
  sabit-checksum determinism guard'ıyla YAPISAL olarak çakışıyor — ADR-0166 (mobil radius-5) ve run
  145'in `game3d.js` gözlemiyle aynı additive-only kısıtı.** Kataloğa TEK bir yeni olay eklemek bile
  (mevcut hiçbir satır silinmeden/değiştirilmeden, sadece dizinin sonuna eklense bile) ağırlıklı
  seçim havuzunun toplam ağırlığını değiştirdiği için `scripts/checkWorldEventDeterminism.js`'in
  sabit seed'li 24 adımlık dizisini değiştiriyor — bu ampirik olarak denendi (geçici 1 olayluk deneme,
  hemen geri alındı, commit edilmedi). Fixture'ı (`scripts/fixtures/world-events-seed-148.json`)
  düzeltmenin tek yolu mevcut JSON içeriğini silip yeniden yazmak, bu da additive-only guard'ın
  `.json` dosyaları için satır silme/değiştirme yasağını ihlal ediyor. **Sahipten istenen karar
  (üçünden biri):** (1) Yalnızca bu tarz "sabit içerik kataloğunun anlık davranışını pinleyen"
  determinism fixture dosyaları (`scripts/fixtures/world-events-seed-*.json` deseni ve onu tüketen
  test dosyası) için additive-only guard'dan istisna — kataloğa her yeni içerik eklendiğinde fixture
  yeni bir run numarasıyla yeniden üretilip üzerine yazılabilsin (silinen tek şey kendi eski
  checksum'ını doğrulayan veri, gameplay/render kaynak kodu değil). (2) `checkWorldEventDeterminism.js`'i
  invariant-only bir teste indirger (tam ID dizisini pinlemeden yalnız "aynı seed→aynı sonuç",
  "farklı seed→farklı sonuç", gating kuralları — zaten smoke suite'in #7/#8 testleri bunun büyük
  kısmını ayrıca kapsıyor) — additive-only'i ihlal etmeden YENİ bir dosya olarak eklenebilir, ama eski
  checksum testi hâlâ FAIL etmeye devam edeceğinden bu tek başına yeterli değil; eski testin devre dışı
  bırakılması/silinmesi de gerekir ve bu da (1) ile aynı istisnayı gerektirir. (3) FAZ 8 dünya-olayı
  katalog büyümesini kalıcı olarak burada durdur — bu durumda item 14'ün bu alt-yolu kapanır,
  gelecekteki "yeni özellik" çalışması başka, kataloğa dokunmayan alanlara yönelir. **Geçici
  varsayılan:** hiçbiri seçilmedi; gelecekteki runlar sahip yanıtı gelene kadar `WORLD_EVENTS`
  kataloğuna yeni girdi eklemeyecek (mevcut 52 olay ve determinism guard'ı olduğu gibi korunuyor).
