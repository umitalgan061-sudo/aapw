/** Production TypeScript ambient world-event system. Deterministic and passive; no independent randomness source. */

const WEIGHT = Object.freeze({ COMMON: 3, UNCOMMON: 2, RARE: 1 });
const NIGHT_THRESHOLD = 0.6;
const DAY_THRESHOLD = 0.15;

export type WorldEventTimeOfDay = 'day' | 'night';
export type WorldEventRarity = 'common' | 'uncommon' | 'rare';

export interface WorldEventDefinition {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly desc: string;
  readonly color: string;
  readonly weight: number;
  readonly timeOfDay?: WorldEventTimeOfDay;
}

export interface WorldEventPayload extends WorldEventDefinition {}

export interface WorldEventSystem {
  readonly update: (deltaSeconds: number, nightFactor?: number) => void;
  readonly dispose: () => void;
}

const WORLD_EVENTS = Object.freeze([
  { id: 'raven', icon: '🐦', title: 'Kuzgun Ulaştı', desc: 'Uzak bir kaleden kuzgun mesajı geldi.', color: '#8faabb', weight: WEIGHT.COMMON },
  { id: 'distant_storm', icon: '🌩️', title: 'Uzak Fırtına', desc: 'Ufukta fırtına bulutları toplanıyor.', color: '#4a88c8', weight: WEIGHT.COMMON },
  { id: 'wolf_howl', icon: '🐺', title: 'Kurt Uluması', desc: 'Gecenin sessizliğinde bir kurt uluması yankılandı.', color: '#8faabb', weight: WEIGHT.COMMON, timeOfDay: 'night' as const },
  { id: 'feast_fires', icon: '🔥', title: 'Şölen Ateşleri', desc: 'Bir kalede şölen ateşleri yakıldı, kutlama sesleri rüzgarda taşınıyor.', color: '#e8784a', weight: WEIGHT.UNCOMMON },
  { id: 'dragon_shadow', icon: '🐉', title: 'Ejderha Gölgesi', desc: 'Gökyüzünde bir gölge geçti — yoksa hayal mi gördün?', color: '#c8430a', weight: WEIGHT.RARE },
  { id: 'guard_change', icon: '⚔️', title: 'Nöbetçi Değişimi', desc: 'Kale kapılarında nöbetçiler el değiştiriyor.', color: '#c8960a', weight: WEIGHT.COMMON },
  { id: 'sept_prayer', icon: '🕯️', title: 'Yedi Tanrı\'ya Dua', desc: 'Bir Sept\'ten mumların titreyen ışığı görünüyor.', color: '#e8b420', weight: WEIGHT.COMMON },
  { id: 'maester_raven', icon: '📜', title: 'Maester\'ın Kaydı', desc: 'Bir maester yeni bilgi kayıtlarını tamamladı.', color: '#20c8a0', weight: WEIGHT.UNCOMMON },
  { id: 'falling_star', icon: '🌠', title: 'Düşen Yıldız', desc: 'Gökyüzünde bir yıldız kayarken görüldü — bazıları bunu bir alamet sayar.', color: '#c8b4e8', weight: WEIGHT.UNCOMMON, timeOfDay: 'night' as const },
  { id: 'horse_gallop', icon: '🐎', title: 'Nal Sesleri', desc: 'Uzaktan bir atın nal sesleri duyuluyor — bir haberci mi, yoksa devriye mi?', color: '#b48a5a', weight: WEIGHT.COMMON },
  { id: 'trade_caravan', icon: '🛒', title: 'Tüccar Kervanı', desc: 'Kale yoluna bir tüccar kervanı yaklaşıyor, çanları uzaktan duyuluyor.', color: '#c89a30', weight: WEIGHT.UNCOMMON },
  { id: 'bell_toll', icon: '🔔', title: 'Çan Sesi', desc: 'Bir kalenin çanı çalıyor — nöbet değişimi mi, yoksa bir uyarı mı?', color: '#a0a0c8', weight: WEIGHT.UNCOMMON },
  { id: 'watch_horn', icon: '📯', title: 'Nöbet Boynuzu', desc: 'Uzaktan, kuzey yönünden tek bir boynuz sesi duyuldu. Sadece bir devriye mi dönüyor?', color: '#607890', weight: WEIGHT.COMMON },
  { id: 'tourney_announce', icon: '🏆', title: 'Turnuva Duyurusu', desc: 'Bir haberci komşu bir kalede düzenlenecek mızrak turnuvasını duyuruyor.', color: '#d4a017', weight: WEIGHT.UNCOMMON },
  { id: 'ship_sighted', icon: '⛵', title: 'Yelken Göründü', desc: 'Ufukta bir yelkenli belirdi — dost mu, yoksa yabancı bir bayrak mı taşıyor?', color: '#2c5f7a', weight: WEIGHT.UNCOMMON },
  { id: 'blacksmith_hammer', icon: '🔨', title: 'Demirci Çekici', desc: 'Bir kaleden ritmik çekiç sesleri geliyor — silahlar mı dövülüyor, at nalı mı?', color: '#7a5230', weight: WEIGHT.COMMON },
  { id: 'white_raven', icon: '🕊️', title: 'Beyaz Kuzgun', desc: 'Citadel\'den beyaz bir kuzgun geldi — mevsimin değiştiğinin habercisi.', color: '#e8e8e8', weight: WEIGHT.RARE },
  { id: 'iron_bank', icon: '🪙', title: 'Demir Banka Ziyareti', desc: 'Şehre yabancı bir tahsildar geldi — kimin ne borcu olduğunu fısıldıyorlar.', color: '#3a3a5a', weight: WEIGHT.UNCOMMON },
  { id: 'wildling_rumor', icon: '❄️', title: 'Vahşi Kuzeyliler Söylentisi', desc: 'Duvar\'ın ötesinden endişeli fısıltılar yayılıyor — bu kez gerçek mi?', color: '#4a6a8a', weight: WEIGHT.RARE },
  { id: 'mourning_bells', icon: '🖤', title: 'Yas Çanları', desc: 'Bir kaleden yavaş, ağır çan sesleri geliyor — biri kaybedilmiş.', color: '#4a4a4a', weight: WEIGHT.RARE },
  { id: 'red_comet', icon: '☄️', title: 'Kızıl Kuyruklu Yıldız', desc: 'Gökyüzünde günlerdir asılı duran kızıl bir kuyruklu yıldız — kimileri bunu bir hanedanın alâmeti sayıyor.', color: '#9c2a1e', weight: WEIGHT.RARE },
  { id: 'hunting_party', icon: '🦌', title: 'Av Dönüşü', desc: 'Bir av birliği kale kapısından geri döndü, atların sırtında günün avı asılı.', color: '#5a7a3a', weight: WEIGHT.UNCOMMON },
  { id: 'eclipse', icon: '🌑', title: 'Güneş Tutulması', desc: 'Öğle vakti gökyüzü kararıyor — kimileri bunu bir felaket alâmeti sayıyor, kimileri sadece doğanın bir cilvesi.', color: '#2a1f3d', weight: WEIGHT.RARE, timeOfDay: 'day' as const },
  { id: 'shackled_prisoner', icon: '⛓️', title: 'Zincirli Mahkûm', desc: 'Nöbetçiler zincirli bir mahkûmu kale kapısından zindana sürüklüyor — suçu neydi, kimse bilmiyor.', color: '#5c5c4a', weight: WEIGHT.UNCOMMON },
  { id: 'northern_lights', icon: '🌌', title: 'Kuzey Işıkları', desc: 'Ufkun kuzeyinde gökyüzü yeşile çalan bir ışıkla dalgalanıyor — yaşlılar bunu Duvar\'ın kendi uyarısı sayar.', color: '#2a7a5a', weight: WEIGHT.RARE, timeOfDay: 'night' as const },
  { id: 'traveling_singer', icon: '🎻', title: 'Gezgin Ozan', desc: 'Kale kapısına gelen bir ozan, eski krallardan kalma bir türküyü mızıkasıyla çalmaya başlıyor.', color: '#8a5ac8', weight: WEIGHT.UNCOMMON },
  { id: 'harvest_wagons', icon: '🌾', title: 'Hasat Arabaları', desc: 'Gün ışığında tahıl yüklü arabalar kale ambarlarına doğru ilerliyor; yol kenarında saman kokusu kalıyor.', color: '#c8a84a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'market_day', icon: '🧺', title: 'Pazar Günü', desc: 'Kale meydanında pazar kuruldu; tüccarlar mallarını gün ışığında sergiliyor, pazarlık sesleri yankılanıyor.', color: '#d4883a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'sellsword_arrival', icon: '🗡️', title: 'Kiralık Kılıç Gelişi', desc: 'Yorgun görünüşlü bir kiralık kılıç kale kapısına yaklaşıyor — iş mi arıyor, yoksa bir şeyden mi kaçıyor?', color: '#8a6a4a', weight: WEIGHT.UNCOMMON },
  { id: 'alms_giving', icon: '🍞', title: 'Sadaka Dağıtımı', desc: 'Kale kapısında bir septon dilencilere ekmek dağıtıyor, uzun bir sıra oluşmuş.', color: '#c8964a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'direwolf_track', icon: '🐾', title: 'Direwolf İzi', desc: 'Ormanın kenarında bir insan avucundan büyük pençe izleri bulundu — Stark\'ların efsanevi direwolf\'larından biri mi, yoksa sadece sıradan bir kurt mu?', color: '#5a6a72', weight: WEIGHT.RARE },
  { id: 'falconer_flight', icon: '🦅', title: 'Şahin Uçuşu', desc: 'Kale avlusunda bir doğancı, kolundaki şahini gün ışığında gökyüzüne salıyor.', color: '#8a6a3a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'owl_watch', icon: '🦉', title: 'Baykuş Nöbeti', desc: 'Ay ışığında bir baykuş kale surlarına konuyor; nöbetçiler sessiz kanat sesini dinliyor.', color: '#6f7898', weight: WEIGHT.COMMON, timeOfDay: 'night' as const },
  { id: 'crow_flock', icon: '🐦', title: 'Karga Sürüsü', desc: 'Kale surlarının üzerinde toplanan bir karga sürüsü aniden havalanıp dağılıyor — kimileri bunu kötü bir işaret sayar.', color: '#2e2e33', weight: WEIGHT.RARE },
  { id: 'midwife_summoned', icon: '👶', title: 'Ebe Çağrısı', desc: 'Kale içinde bir ebe aceleyle bir kuleye çağrılıyor — bir doğum yaklaşıyor.', color: '#d4849a', weight: WEIGHT.UNCOMMON },
  { id: 'nightswatch_levy', icon: '🏴', title: 'Gece Nöbeti Devşirmesi', desc: 'Kara pelerinli bir devşirici kale kapısında duruyor — Duvar için gönüllü ya da mahkûm arıyor.', color: '#1c1c22', weight: WEIGHT.UNCOMMON },
  { id: 'silent_sisters_procession', icon: '🥀', title: 'Sessiz Kızkardeşler Alayı', desc: 'Kara örtülü Sessiz Kızkardeşler örtülü bir tabutu kale kapısından sessizce taşıyor — kimin cenazesi olduğunu kimse yüksek sesle sormuyor.', color: '#463a4a', weight: WEIGHT.RARE },
  { id: 'hedge_knight_arrival', icon: '🛡️', title: 'Gezgin Şövalye', desc: 'Zırhı hırpalanmış bir gezgin şövalye kale kapısında dizginlerini çekiyor — bir efendiye hizmet mi arıyor, yoksa sadece bir gecelik yatak mı istiyor?', color: '#6a7a8a', weight: WEIGHT.UNCOMMON },
  { id: 'wedding_procession', icon: '💍', title: 'Düğün Alayı', desc: 'Kale kapısından çiçeklerle süslenmiş bir düğün alayı geçiyor — gelinin ve damadın pelerinlerinde iki farklı evin renkleri bir arada taşınıyor.', color: '#c86a9a', weight: WEIGHT.UNCOMMON },
  { id: 'ward_hostage_arrival', icon: '🧒', title: 'Vesayet Genci', desc: 'Soylu bir ailenin genç oğlu, kendi evinin sadakatini garanti altına almak için başka bir evin vesayetine gönderiliyor — fiilen bir rehine olarak. Atının yanında yürüyen muhafızlar dışında kimse tek kelime etmiyor.', color: '#7a9a6a', weight: WEIGHT.UNCOMMON },
  { id: 'night_signal_fire', icon: '🔥', title: 'Gece İşaret Ateşi', desc: 'Karanlıkta uzak bir gözetleme kulesinde tek bir işaret ateşi yanıyor — dostlara çağrı mı, yoksa yaklaşan bir tehlikenin haberi mi?', color: '#d05a32', weight: WEIGHT.UNCOMMON, timeOfDay: 'night' as const },
  { id: 'court_petitioners', icon: '📜', title: 'Dilekçe Kuyruğu', desc: 'Gün ışığında köylüler ve küçük toprak sahipleri kale kapısında sıraya girmiş; herkes derdini lordun görevlilerine anlatmak için bekliyor.', color: '#9a7a52', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'wandering_healer', icon: '🌿', title: 'Gezgin Şifacı', desc: 'Omzunda ot demetleri taşıyan gezgin bir şifacı kale yolunda durup yaralara merhem, ateşe çay ve uykusuzluğa kök sattığını söylüyor.', color: '#5f8a58', weight: WEIGHT.UNCOMMON },
  { id: 'torch_patrol', icon: '🔥', title: 'Meşaleli Devriye', desc: 'Karanlık bastığında kale dış yolunda meşaleli bir devriye ağır adımlarla ilerliyor; zırhların metal sesi gecede kısa kısa yankılanıyor.', color: '#b86a3c', weight: WEIGHT.COMMON, timeOfDay: 'night' as const },
  { id: 'herald_proclamation', icon: '📣', title: 'Meydan Fermanı', desc: 'Gün ışığında bir haberci kale meydanında tomarını açıp lordun yeni fermanını yüksek sesle okuyor; kalabalık her cümleden sonra birbirine bakıyor.', color: '#b8924a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'broken_banner_found', icon: '🚩', title: 'Yırtık Sancak', desc: 'Kale yolunun kenarında çamura bulanmış, arması seçilemeyen yırtık bir sancak bulundu — yakınlarda bir çatışma yaşanmış olabilir.', color: '#6f4a45', weight: WEIGHT.RARE },
  { id: 'mummer_troupe', icon: '🎭', title: 'Gezgin Soytarılar', desc: 'Rengarenk kıyafetler giymiş bir soytarı topluluğu kale avlusunda kısa bir oyun sahneliyor; çocuklar gülüşürken yaşlılar başını sallıyor.', color: '#a0509a', weight: WEIGHT.UNCOMMON },
  { id: 'shepherd_flock', icon: '🐑', title: 'Çoban Sürüsü', desc: 'Gün ışığında bir çoban, meleyen koyun sürüsünü kale yolunun kenarından otlağa doğru sürüyor.', color: '#8a9a6a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'stargazing_maester', icon: '🔭', title: 'Yıldız Gözlemi', desc: 'Gece yarısına yakın, kale kulesinde bir maester bakır bir aletle gökyüzünü inceliyor; kayıtlarına usulca bir şeyler not düşüyor.', color: '#3a5a7a', weight: WEIGHT.RARE, timeOfDay: 'night' as const },
  { id: 'sealed_courier', icon: '✉️', title: 'Mühürlü Haberci', desc: 'Toz içindeki bir haberci kale kapısında atından inip balmumuyla mühürlenmiş bir tomar uzatıyor; üzerindeki arma uzaktan seçilemiyor.', color: '#8a5d45', weight: WEIGHT.UNCOMMON },
  { id: 'training_yard_drill', icon: '🛡️', title: 'Avlu Talimi', desc: 'Gün ışığında kale avlusunda askerler kalkan ve tahta kılıçlarla sıra talimi yapıyor; komut sesleri taş duvarlarda yankılanıyor.', color: '#7f6f58', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'graveyard_vigil', icon: '🕯️', title: 'Mezarlık Nöbeti', desc: 'Gece karanlığında kale dışındaki mezarlıkta tek bir mum yanıyor; pelerinli bir siluet eski bir mezarın başında sessizce bekliyor.', color: '#57506f', weight: WEIGHT.RARE, timeOfDay: 'night' as const },
  { id: 'godswood_pilgrimage', icon: '🌳', title: 'Tanrı Ormanı Hac Yürüyüşü', desc: 'Gün ışığında bir grup hacı, kızıl yapraklı bir yüce ağacın önünde dua etmek için tanrı ormanına doğru sessizce yürüyor.', color: '#6a8a4a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'archery_contest', icon: '🏹', title: 'Okçuluk Yarışması', desc: 'Gün ışığında kale avlusunda askerler nişan tahtalarına ok atarak birbirleriyle şakalaşıyor; her isabetli atışta kısa bir alkış yükseliyor.', color: '#a08040', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'iron_fleet_sighted', icon: '🚢', title: 'Demir Filo Göründü', desc: 'Ufukta ahtapot armalı kara yelkenli bir filo süzülüyor — Demir Adalar\'ın gemileri bu kadar güneye neden geldi?', color: '#2a3a4a', weight: WEIGHT.RARE },
  { id: 'giant_bones_rumor', icon: '🦴', title: 'Dev Kemikleri Söylentisi', desc: 'Duvar\'ın ötesinden dönen bir devriye, kar altında bir adamdan üç kat büyük kemikler bulduklarını fısıldıyor — kimse tam olarak inanmak istemiyor.', color: '#8a8a7a', weight: WEIGHT.RARE },
  { id: 'name_day_song', icon: '🎂', title: 'Ad Günü Şarkısı', desc: 'Kale avlusundan bir çocuğun ad gününü kutlayan neşeli bir şarkı ve kahkaha sesleri geliyor; aile ve hizmetliler bir araya toplanmış.', color: '#d49aa0', weight: WEIGHT.UNCOMMON },
  { id: 'earthquake_tremor', icon: '🌍', title: 'Toprak Sarsıntısı', desc: 'Ayaklarının altında toprak birkaç saniyeliğine titredi; kale duvarlarından ince bir toz bulutu süzüldü.', color: '#6b5a3a', weight: WEIGHT.RARE },
  { id: 'plague_rumor', icon: '🩹', title: 'Veba Söylentisi', desc: 'Güneyden gelen bir tüccar, komşu bir limanda gizlenen bir salgın söylentisinden bahsediyor — kapılar bir süreliğine daha dikkatli açılacak.', color: '#5a6f4a', weight: WEIGHT.RARE },
  { id: 'duel_challenge', icon: '🤺', title: 'Düello Daveti', desc: 'İki soylu genç kale avlusunun ortasında birbirine eldiven fırlattı — onur meselesi derler, ama kimse gerçek nedeni söylemiyor.', color: '#8a3a3a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'counterfeit_coin', icon: '🪙', title: 'Sahte Sikke', desc: 'Pazarda bir tüccar aldığı gümüş sikkeyi ışığa tutup kaşlarını çattı — kenarı hafifçe pürüzlü, ağırlığı biraz eksik.', color: '#9a8a4a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'orphan_found', icon: '🧸', title: 'Bulunmuş Yetim', desc: 'Kale kapısının önünde battaniyeye sarılı bir bebek bulundu; üzerinde hiçbir arma ya da not yok, sadece küçük bir gümüş yüzük.', color: '#c8a0a8', weight: WEIGHT.RARE },
  { id: 'masked_ball', icon: '🎉', title: 'Maskeli Balo', desc: 'Kale büyük salonunda maskeli bir balo düzenleniyor; kimliğini gizleyen misafirler arasında kimin kim olduğunu kestirmek güçleşiyor.', color: '#a85ac0', weight: WEIGHT.UNCOMMON, timeOfDay: 'night' as const },
  { id: 'bounty_poster', icon: '📋', title: 'Ödül İlanı', desc: 'Kale kapısına yeni bir ödül ilanı çivilendi — aranan kişinin çizimi belirsiz, ama ödül miktarı dikkat çekici.', color: '#7a5a3a', weight: WEIGHT.UNCOMMON },
  { id: 'well_run_dry', icon: '💧', title: 'Kuyu Kuruması', desc: 'Köyün eski kuyusu bu sabah kuru çıktı; yaşlılar bunu geçen kışın kuraklığına, gençler ise başka bir şeye yoruyor.', color: '#7a8a9a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'wine_shipment', icon: '🍷', title: 'Şarap Sevkiyatı', desc: 'Güneyden gelen fıçı dolusu şarap kale mahzenine indiriliyor; taşıyıcıların yorgun yüzünde uzun bir yolculuğun izleri var.', color: '#7a2a3a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'banned_book', icon: '📕', title: 'Yasak Kitap', desc: 'Bir maester çırağı, kütüphanenin en alt rafında kimsenin okumaması gereken eski bir cilt buldu — hemen geri koydu, ama merakı geri koyamadı.', color: '#4a3a2a', weight: WEIGHT.RARE },
  { id: 'exiled_lord', icon: '🚪', title: 'Sürgün Lord', desc: 'Bir zamanlar kendi toprağı olan yaşlı bir lord, tek bir hizmetkârla kale kapısına geldi — artık hiçbir yerin efendisi değil.', color: '#5a5a6a', weight: WEIGHT.RARE },
  { id: 'thief_caught', icon: '✋', title: 'Hırsız Yakalandı', desc: 'Pazar yerinde bir cep hırsızı suçüstü yakalandı; kalabalık etrafını sararken nöbetçiler onu güçlükle çekip çıkardı.', color: '#8a7a3a', weight: WEIGHT.COMMON, timeOfDay: 'day' as const },
  { id: 'new_moon_rite', icon: '🌘', title: 'Yeni Ay Ayini', desc: 'Eski tanrılara inananlar yeni ayın karanlığında sessiz bir ayin için ormana doğru yürüyor; hiçbiri geri dönene kadar tek kelime etmeyecek.', color: '#2a2a3a', weight: WEIGHT.RARE, timeOfDay: 'night' as const },
  { id: 'shipwreck_survivor', icon: '🛟', title: 'Gemi Kazası Kurtulanı', desc: 'Kıyıya vuran bir denizci, batan geminin tek hayatta kalanı olduğunu söylüyor — hikâyesi anlatıldıkça değişiyor.', color: '#2a5a6a', weight: WEIGHT.RARE },
  { id: 'blood_moon', icon: '🔴', title: 'Kızıl Ay', desc: 'Ay bu gece kan kırmızısına bürünmüş — bazı yaşlılar bunu sıradan bir gölge oyunu, bazıları bir uyarı sayıyor.', color: '#8a1a1a', weight: WEIGHT.RARE, timeOfDay: 'night' as const },
  { id: 'merchant_scandal', icon: '💰', title: 'Tüccar Skandalı', desc: 'Zengin bir tüccarın tartıda hile yaptığı ortaya çıktı; malları pazardan toplatılırken adı bir süre daha ağızdan ağıza dolaşacak.', color: '#9a7a2a', weight: WEIGHT.UNCOMMON, timeOfDay: 'day' as const },
  { id: 'drought_warning', icon: '🌵', title: 'Kuraklık Uyarısı', desc: 'Bu yılki hasat geçen yıla göre zayıf kaldı; maester ambarları sayarken kaşlarını çatıyor, kışın nasıl geçeceğini kimse söylemiyor.', color: '#a89050', weight: WEIGHT.UNCOMMON },
  { id: 'old_map_found', icon: '🗺️', title: 'Eski Harita Bulundu', desc: 'Eski bir sandıkta yıpranmış bir harita ortaya çıktı; üzerindeki sınırlar artık hiçbir krallığın bugünküyle uyuşmıyor.', color: '#8a6a3a', weight: WEIGHT.RARE },
  { id: 'giant_eagle_sighting', icon: '🦅', title: 'Dev Kartal Görüldü', desc: 'Dağların üzerinde olağandışı büyüklükte bir kartal süzülürken görüldü; nöbetçiler bir süre gözlerini gökten ayıramadı.', color: '#5a4a3a', weight: WEIGHT.RARE, timeOfDay: 'day' as const },
  { id: 'frozen_river_crossing', icon: '🧊', title: 'Donmuş Nehir Geçişi', desc: 'Bu kış nehir o kadar sert dondu ki köylüler üzerinden yürüyerek karşıya geçiyor; herkes buzun ne zaman çatlayacağını merak ediyor.', color: '#6a9ab0', weight: WEIGHT.UNCOMMON },
] as const satisfies readonly WorldEventDefinition[]);

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeNightFactor(nightFactor: number | undefined): number | null | undefined {
  if (nightFactor === undefined) return undefined;
  if (!Number.isFinite(nightFactor)) return null;
  return Math.min(1, Math.max(0, nightFactor));
}

function isEligible(event: WorldEventDefinition, nightFactor: number | null | undefined): boolean {
  if (event.timeOfDay === undefined || nightFactor === undefined) return true;
  if (nightFactor === null) return false;
  if (event.timeOfDay === 'night') return nightFactor >= NIGHT_THRESHOLD;
  return nightFactor <= DAY_THRESHOLD;
}

function eligibleEventPool(nightFactor: number | undefined): readonly WorldEventDefinition[] {
  const normalized = normalizeNightFactor(nightFactor);
  const eligible = WORLD_EVENTS.filter((event) => isEligible(event, normalized));
  return eligible.length > 0 ? eligible : WORLD_EVENTS;
}

function pickWeightedEvent(random: () => number, nightFactor: number | undefined): WorldEventDefinition {
  const pool = eligibleEventPool(nightFactor);
  const totalWeight = pool.reduce((sum, event) => sum + event.weight, 0);
  let remaining = random() * totalWeight;
  for (const event of pool) {
    remaining -= event.weight;
    if (remaining < 0) return event;
  }
  return pool[pool.length - 1] ?? WORLD_EVENTS[0];
}

function avoidImmediateRepeat(
  picked: WorldEventDefinition,
  lastEventId: string | null,
  nightFactor: number | undefined,
): WorldEventDefinition {
  if (!lastEventId || picked.id !== lastEventId) return picked;
  const pool = eligibleEventPool(nightFactor);
  const index = pool.findIndex((event) => event.id === picked.id);
  if (index < 0) return picked;
  for (let offset = 1; offset < pool.length; offset += 1) {
    const candidate = pool[(index + offset) % pool.length];
    if (candidate && candidate.id !== lastEventId) return candidate;
  }
  return picked;
}

export const MIN_INTERVAL_SECONDS = 45;
export const MAX_INTERVAL_SECONDS = 90;
export const MAX_WORLD_EVENT_STEP_SECONDS = 1;

export interface WorldEventRuntimeOptions {
  readonly eventsBus: { readonly emit: (eventName: string, payload: WorldEventPayload) => unknown };
  readonly seed: number;
  readonly eventName: string;
}

export function createWorldEventSystem({ eventsBus, seed, eventName }: WorldEventRuntimeOptions): WorldEventSystem {
  const random = mulberry32(seed);
  let secondsUntilNext = MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
  let disposed = false;
  let lastEventId: string | null = null;

  const update = (deltaSeconds: number, nightFactor?: number): void => {
    if (disposed) return;
    const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds > 0
      ? Math.min(deltaSeconds, MAX_WORLD_EVENT_STEP_SECONDS)
      : 0;
    secondsUntilNext -= safeDelta;
    if (secondsUntilNext > 0) return;
    secondsUntilNext += MIN_INTERVAL_SECONDS + random() * (MAX_INTERVAL_SECONDS - MIN_INTERVAL_SECONDS);
    const weighted = pickWeightedEvent(random, nightFactor);
    const picked = avoidImmediateRepeat(weighted, lastEventId, nightFactor);
    lastEventId = picked.id;
    eventsBus.emit(eventName, Object.freeze({ ...picked }));
  };

  const dispose = (): void => {
    disposed = true;
  };

  return Object.freeze({ update, dispose });
}
