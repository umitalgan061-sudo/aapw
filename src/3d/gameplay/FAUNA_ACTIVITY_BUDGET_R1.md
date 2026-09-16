# Şafak Kartalı R1 — Fauna Activity Budget

## Amaç

`livingWorldFaunaActivityBudget.js`, mevcut fauna ecology ve encounter katmanlarının ürettiği iş adayları arasında deterministik bir değerlendirme bütçesi dağıtır. Bu katman actor oluşturmaz, navigation/physics yürütmez, fauna state değiştirmez, asset yüklemez ve world event yayınlamaz.

## Yetki sınırı

Ecology director, encounter director ve runtime bridge kendi domain gerçeklerinin sahibi olmaya devam eder. Activity budget yalnızca o tick içinde hangi işlerin hesaplanacağına ilişkin bounded seçim üretir. Dönen paket immutable'dır; çağıran yürütme sahibi seçimi uygular.

## Öncelik modeli

Threat işlemleri güvenlik açısından yüksek ağırlık taşır. Resource/reproduction baskısı eksikliği azaltmak için skor ekler. Yakın LOD küçük bir sunum önceliği sağlar. Uzun süredir seçilmeyen adaylar starvation/fairness boost alır; ambient işler baskı altında geriye düşer. Kararlı hash jitter yalnızca eşit skorları dağıtır ve global randomness kullanmaz.

## Bounded davranış

- input candidate taraması 256 ile sınırlandırılır;
- tick bütçesi 4–96 aralığında clamp edilir;
- seçim sayısı 96'yı aşmaz;
- sonuç geçmişi ledger üzerinde en fazla 64 kayıtla sınırlandırılır;
- disposal sonrası evaluate fail-closed döner;
- sıralama score → starvation → LOD → kind → species → id tie-break sırasıyla stabil tutulur.

## Kabul kanıtı

Regression checker deterministik tekrar, input reorder invariance, malformed input, threat/resource önceliği, ledger reset/disposal ve 4.096 benzersiz corpus kimliği doğrular. Corpus 8 tür × 4 LOD × 8 activity kind × 8 threat seviyesi × 2 resource seviyesi = 4.096 test eksenini temsil eder.

Matrix dosyaları compact identity biçimindedir; her satır production contract tarafından kontrol edilen benzersiz bir acceptance vaka kimliğidir. Ayrıntılı davranış oracle'ları doğrudan production evaluator üzerinden çalıştırılır.
