# CATCH_UP.md — Oyunda Yeni Ne Var?

Bu dosya, GOVERNANCE.md §13'ün "İnsan Yakalama Özeti" kuralı gereği her ~10 çalıştırmada bir
güncellenir: jargonsuz, 5-10 cümlelik, "aylarca uzak kaldıktan sonra döndüğünde hızlıca ne olduğunu
anlarsın" özeti. **En yeni giriş en üstte.**

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
