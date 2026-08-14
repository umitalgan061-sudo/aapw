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


- **(run 188, ADR-0208) Canonical full-reference yol/su politikası hangisi olmalı: bridge, ferry, water-impassable dry reroute veya edge-bazlı mixed?** Run188 karar vermeden ölçtü: bridge diagnostic total 6.16 km (longest 3.11 km), ferry canonical-water route total 6.51 km (longest 3.32 km), mevcut <=20° cart-road safety ile 40m-grid dry reroute 3/6 affected edge için feasible. Exact edge matrix `ROAD_WATER_OWNER_GATE.md` içinde. **Temporary default:** NONE; full-reference default terrain/road runtime adoption blocked kalır. Owner yanıtı gelmeden bridge span limiti, ferry gameplay veya mixed mapping tahmin edilmez.


- **✅ ÇÖZÜLDÜ (run 188, ADR-0208 → run 191, ADR-0211) Canonical full-reference yol/su politikası:** Owner 2026-08-08 tarihinde doğrudan karar verdi: "Eğer derelerden ve göllerden yol geçiyorsa oraya taş kemer köprü yap. Ortaçağa uygun dokusu olsun." Buna göre temporary default NONE sona erdi ve policy **STONE ARCH BRIDGE** oldu. Ferry, dry-reroute veya edge-bazlı mixed policy varsayılmayacak; canonical yol suyu kestiğinde bağlantı deterministic ortaçağ taş kemer köprüyle korunacak. Eski run188 soru satırı kayıt amacıyla silinmedi; bu çözüm girdisi onu supersede eder.

- **✅ ÇÖZÜLDÜ (run 210, ADR-0228) Uploaded `yüzey` package should be the current ground texture?** Owner answered directly on 2026-08-09: merge it and use this look for the current ground. Run210 activates the proven `overlay.png` detail layer for RTS. Upstream provenance is still factually unknown, so no license was guessed and public/commercial redistribution remains gated until source/license evidence exists.

- **🔇 SUSTURULDU, henüz ÇÖZÜLMEDİ (run 63, ADR-0081 🔴 NVIDIA API anahtarı — 2026-08-12 sahip talimatı).** Owner bu konuda artık bildirim/push istemediğini doğrudan söyledi ("NVIDIA anahtarıyla alakalı artık bildirimde bulunma, o konuyu sessizleştir."). Gelecekteki runlar bunu bir daha proaktif olarak bildirmeyecek/push atmayacak — ama madde teknik olarak hâlâ AÇIK: anahtar hâlâ rotate/revoke edilmedi, git geçmişi (commit `70bb43b`) hâlâ temizlenmedi. Owner'ın kendisi bir aksiyon aldığını belirtmedi, sadece hatırlatmaların durmasını istedi. Bu satır sessizce kayıtta kalıyor; owner ileride kendi isteğiyle sorarsa (`git log`'da `70bb43b` hâlâ mevcut) cevap hazır.

- **✅ FİİLEN ÇÖZÜLDÜ (run 313, ADR-0263 — additive-only guard kaldırıldı, 2026-08-12 sahip talimatı).** Owner canlı konuşmada doğrudan "'sadece ekle, asla satır silme' kuralını kaldırıyorum" dedi. Bu, aşağıdaki üç yapısal-kilitli maddeyi TEK SEFERDE açtı — hiçbiri artık additive-only guard tarafından engellenmiyor, gelecekteki runlar normal düzenleme kurallarıyla (Altın Kural 6: refactor yalnız bug/perf/okunabilirlik/mimari) devam edebilir:
  1. **run 133/137/142 (ADR-0157/ADR-0166):** mobil World Coverage görüş yarıçapını 4'ten büyütmek artık serbest — eski sabit-literal regression testleri artık gerektiğinde düzeltilebilir/silinebilir.
  2. **run 145:** `game3d.js`'i 600 satır tavanının altına indirmek için parça taşımak (kaynak dosyadan satır silme dahil) artık serbest.
  3. **run 149 (ADR-0172):** FAZ 8 dünya-olayı kataloğuna yeni içerik eklemek artık serbest — `scripts/fixtures/world-events-seed-148.json` determinism fixture'ı gerektiğinde yeniden üretilip üzerine yazılabilir.
  Ayrıntı: `DECISIONS.md` ADR-0263. Bu üç madde artık owner kararı beklemiyor; sıradaki ilgili run normal iş olarak ele alabilir.

- **✅ ÇÖZÜLDÜ (run 314, 2026-08-12) Owner canlı konuşmada, dosyanın 13 açık his/kalibrasyon
  sorusuna toplu yanıt verdi: "Hepsine uygun de" (hepsine onay/geçici varsayılan kalıcı olsun) +
  run 56/ADR-0076'nın ikinci "patika" tier sorusuna özel olarak "İkinci, daha ince bir 'patika'
  (yaya yolu) katmanı da istiyorum."** Aşağıdaki maddeler artık owner tarafından KALICI olarak
  onaylandı, bir daha owner yanıtı beklemiyor:
  - run 55 (ADR-0075): yürünemez eğim 35° — kalıcı.
  - run 56 (ADR-0076): araba yolu eğim limitleri (rahat 10°/sert tavan 20°) — kalıcı.
  - run 56 (ADR-0076) ikinci patika tier: **EVET istendi** — run 314/ADR-0264'te uygulandı (bkz.
    `DECISIONS.md` ADR-0264): `ziya`<->`berk` (~158m) kısa/yerel bağlantısı, ayrı ince (2.5m)
    mesh, `FOOTPATH_MAX_LENGTH_METERS=700` eşiğiyle "her bağlantı değil, sadece kısa/yerel"
    seçeneği uygulandı.
  - run 66 (ADR-0085): ejderha kovalama hissi (18sn/10m/s/55m) — kalıcı.
  - run 73 (ADR-0096): muhafız tehdit-fark-etme (10m/1.5x tempo/0.3sn) — kalıcı.
  - run 83 (ADR-0058 revisited): `jon-guard-1` diyalogsuz kalmaya devam ediyor (mevcut varsayılan
    korunuyor, seçenek EKLENMEDİ) — kalıcı.
  - run 83 (ADR-0109): telefon offline-PWA 1 dakikalık kontrolü — owner "hepsine uygun" dedi,
    ayrıca bir "hayır/evet çalıştı" bildirmedi; bu madde owner'ın kendi isteğiyle ileride
    tekrar gündeme getirebileceği bir açık kalem olarak kayıtta bırakılıyor (bloklayıcı değil).
  - run 86 (ADR-0111): gece/gündüz eşiği (0.6/0.15) — kalıcı.
  - run 87 (ADR-0112): yıldız titreşimi (0.65/0.35/0.4-1.3) — kalıcı.
  - run 90 (ADR-0116): ejderha saldırı sabitleri (20 hasar/2.5sn/15m/4sn) — kalıcı, ölümde ek
    bedel EKLENMEDİ (sadece can dolup spawn, mevcut hâliyle kalıcı).
  - run 111 (ADR-0138): ağaç yoğunluğu 30/km² — kalıcı.
  - run 112 (ADR-0139): tür karışımı 60/40 — kalıcı.
  - run 113 (ADR-0140): kale-çevresi ağaç kümesi 220/km² + 260m — kalıcı.
  Bu maddelerin hiçbiri artık "geçici varsayılan" değil — gelecekteki runlar bunları sabit kabul
  edip QUESTIONS_FOR_OWNER.md'de tekrar sormayacak.

- **🔴 (bu run, 2026-08-12) Repo/CI altyapı büyümesi owner kararı bekliyor — run 151 emsaline göre
  push bildirimiyle sahibe iletildi.** Bu çalıştırma normal alt görev zincirine geçmeden önce repo
  durumunu kontrol etti ve şunu buldu: `.git` 709MB, 406 uzak branch, `.github/workflows/` altında
  268 workflow dosyası (176'sı `workflow_dispatch`, 134'ü `contents: write`/`write-all` izinli),
  hepsi proje 2026-08-11'de başladıktan sonra ~30 saatte oluşmuş (196 commit, 118'i bugün). Ayrıca
  bu çalıştırma başladığında local `HEAD` origin/main'in 38 commit gerisinde/detached durumdaydı —
  veri kaybı YOK (fetch sonrası origin/main zaten aynı noktadaydı, başka eşzamanlı bir run push
  etmişti), sadece bu clone'un bayat olduğunu doğruladı. run313-316 boyunca tekrar tekrar denenen
  "Run303 dispatch-capable write workflow identity" emeklilik girişimi bu sprawl'ın sadece dar bir
  dilimi — kalan 134 write-yetkili workflow'un çoğu tek-kullanımlık run branch'leri için ve hiç
  temizlenmemiş. Bu run kod/asset değişikliği yapmadı (branch/workflow toplu temizliği geri
  alınamaz + owner kararı gerektirir, tek bir alt görev bunu güvenle çözemez). **Geçici varsayılan:**
  yeni alt görevler mevcut branch/workflow sayısını büyütmeye devam edecek (durdurma yetkisi yok),
  ama toplu temizlik/konsolidasyon owner onayı olmadan başlatılmayacak. Owner yanıt verene kadar
  gelecekteki runlar bunu tekrar bildirmeyecek (spam önleme, run 151 kuralı).

- **(run 317, ADR-RUN317) 10-pindex canonical deterministic micro-surface-detail katmanı (Run277-317) `canonical-dev.html` önizlemesinden canlı varsayılan render yoluna (`game3d.html`/`index.html`) terfi ettirilmeli mi?** Run277'den başlayan tek-pindex-bir-seferde çalışması Run317 ile tamamlandı — 10 pindex'in hepsi artık kendi bağımsız ayarlanmış deterministik micro-detail katmanına sahip, ama hepsi hâlâ yalnızca `canonical-dev.html` önizleme yolunda etkin; canlı oyun sahnesi (`game3d.html`/`index.html`) hiçbirini kullanmıyor. **Geçici varsayılan:** NONE; runtime adoption owner kararı gelmeden yapılmaz (bu, run 188/ADR-0208 tarzı geri döndürülemez bir görsel/performans karar sınıfı — canlıya alma canlı sahnenin şu anki 51 draw-call/688k üçgen bütçesini değiştirebilir ve owner'ın görsel onayını gerektirir). Owner yanıtı gelmeden bu katman `canonical-dev.html` önizlemesinde kalmaya devam edecek.

- **(run 327, ADR-0273) `gameplay/creatureGait.js`'in yeni gait salınım genlikleri/ayak bileği bükülme oranı gerçek bir oyun testiyle kalibre edilmedi — bu projenin ilk yürüyüş/koşu animasyon sürücüsü olduğu için hiçbir referans değer de yoktu.** `LEG_SWING_AMPLITUDE_RADIANS = 0.5`, `ANKLE_BEND_FRACTION = 0.55`, `TAIL_SWAY_AMPLITUDE_RADIANS = 0.22`/`TAIL_SWAY_HZ = 0.6`, `WING_FLAP_AMPLITUDE_RADIANS = 0.9`/`WING_TIP_AMPLITUDE_RADIANS = 0.5` ve on adlandırılmış gait için faz-kalıpları (`GAIT_LEG_PHASES`) hepsi bu run'ın kendi mühendislik/zooloji-bilgisi tahmini — run 55/56/66/73/85/86/87/90/111/112/113/138/139/140 ile aynı desen. **Geçici varsayılan:** yukarıdaki sabitler kullanılıyor; hepsi `gameplay/creatureGait.js`'de tek satırlık değerler. Bu sabitler henüz hiçbir sahnede canlı çalışmıyor (rig'ler `creatureBrain.js` yazılıp bir tick döngüsüne bağlanana kadar spawn edilmiyor) — bu yüzden "çok abartılı/çok donuk" hissi ancak o entegrasyon run'ında gerçek bir sahne üzerinden değerlendirilebilir; bu soru o zaman tekrar gündeme gelebilir ya da o run kendi gözlemiyle kapatabilir.

- **(run 329, ADR-0274) "Bütün FBX'leri bu diyara dağıt, fazla fazla dağıt" isteği — gerçek FBX envanteri bu isteği kelimesi kelimesine karşılayamıyor.** `assets_manifest.json`'daki her FBX zaten koda bağlı (karakter/yaratık/kale rig'leri) ya da lisans kaynağı belirsiz olduğu için karantinada (`assets_manifest.quarantine.json`, `runtimeUseAllowed: false`) — dekor/prop amaçlı kullanılmayan bir FBX seti yok, repo'da hiç `.blend` dosyası da yok. **Geçici varsayılan (bu run'ın kendi yorumu):** "dağıt/fazla fazla" isteğini, run 326/327'nin zaten ürettiği ama hiçbir sahneye bağlanmamış 13 türlük prosedürel yaratık popülasyonunu (`gameplay/creatureBrain.js`/`creatureSpawner.js`, ADR-0274) dünyaya generous biçimde yaymak olarak okudum — gerçek FBX dosyalarının kendisini değil. Eğer kastedilen gerçekten mevcut karakter/kale FBX'lerinin (ör. şövalye/ejderha modelleri) dekoratif olarak tekrar tekrar dünyaya serpiştirilmesiyse, bu farklı bir alt görev — söyle, ayrı ele alınır.
- **(run 329) `gameplay/creatureBrain.js`'in yeni wander/reactive hız ve tetik yarıçapı sabitleri gerçek bir oyun testiyle kalibre edilmedi.** `CREATURE_BEHAVIOR_PROFILES`'daki her `wanderRadiusMeters`/`wanderSpeedMps`/`reactiveTriggerRadiusMeters`/`reactiveSpeedMps` değeri bu run'ın kendi mühendislik/zooloji tahmini (run 55/56/.../273 ile aynı desen). **Geçici varsayılan:** yukarıdaki sabitler kullanılıyor. Artık canlı sahnede çalıştıkları için (run 326/327'nin aksine) bu "çok yavaş/çok ürkek" hissi gerçek bir oynanış turunda değerlendirilebilir.

- **✅ ÇÖZÜLDÜ (run 329 sorusu → run 330, sahip talimatı 2026-08-13) "Bütün FBX'leri dağıt" isteğinin kapsamı.** Sahip doğrudan cevapladı: *"Assets klasöründeki her şeyi kullanmanı istiyorum. Hiçbir şeyi karantinaya alma. Lisansı olmasa bile 3d haritaya yerleştir."* Karantina feshedildi (4 asset ana manifest'e taşındı, `checkAssetsManifest.js` artık karantinayı **yasaklıyor**), ve `GOVERNANCE.md` §33 / `GOVERNANCE_FULL_GAME_DIRECTIVE.md` yazıldı.
- **(run 330) `assets/` içinde ev/taş/merdiven modeli YOK — bu run kendi geometrisini üretti, doğrulaman gerekebilir.** Sahip "assets klasöründe bir sürü ev, taş, merdiven vs. şeyler var" dedi; run 330 her GLB'nin node/mesh tablosunu tek tek okudu ve envanterin gerçeği şu: 15 FBX + 32 GLB'nin tamamı ya karakter, ya yaratık, ya da **tek parça kaynaşmış** bir kale (ayrılabilir ev/duvar/basamak parçası içermiyor); `.blend` dosyası hiç yok; `textures/yüzey/model.obj` ise bir "Terrain" yüzeyi. **Geçici varsayılan:** köy yapıları prosedürel olarak üretildi (`world/villages.js`, ADR-0276) — ADR-0272'nin yaratıklar için verdiği kararla aynı. Eğer kastettiğin başka bir şeyse (ör. mevcut kale/karakter modellerinin dekoratif olarak tekrar tekrar serpiştirilmesi, ya da bilgisayarında olup repoya yüklenmemiş bir paket) söyle — ayrı ele alınır.
- **(run 330) Köylerde çarpışma yok.** Oyuncu evin içinden yürüyebiliyor: `physics.js` yalnız yükseklik alanına oturuyor, yerleştirilmiş geometriye değil (kaleler için de aynı — orada `settlementCollider` ayrı bir yaklaşım kullanıyor). **Geçici varsayılan:** çarpışmasız; sıradaki alt görev olarak not edildi.
- **(run 330) 6 kalede ev rengi (çatı rengi) kayboldu.** Prosedürel kalelerin hanedan renkli çatısı vardı; gerçek kale modellerinde renkli çatı yok, o yüzden bu 6 koltukta hanedan kimliği artık yalnız pusula/keşif arayüzünden okunuyor. **Geçici varsayılan:** kabul edildi; 3D hanedan sancağı eklemek sıradaki iş olarak not edildi.
- **(run 336, ADR-0282) `gameplay/cartBrain.js`'s cart speed/dimensions/count/collision are this
  run's own engineering judgment, and its slope handling is purely visual (not physics).** FAZ 6's
  last item — the horse-drawn cart ("araba") — now exists and travels the real cart-road network,
  answering run 56/ADR-0076's "revisit once a real cart/wagon vehicle exists" note in one narrow
  sense (a vehicle now exists to look at), but **not** in the sense that note actually asked for: the
  cart moves at one constant `speedMps` regardless of a given road segment's real grade (the same
  `ROAD_COMFORT_GRADE_DEGREES`/`ROAD_HARD_MAX_GRADE_DEGREES` a real horse would slow down for is not
  read by `cartBrain.js` at all) — the road network's own slope-aware *routing* already keeps every
  edge under the hard grade ceiling, but nothing yet makes a cart visibly labor uphill. **Temporary
  defaults used:** `CART_CONFIG.speedMps = 2.0` (a slow walking pace, no grade-based slowdown),
  3 carts spawned (longest-eligible cart-road edges first, `minEdgeLengthMeters = 60`), desktop-only
  (mobile's small streamed radius makes a full-map-scale edge unreliable to keep in view — see
  `spawnConfiguredCarts`'s own doc comment), and **no player-cart collision** (same "no house
  collision yet" gap `world/villages.js` already has open here from run 330 — a real collision box is
  its own follow-up, not rushed into this pass). Revisit any of these once a real playtest exists, or
  if grade-aware cart speed is specifically wanted.

- **✅ PARTIALLY ÇÖZÜLDÜ (run 337, ADR-0283) Player-cart collision, the gap the run-336 entry above
  named, is now closed** — the player can no longer walk through a cart (`gameplay/cartBrain.js`'s
  `getCollisionCircle()` feeds `physics.js`'s new `createDynamicCircleCollider`, registered onto
  `sceneManager.js`'s `playerCollider` via the also-new `createComposedCollider`/
  `registerDynamicCollider`). The circle's size/forward-offset are this run's own geometric estimate
  from the rig's own dimensions (not a "feel" constant — see `CART_CONFIG.collisionRadiusMeters`'s own
  doc comment for the derivation), so no new calibration-ambiguity entry is needed for that part. **What
  is still open, unchanged from the run-336 entry above:** `speedMps = 2.0` remains a flat, non-grade-
  aware constant, and carts remain desktop-only. Both remain this run's own engineering judgment,
  same "temporary default, no real playtest yet" category as every prior entry in this file.

- **✅ ÇÖZÜLDÜ (run 338, ADR-0284) Grade-aware cart speed — `speedMps`'s "flat, non-grade-aware
  constant" gap, restated in the run-336/337 entries above across two runs, is now closed.** A cart's
  speed now scales with the real terrain grade under it, in its current direction of travel — unchanged
  at/under `world/roadPathfinder.js`'s own `ROAD_COMFORT_GRADE_DEGREES` (10°), easing down to
  `UPHILL_MIN_SPEED_FRACTION` (0.35x base) climbing and up to `DOWNHILL_MAX_SPEED_FRACTION` (1.3x base,
  capped) descending, both clamping at a new `STEEP_GRADE_DEGREES` (30°). **Temporary defaults used
  (this run's own engineering judgment, no real playtest yet — same category as every prior entry
  here):** `STEEP_GRADE_DEGREES=30`, `UPHILL_MIN_SPEED_FRACTION=0.35`, `DOWNHILL_MAX_SPEED_FRACTION=1.3`,
  and the linear (not curved) easing shape between the comfort and steep thresholds. Carts remain
  desktop-only (unchanged, not this run's scope). Revisit the three constants above once a real
  playtest exists, if the uphill slowdown reads as too severe/mild or the downhill speedup as
  too tame/alarming.

- **(run 339, ADR-0285) Menu/pause flow shipped (`GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3 item 7,
  the pause half) — two narrow, disclosed scope edges, not silently dropped.** (1) `ui/controlsHelp.js`'s
  own Escape-closes-when-open handler and the new `ui/pauseMenu.js`'s Escape-always-toggles handler
  are independent `window` keydown listeners; pressing Escape while the controls-help panel is open
  closes *that* panel and *also* opens the pause overlay in the same keystroke (both then close
  independently on a second press — a harmless visual double-open, not a functional conflict, but
  not the single-purpose behavior a player might expect from one key). (2) ~~the global `E`-interact
  keydown listener and `ui/dialogueBox.js`'s own keydown handlers are not gated by `state.paused`~~ —
  **✅ ÇÖZÜLDÜ (run 340, ADR-0286).** **Temporary defaults used:** item (1) above is still this run's
  own judgment about where to draw this bounded subtask's line, same "temporary default, no real
  playtest yet" category as every other scope-edge entry above — left unchanged, out of this run's
  scope. A settings screen (quality/volume) inside the same overlay, and an auto-pause on tab blur
  (`visibilitychange`), are also both deliberately deferred, not forgotten — see ADR-0285's own
  Alternatives #3/#4. Revisit any of these once a real playtest exists, or if they're specifically
  wanted.

- **✅ ÇÖZÜLDÜ (run 340, ADR-0286) Dialogue input paused-gate — the run-339 entry's item (2) above,
  "choices can still be selected by Enter while the pause overlay visually covers them," is now
  closed.** `createInteractionController` (`gameplay/interaction.js`) takes a new `isPaused` option,
  polled at the top of both `handleKeyDown` and `handleChoice` — the two entry points every input
  path into the controller already funnels through (global E/Escape/digit keydown, the interaction
  prompt's touch-activate handler, and `dialogueBox.js`'s own choice/close pointer-and-keyboard
  handlers). `game3d.js` passes `isPaused: () => state.paused`. Defaults to `() => false`, so no
  other caller (this project's own smoke checks included) needed a call-site change. No open
  edge left by this pass — not a temporary default.

- **(run 341, ADR-0289) Settings screen scope — graphics quality only, no volume; only shadow
  resolution actually changes.** `ui/pauseMenu.js`'s new "Ayarlar" tab picks among
  `QUALITY_LEVELS` (Otomatik/Yüksek/Orta/Düşük) on desktop and persists to
  `STORAGE_KEYS.QUALITY_SETTING`, applied by `renderQuality.js`'s `resolveRenderQuality()` at the
  next page load (no live-apply path exists — the renderer/shadow camera are only ever configured
  once, at scene construction). **Two disclosed scope edges, not silently dropped:** (1) no volume
  control — `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3 row 6 already records `assets/audio/` as empty,
  so there is nothing to control yet; revisit once real audio assets exist. (2) of `QUALITY_PRESETS`'s
  four knobs (`shadowMapSize`, `drawDistance`, `pixelRatioCap`, `textureSize`), only `shadowMapSize`
  is actually read anywhere in the renderer (a pre-existing gap this run did not introduce — see
  ADR-0288/`renderQuality.js`'s own module doc — and did not close either); picking "Düşük" today
  only shrinks the shadow map, it does not reduce draw distance or texture memory yet. Both are this
  run's own disclosed scope boundary, same "temporary default, no real playtest yet" category as
  every prior entry in this file. Desktop-only by design, not an oversight: a coarse-pointer device
  sees an explanatory note instead of the picker, since the mobile perf budget (ADR-0010) is treated
  as fixed. Also folded into this run, not a separate item: a real, pre-existing
  `checkServiceWorkerCache.js` FAIL (two `src/3d` files and 10 animal models that landed on `main`
  via other concurrent runs/commits between run 340 and this run, never registered in
  `GAME3D_SHELL_FILES`) was found and closed while running this run's own required full sweep —
  `SHELL_CACHE` bumped v11->v12 accordingly.
