# CATCH_UP.md — Oyunda Yeni Ne Var?

Bu dosya, GOVERNANCE.md §13'ün "İnsan Yakalama Özeti" kuralı gereği her ~10 çalıştırmada bir
güncellenir: jargonsuz, 5-10 cümlelik, "aylarca uzak kaldıktan sonra döndüğünde hızlıca ne olduğunu
anlarsın" özeti. **En yeni giriş en üstte.**

---

## Run 68 itibarıyla (2026-08-05)

Run 59'dan bu yana en büyük değişiklik ejderha: artık sadece kalesinin üstünde daire çizip seni fark
etmekle kalmıyor, gerçekten avlıyor. Yaklaştığında önce daha hızlı ve daha keskin dönmeye başlıyor,
sonra üstüne doğru dalış yapıyor, ve en sonunda kalesini tamamen terk edip peşine düşüyor — koşarak
kaçamazsın, çünkü senden hızlı; ancak 18 saniye dayanırsan vazgeçip evine dönüyor. Henüz sana zarar
vermiyor: oyunda hâlâ can/hasar diye bir şey yok ve bunun eklenip eklenmeyeceği sana sorulmuş bir
soru (bkz. `QUESTIONS_FOR_OWNER.md`) — yani ejderha korkutuyor ama öldürmüyor. Haritada gerçek,
dokulu kale sayısı 7'den 8'e çıktı (İkizler'e, ahşap köprülü kapı kulesi olan bir kale kondu). Oyun
artık internetsiz de düzgün açılıyor: daha önce çevrimdışı önbelleğe alınan dosya listesi eksikti,
tamamlandı, ve telefonun oyuna ne kadar yer ayırdığını F2 panelinden görebiliyorsun. Telefonda
NPC'lerle konuşmak için artık klavye gerekmiyor, ekrandaki "konuş" uyarısına dokunman yeterli.
Perde arkasında ise otomatik test sayısı 15'ten 18'e çıktı ve testlerin kendisi de artık denetleniyor
— yani ileride biri yanlışlıkla bir testi silerse fark edilecek, sessizce geçmeyecek. Son olarak bir
güvenlik notu: repoya yanlışlıkla girmiş bir API anahtarı bulundu ve dosyalardan temizlendi, ama o
anahtarı NVIDIA tarafında iptal etmen gerekiyor — bunu senden başkası yapamaz.

---

## Run 59 itibarıyla (2026-07-31)

Bu, bu dosyanın ilk girdisi — proje aslında 58 çalıştırma boyunca büyümüş, ama kimse ara sıra
"özetle" demediği için bu özet dosyası hiç oluşturulmamıştı. Aşağıdaki, o birikimin bugünkü
fotoğrafı:

3D Westeros haritası artık gerçekten bir dünyaya benziyor: küçük tepeler ve büyük dağlar var, zemin
düzgün yeşil/çim renginde (önceden kahverengi/turuncu görünüyordu), 14 krallık koltuğunun 7'sinde
gerçek, dokulu kale modelleri duruyor, ve bu kaleleri birbirine bağlayan ~20 km'lik bir yol ağı var
(eğime duyarlı, dağın dik yamacından düz geçmiyor). 14 NPC haritada devriye geziyor, isim etiketleri
var, ve E tuşuyla konuşulabiliyor — 13'ünde artık basit bir seçmeli diyalog da var (soru sorup farklı
cevap alabiliyorsun). Kurtlar sürü hâlinde kaçıyor, birbirini uyarıyor. Bir ejderha (Ümit'in
kalesinin üstünde) gökyüzünde daire çiziyor; oyuncu yaklaşınca artık fark ediyor ve daha hızlı/daha
keskin bantlı uçmaya başlıyor (henüz kovalamıyor/dalış yapmıyor — bu bir sonraki adım). Oyunun
gündüz/gece döngüsü, sis, yıldızlar, göller ve şelaleler zaten çalışıyor. Her çalıştırmada otomatik
bir "duman testi" (15 kontrol) çalışıyor ve hepsi geçiyor — yani mevcut özellikler bozulmadan
korunuyor. Şu an açık kalan en büyük boşluklar: at/araba/köpek-kedi/kuş gibi hayvanlar (bunlar
manuel asset indirmesi gerektiriyor, otomatik yapılamıyor — bkz. `QUESTIONS_FOR_OWNER.md`) ve
ejderhanın gerçek bir tehdit gibi davranması (şu an sadece uçuşu değişiyor, saldırmıyor).

---
