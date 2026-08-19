# "Tam Anlamıyla Bir Oyun" — Owner Directive

**Tarih:** 2026-08-13
**Durum:** AKTİF OWNER DİREKTİFİ — süresiz
**Yetki:** Proje sahibinin doğrudan, canlı talimatı

> "Senden tam anlamıyla bir oyun yapmanı istiyorum. Bunu kurallara ekle ve her rutininde senden tam
> anlamıyla bir oyun istediğimi düşünerek aksiyonlar al."
>
> "Assets klasöründeki her şeyi kullanmanı istiyorum. Hiçbir şeyi karantinaya alma."
>
> "Lisansı olmasa bile 3d haritaya yerleştir ve benim adıma dokuyu giydir hepsine. Giydirdiğin
> dokuyu da kendin kontrol edip üzerinde duracak mı yoksa değişecek mi diye tekrar düşünüp ona göre
> aksiyon al."

Bu dosya `GOVERNANCE.md` §33'ün tam metnidir ve Session Snapshot'ın zorunlu okuma listesindedir
(`GOVERNANCE_CONTINUATION_OVERRIDE.md` §5'in listesine ek).

## 1. Neden ayrı bir dosya

`GOVERNANCE.md` 600 satırı aşan, 33 bölümlü bir belge; oradaki tek bir bölümün her çalıştırmada
gerçekten okunacağına güvenmek yerine bu direktif kendi dosyasında duruyor — tıpkı
`GOVERNANCE_CONTINUATION_OVERRIDE.md` ve `GOVERNANCE_CONTINUOUS_OWNER_DIRECTIVE.md` gibi. Bu üç
dosya birlikte projenin "nasıl çalışılır" (süreklilik), "ne zaman durulur" (durma koşulları) ve
**"ne inşa ediliyor"** (bu dosya) sorularının kalıcı cevabıdır.

## 2. Ölçüt

Her alt görev seçiminde tek soru: **bu, projeyi oynanabilir bir oyuna yaklaştırıyor mu?**

Bir çalıştırma bittiğinde "oyuncu ne fark etti?" sorusuna somut bir cevap yazılamıyorsa, öncelik
seçimi yanlış yapılmıştır. Doğrulama-yalnızca (verification-only) çalıştırmalar, shadow/adapter
katmanları ve yalnız `canonical-dev.html` önizlemesinde kalan görsel işler artık **varsayılan
öncelik değildir**; ancak gerçek bir oyun özelliğini bloke ediyorlarsa öne alınır.

## 3. Oyunun eksikleri = açık iş listesi

Bugün itibarıyla bu proje teknik olarak zengin bir **dünya gezme demosu**dur, oyun değildir. Eksik
olanlar (§33.2 ile aynı liste, burada gerekçeli):

| # | Eksik | Bugünkü durum |
|---|-------|----------------|
| 1 | Amaç / görev (quest) sistemi | Yok. Oyuncunun yapması gereken hiçbir şey yok. |
| 2 | Kayıt / yükleme (`SaveSystem`) | Yok. Sekme kapanınca her şey sıfırlanır. |
| 3 | Envanter / eşya / ekonomi | Yok. |
| 4 | Oyuncunun kendi saldırısı | Yok — yalnız ejderha oyuncuya vurabiliyor, tersi yok. |
| 5 | Dolu yerleşim (ev/ahır/çit/kalabalık) | Kale var, kasaba yok. |
| 6 | Ses (müzik + efekt) | **Kısmen başladı (Run 346, genişledi Run 347).** `audio/audioManager.js` + tek bir CC0 UI tık sesi (`assets/audio/ui-click.wav`, Kenney) — duraklatma menüsü açılış/kapanışında çalıyor. **Run 347: sesi kapat/aç kontrolü eklendi** (`ui/pauseMenu.js`'nin Ayarlar sekmesinde, hem masaüstü hem mobilde görünen bir onay kutusu; canlı uygulanıyor, sayfa yeniden yüklemesi gerektirmiyor). Hâlâ yok: müzik, savaş/adım/ortam efekti, hacim kaydırıcısı (yalnız aç/kapa) — tek ses efektine oranla henüz gereksiz görülen bir sonraki dilim. |
| 7 | Menü / duraklat / ayarlar akışı | Duraklatma (Run 339, ADR-0285) ve grafik-kalitesi ayar ekranı (Run 341, ADR-0289 — `ui/pauseMenu.js`'nin "Ayarlar" sekmesi, masaüstünde 4 seçenekli kalite seçici, kayıt+yeniden-yükleme ile uygulanıyor) var. **Run 347: aynı sekmeye ses aç/kapa onay kutusu eklendi** (madde 6). Hacim kaydırıcısı/müzik ayarı hâlâ yok (kapsam dışı, unutulmadı). |

Bu liste FAZ tablosunun yerine geçmez; onun **üstünde** bir ürün ölçütüdür. FAZ 0-10 teknik olarak
bitse bile yukarıdakiler olmadan proje "tam anlamıyla oyun" sayılmaz.

## 4. Asset politikası — karantina feshedildi

`assets/` altındaki her dosya runtime kullanımı için sahip tarafından onaylıdır. Bir asset'i
provenance belirsizliği gerekçesiyle kullanım dışı bırakmak (karantina) artık yapılmaz;
`assets_manifest.quarantine.json` bu direktifle feshedilmiştir (run 330).

Kayıt tutma yükümlülüğü sürüyor: `CREDITS.md` + `assets_manifest.json` bilinen kaynak/lisansı
kaydeder, bilinmeyende `license: "UNKNOWN — owner-approved for runtime use (§33.3)"` yazılır. Kayıt
tutmak kullanımı engellemez.

**Değişmeyen tek kısıt:** gerçek HBO görsel/ses materyali indirilmez.

**Dürüst risk notu (kural değil, kayıt):** repository 2026-08-10'da public yapıldı. Kaynağı
belirsiz bir asset'i public bir repoda dağıtmak, private repoda kullanmaktan farklı bir hukuki
maruziyettir — özellikle `Meshy_AI_*` dosyaları dışındaki, yükleyeni/lisansı hiç kayıtlı olmayanlar
için. Sahip bunu bilerek karar verdi. Ajan bu kararı her çalıştırmada yeniden sorgulamaz; bu satır
yalnız tarihsel kayıt olarak durur. Sahip ileride repoyu private'a döndürmek isterse bu risk
kendiliğinden daralır.

## 5. Doku (texture) giydirme standardı

Sahip özellikle şunu istedi: doku giydirdikten sonra **kendi kendine bakıp değerlendir** — "üzerinde
duracak mı yoksa değişecek mi" diye tekrar düşün ve ona göre aksiyon al.

Bu, `GOVERNANCE.md` §8.5'in Görsel Doğrulama Standardı'nı bir adım ileri taşır: ekran görüntüsü
almak yeterli değildir, **görüntüye bakıp yargı vermek** ve gerekirse aynı çalıştırma içinde
malzemeyi revize etmek gerekir. Bir doku "teknik olarak uygulandı" ama gözle bakıldığında yanlış
ölçekte/renkte/parlaklıkta duruyorsa, o alt görev DONE değildir.
