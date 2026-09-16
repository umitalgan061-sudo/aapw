# Şafak Kartalı R2 — Fauna Activity Budget

Bu katman mevcut fauna intent üreticileri arasında deterministik per-tick hesaplama bütçesi dağıtır. Actor spawn etmez, physics veya navigation yürütmez, persistence yazmaz, asset yüklemez ve event dispatch etmez.

## Girdi

Her aday species, activity kind, LOD, threat, resource need, reproduction/social/movement/migration pressure, health, energy ve son seçilme zamanı gibi gözlemleri taşır. Bozuk sayılar güvenli varsayılanlara normalize edilir.

## Öncelik

Threat sinyalleri önce gelir. Resource ve reproduction baskısı, fairness/starvation ve freshness sinyalleri ikinci katman olarak bütçeyi yönlendirir. Yakın LOD sunum önemini artırır; uzak/culled işler pahalı sunum işlerini sınırlamak için daha düşük ağırlık alır.

## Determinizm

Aynı aday seti + tick + seed aynı sıralamayı ve digest'i üretir. Global random kullanılmaz. Stable hash jitter yalnızca eşit skorların deterministik dağıtımı içindir. Girdi sırası sonucu değiştirmez.

## Bounded runtime

Adaylar 256 ile, tick bütçesi 4–96 ile, seçilen işler 96 ile sınırlandırılır. Ledger geçmişi en fazla 64 sonuç saklar. Disposal sonrası ledger yeni değerlendirmeyi reddeder.

## Regression

Acceptance runner 8 fauna species × 4 LOD × 8 activity kind × 8 threat seviyesi × 2 resource seviyesi = 4.096 üretim değerlendirmesi çalıştırır. Matrix bölümleri 0–3583 aralığındaki benzersiz vaka kimliklerini taşır; kalan kombinasyonlar evaluator tarafından doğrudan hesaplanarak kapsanır.

## Sahiplik

Ecology/encounter katmanları intent'in sahibidir. Activity budget yalnızca hangi intent hesaplarının bu tick içinde çalıştırılacağını belirler. Uygulayıcı runtime katmanı seçimi alır ve kendi authoritative state'ine uygular.
