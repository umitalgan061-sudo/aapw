# CATCH_UP.md — Oyunda Yeni Ne Var?

Bu dosya, GOVERNANCE.md §13'ün "İnsan Yakalama Özeti" kuralı gereği her ~10 çalıştırmada bir
güncellenir: jargonsuz, 5-10 cümlelik, "aylarca uzak kaldıktan sonra döndüğünde hızlıca ne olduğunu
anlarsın" özeti. **En yeni giriş en üstte.**

---

## Run 128 itibarıyla (2026-08-07)

Son 10 çalıştırmanın (119-128) en görünür gelişmesi kale keşfi etrafında: artık bir kaleye ilk kez
vardığında bildirimde "1 / 14 yerleşim keşfedildi" gibi bir ilerleme sayacı görüyorsun, son 14.
koltuğa da vardığında kart "Tüm yerleşimler keşfedildi" yazıp hafifçe altın parlıyor, ve pusula artık
zaten gittiğin kaleyi tekrar göstermek yerine gitmediğin en yakın koltuğa yöneliyor (hepsini
gezdiysen gizleniyor). İkinci gelişme dünya olayları bildirim havuzunda: beş yeni kart eklendi — gün
ışığında bir doğancının şahin uçurması, gece kale surlarına konan bir baykuş, aniden dağılan bir
karga sürüsü, bir kuleye aceleyle çağrılan bir ebe (yaklaşan bir doğumun habercisi), ve Duvar için
gönüllü/mahkûm arayan kara pelerinli bir Gece Nöbeti devşiricisi — havuz artık 36 farklı karta çıktı.
Perde arkasında iki şey oldu: proje sahibi doğrudan repoya bir "sadece ekleme" güvenlik kontrolü ekledi
(artık hiçbir commit mevcut bir kod satırını silemez/değiştiremez, sadece yeni satır ekleyebilir —
bu artık kalıcı bir kural) ve dünya olayları listesinin bozulmadığını otomatik doğrulayan yeni bir
test eklendi. Açık kalan en büyük konular hâlâ aynı: 6 kale hâlâ dokusuz duruyor (gerçek 3D model
bekleniyor), at/araba/köpek-kedi/kuş gibi hayvanlar için model bekleniyor, ve sızmış NVIDIA API
anahtarını kendi tarafında iptal etmen hâlâ senin yapman gereken bir iş (bkz.
`QUESTIONS_FOR_OWNER.md`).

---

## Run 118 itibarıyla (2026-08-07)

Son 10 çalıştırmanın (109-118) en büyük gelişmesi: dünya artık gerçekten çıplak değil — zemine ilk
kez prosedürel ağaçlar eklendi (iki farklı silüet, sivri köknar-benzeri ve yuvarlak), ve çoğu kalenin
(masaüstünde 14'ten 12'si) çevresinde kendi başına daha yoğun bir ağaç halkası oluşuyor, böylece
kale duvarlarının hemen dışında "korunan arazi" hissi okunuyor. İkinci büyük gelişme: bir kaleye
ilk kez 55 metre içine giren oyuncu artık bunu bir bildirimle öğreniyor ve bu bilgi kalıcı olarak
hatırlanıyor (bir daha aynı kaleye gidince tekrar bildirim gelmiyor) — hem çevrimiçi hem çevrimdışı
kurulu PWA'da çalışıyor. Dünya olayları bildirim havuzu da üç yeni kart kazandı: kale kapısında bir
kiralık kılıç, sadaka dağıtan bir septon (sadece gündüz), ve ormanın kenarında bir direwolf izi.
Perde arkasında: `dragonController.js` 600 satır sınırına dayanmadan önce bölündü, performans
verisini elle karşılaştırmak yerine tek komutla min/max/ortalama gösteren bir araç eklendi, ve kural
dosyası (`GOVERNANCE.md`) iki kez gözden geçirilip güncel olduğu doğrulandı. Açık kalan en büyük
konular hâlâ aynı: 6 kale hâlâ dokusuz duruyor (gerçek 3D model bekleniyor), at/araba/köpek-kedi/kuş
gibi hayvanlar için model bekleniyor, ve sızmış NVIDIA API anahtarını kendi tarafında iptal etmen
hâlâ senin yapman gereken bir iş (bkz. `QUESTIONS_FOR_OWNER.md`).

---

## Run 108 itibarıyla (2026-08-06)

Son 10 çalıştırmanın (99-108) en görünür gelişmesi: artık oyunun her cihazında (masaüstü, mobil,
kurulu PWA) dört köşe HUD widget'ı bir arada çalışıyor — kontroller yardımı ("?" düğmesi), en yakın
kaleye pusula, oyun içi saat (gündüz/alacakaranlık/gece ikonuyla) ve can barı. Bunları eklerken
gerçek bir mobil çakışma bulundu ve kök nedeninden düzeltildi: `game3d.css` hiçbir zaman
`box-sizing` tanımlamamıştı, bu yüzden bazı widget'lar telefon ekranında kendi hesapladıklarından
daha geniş çiziliyordu — artık düzeltildi ve bir daha sessizce tekrarlanmaması için test genişletildi.
Dünya olayları havuzu da büyümeye devam etti: artık gündüz/gece × nadir-lik matrisinin her hücresinde
en az bir olay var (ör. "Pazar Günü" — sadece gündüz görülen, seyrek bir olay). Perde arkasında iki
önemli bakım işi yapıldı: `game3d.js` 600 satır sınırına dayanmadan önce bir yardımcı dosyaya
bölündü (oyuncu hiçbir şey fark etmez, sadece gelecekteki eklemelere yer açtı), ve bu çalıştırma
(108) iki geliştirici-dokümantasyon dosyasındaki büyük bir eksikliği kapattı — ejderha saldırı
sistemi, can/hasar sistemi ve yol ağı gibi gerçek, çalışan alt sistemler daha önce hiç
belgelenmemişti, artık belgeli. Açık kalan en büyük konular hâlâ aynı: 6 kale hâlâ dokusuz duruyor,
at/kuzgun/koyun gibi hayvanlar için model bekleniyor, ve sızmış NVIDIA API anahtarını kendi tarafında
iptal etmen hâlâ senin yapman gereken bir iş (bkz. `QUESTIONS_FOR_OWNER.md`).

---

## Run 98 itibarıyla (2026-08-06)

Son 10 çalıştırmanın (89-98) en büyük gelişmesi: ejderhalar artık gerçekten saldırabiliyor. Daha önce
sadece etrafta uçup dikkatini gösteriyorlardı; şimdi kışkırtılırsa (uzun süre çok yakın durursan) gerçek
hasar veren bir ısırık saldırısına geçiyorlar, oyuncunun da artık bir can barı (100/100) var — canın
biterse spawn noktasına dönüp tam iyileşerek geri geliyorsun (kayıt/ceza mekaniği yok, sadece yeniden
başlangıç). Kalelerin çevresindeki zemin artık düzgün düzleniyor — daha önce bazı kaleler engebeli
arazide havada asılı kalır/boşluk bırakırdı, artık 14 koltuğun hepsi düz bir zemine oturuyor. Diyalog
tarafında sessiz ama istikrarlı bir büyüme var: kalenin nöbetçisiyle konuşurken 3. bir soru sorabildiğin
NPC sayısı 4'ten 10'a çıktı (Baratheon, Lannister, Dorne, Qarth ve Demir Adalar nöbetçileri de artık
kendi kişisel bir cevaplarını veriyor) — dünyanın geri kalanı bu on çalıştırmada değişmedi. Perde
arkasında: platform sağlık kontrolü (npm audit/PWA kurulabilirlik/WebGL) tekrar yapıldı, hâlâ temiz;
performans günlüğü (`perf_log.csv`) düzenli birikmeye devam ediyor, 40+ satıra ulaştı. Açık kalan en
büyük konular hâlâ aynı: 6 kale hâlâ dokusuz duruyor (gerçek 3D model bekleniyor), at/kuzgun/koyun gibi
hayvanlar için model bekleniyor, ve sızmış NVIDIA API anahtarını kendi tarafında iptal etmen hâlâ senin
yapman gereken bir iş (bkz. `QUESTIONS_FOR_OWNER.md`).

---

## Run 88 itibarıyla (2026-08-06)

Son 10 çalıştırmanın (79-87) oyuncuya en çok ulaşan tarafı hâlâ küçük ama gerçek eklentiler: periyodik
"dünya haberleri" bildirim havuzu 24'ten 26 habere büyüdü, artık nadir haberler gerçekten daha seyrek
çıkıyor ve kuzey ışıkları/güneş tutulması gibi haberler artık gerçek gökyüzüyle eşleşiyor (gece
olmadan "kuzey ışıkları" haberi gelmiyor). Gece gökyüzündeki yıldızlar da artık sabit durmuyor, her
biri kendi ritminde hafifçe parlayıp sönüyor. Kendi evin olan kaledeki nöbetçiyle konuşurken artık 3.
bir soru seçeneği de var. Perde arkasında bu dönemin en önemli bulgusu: 2D oyun tamamen çevrimdışıyken
(internet yokken) açılışta çöküp ölü kalıyordu — bu bulundu ve düzeltildi, artık uçak modunda da
düzgün açılıyor (OYNAT'a bastıktan sonrasını senin telefonunda kontrol etmen isteniyor, bkz.
`QUESTIONS_FOR_OWNER.md`). Ayrıca nöbetçi/hayvan/diyalog/dünya-olayları gibi ana alt sistemlerin hepsi
artık hata yalıtımlı: biri beklenmedik şekilde patlarsa tüm oyun çökmüyor, sadece o tek alt sistem
sessizce devre dışı kalıyor. Bu çalıştırma (88) sadece bakım yaptı — büyümekte olan bir test dosyası
ikiye bölündü, kural dosyası (`GOVERNANCE.md`) ve bu özet güncellendi — oyunda görünen hiçbir şey
değişmedi. Açık kalan en büyük konular hâlâ aynı: 6 kale hâlâ dokusuz duruyor (gerçek 3D model
bekleniyor), ejderhanın gerçekten saldırıp saldıramayacağı senin kararına bağlı, at/kuzgun/koyun gibi
hayvanlar için model bekleniyor, ve bir süre önce bulunan sızmış NVIDIA API anahtarını kendi tarafında
iptal etmen hâlâ senin yapman gereken bir iş.

---

## Run 78 itibarıyla (2026-08-05)
