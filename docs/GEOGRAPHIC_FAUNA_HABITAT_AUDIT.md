# Şafak Kartalı — Fauna / Creature / Dragon Habitat Audit

## Kapsam

Bu belge mevcut fauna davranış sistemlerini yeniden yazmaz. `animalConfig.js`, `animals.js`, `creatureBrain.js`, `creatureSpawner.js`, `dragonConfig.js`, `dragonController.js` ve `livingWorldSpawner.js` davranış otoriteleri olarak kalır.

Buradaki amaç gerçek asset ile gerçek habitat arasındaki görsel uyumu tanımlamaktır.

## At

White horse kaynağı `assets/models/animals/white_horse_bEdE4rmZy9.glb` olarak mevcut yapılandırmada tanımlıdır. At için görsel yüzey sözleşmesi coat/mane/tail/hoof/saddle/harness şeklindedir.

Atlar yüksek dağ sırtında veya denizin içinde dağıtılmamalı. Grassland, cold grassland, coast, steppe ve kontrollü rocky hill çevreleri daha doğal. Settlement edge kullanılıyorsa ana yapıların içine değil, açık otlak/road-side kapalı koridorlara taşınmalı.

Minimum slope kuralı 22 derece. Water depth için 0.08 metre üzeri reddedilmeli. Settlement mesafesi mevcut habitat kuralına göre 20–180 metre bandında tutulmalı.

## Kurt

Gerçek wolf asset `assets/models/animals/wolf/Wolf-Blender-2.82a.glb`.

Kurt için fur/eye/claw/tooth yüzeyleri ayrı görsel tepki taşımalı. Aynı gri malzemeyi bütün modele basmak yüzey dilini öldürür.

Habitat olarak snow, cold grassland, mountain, rocky hills, steppe ve jungle destekleniyor. Wolf settlement core içinde görünmemeli; 180 metrenin dışına çıkması güvenli başlangıç profili.

Wolf road edge üzerinde değil, yolun karşı tarafındaki doğal geçişlerde olmalı. Sürü davranışı ayrı controller tarafından yönetilmeye devam etmeli.

## Dragon

Dragon kaynağı `assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx`. Gerçek texture ailesi ayrı dosyalar halinde tutuluyor: ground color, bump, normal ve fire particle atlas.

Dragon'ın habitatı aerial/high-relief mantığında ele alınmalı. Mountain, desert, arid ve jungle uygun başlangıç alanları. Snow da mümkün, ancak düşük irtifalı settlement merkezinde görünmemeli.

Dragon görseli scale/wing/eye/horn/claw yüzeyleri ayrışmadan kabul edilmemeli. Kanat ile gövdenin aynı matte response'a zorlanması yanlış görsel sonuç üretir.

Dragon için slope değeri yerleşim canlıları kadar kısıtlayıcı değildir; çünkü spawn yüksekliği uçuş davranışı tarafından belirlenebilir. Ancak origin/ground relation ve settlement exclusion korunmalı.

## Habitat ile navigation ayrımı

Habitat sözleşmesi navigation veya AI pathfinding değildir. Bir wolf'un rock biome içinde bulunabilmesi, onun her kaya üzerinde path bulması anlamına gelmez. Bu nedenle habitat policy yalnız görsel spawn adaylarını sınıflandırır; davranış controller'ına yeni steering kuralları eklemez.

## Asset hydration

LFS pointer'ı asset failure ile eşit değildir. CI önce selective hydrate yapmalı, sonra dosyanın gerçek binary içerik olarak çözündüğünü kontrol etmelidir.

Dragon için model dosyası tek başına yeterli değildir; yanındaki texture ailesi de hydration kapsamına alınmalıdır.

## Material contract

Fauna objesi MaterialAssignmentCore dışında giydirilmemeli. Texture'sız durumda layered fallback kullanılabilir; authored material/map varsa korunmalıdır.

## Geographic acceptance

Bir fauna adayı şu soruların tamamını cevaplayabilmeli:

- Gerçek kaynak dosyası nedir?
- Hangi biome içinde bulundu?
- Ground Y nedir?
- Su derinliği kaçtır?
- Slope kaç derecedir?
- Settlement'a uzaklığı nedir?
- Road'a uzaklığı nedir?
- Hangi material mode kullanıldı?
- Hangi texture boyutları yüklendi?
- Placeholder/missing asset oldu mu?

Bu alanlardan biri yoksa proof eksiktir.

## Sonuç

Fauna sistemi için görsel doğruluk, yalnız doğru hayvanı doğru dosyadan yüklemek değildir. Aynı hayvanın dünyadaki bağlamı da kayıt altına alınmalıdır. Bu sözleşme, sonraki wildlife/creature/dragon adapterlerinin aynı geography→asset→material→placement zincirine bağlanmasını sağlar.
