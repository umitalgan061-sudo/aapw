# Terrain Polish Log

## Çalıştırma Geçmişi

### Iteration #1 — 2026-08-11 16:21 TRT
**Seçilen iyileştirme:** Başlangıç çim/toprak/kaya/kar katmanlarında eksik normal+roughness PBR kanalını tamamlamak.
**Neden bu seçildi:** Mevcut bootstrap dört albedo/bump katmanı oluşturuyor ancak normal/roughness slotlarını boş bırakıyordu. HTerrain `simple4.gdshader` bu kanalları doğrudan yüzey normal ve roughness hesabında kullanıyor; bu nedenle düşük açılı ışıkta plastik/parlak zemin hissini azaltan, izole ve geri alınabilir bir kalite kazanımı.
**Yapılan değişiklikler:** Dört küçük starter normal+roughness texture eklendi. Bootstrap yalnız boş `TYPE_NORMAL_ROUGHNESS` slotlarını dolduracak şekilde additive-only genişletildi; owner tarafından eklenmiş gerçek PBR texture hiçbir zaman üzerine yazılmıyor. Ayrı headless doğrulama scripti eklendi.
**Test sonucu:** Run269 CI; Godot 4.6.3 import/editor + mevcut HTerrain doğrulaması + yeni PBR completeness doğrulaması + PWA/perf/determinism/world-safety/full smoke zinciri ile doğrulanacak.
**Gözlem:** En belirgin hedef parlak/plastik starter yüzeyleri malzeme türüne göre daha mat hale getirmek; geometri, heightmap, collision, grass seed ve web runtime davranışı değişmiyor.
**Risk / Geri alma notu:** Düşük risk. Yalnız starter slotları ve yalnız eksik normal/roughness kanalları etkilenir; eklenen dosyalar/append blok geri alınarak tamamen sökülebilir.
**Bir sonraki çalıştırma için öneri:** CI ve görsel kanıt sonrası yamaç UV gerilmesi görünürse, owner-authored texture’ları ezmeden yalnız kaya slotu için triplanar adayını değerlendirmek.

## Başarılı İyileştirmeler

- Iteration #1 sonucu CI PASS olduğunda bu bölümde başarılı olarak kabul edilir.

## Denenip Geri Alınanlar

- Yok.

## Sıradaki Öncelikli Adaylar

- Kaya/uçurum katmanında kontrollü triplanar mapping.
- Starter yüzeylerde düşük frekanslı tiling kırıcı varyasyon.
- Grass detail clustering yoğunluğunun görsel ölçümü.

## Bilinen Sorunlar / Riskler

- Starter normal haritalar düz normaldir; Iteration #1’in esas görsel kazanımı roughness ayrımıdır. Gerçek materyal normal detayları owner/proje texture’larıyla daha sonra eklenmelidir.
- Triplanar ve anti-tiling shader yolları ek texture fetch maliyeti yaratabilir; ayrı performans bütçesi olmadan etkinleştirilmemelidir.
