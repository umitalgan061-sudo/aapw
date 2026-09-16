# Runtime Modernization Checklist

Bu checklist, yeni runtime katmanının mevcut AAPW gameplay sistemlerine güvenli biçimde bağlanması içindir.

## Bootstrap

- [ ] Platform probe bir kez başlatılır ve sonucu dependency olarak geçirilir.
- [ ] Runtime facade tek lifecycle owner olarak composition root'a eklenir.
- [ ] Existing player/gameplay owner'ları `simulate` hook'unda kalır.
- [ ] Existing renderer owner'ları `present` hook'unda kalır.
- [ ] Browser lifecycle hook'u yalnızca composition seviyesinde bağlanır.

## Simulation

- [ ] Fixed-step tick süresi açıkça seçilir.
- [ ] Catch-up limiti production profilinde doğrulanır.
- [ ] Spiral guard telemetry dashboard'a bağlanır.
- [ ] Resume sonrası eski wall-clock farkı simulation'a yazılmaz.
- [ ] Replay testleri aynı input/tick dizisi ile tekrar edilebilir.

## Input

- [ ] Keyboard adapter semantic command üretir.
- [ ] Pointer/touch adapter raw DOM event'i player'a taşımaz.
- [ ] Gamepad analog değerleri deadzone'dan geçer.
- [ ] Press/release edge'leri tick ile ilişkilendirilir.
- [ ] Input remap kalıcı ayar olarak ayrı saklanır.

## Performance

- [ ] Adaptive quality için minimum dwell süresi belirlenir.
- [ ] Reduced-motion sinyali presentation owner'a aktarılır.
- [ ] Data-saver düşük öncelikli streaming'i azaltır.
- [ ] Asset residency limiti gerçek cihaz profilinde ayarlanır.
- [ ] Critical asset'ler pin edilir.
- [ ] Eviction planını asset owner uygular; cache dispose etmez.

## Persistence

- [ ] Mevcut save formatına schemaVersion eklenir.
- [ ] Migration her sürüm geçişi için ayrı test edilir.
- [ ] Checksum bozukluğu telemetry'ye yazılır.
- [ ] Save sonrası read-back verification aktif olur.
- [ ] Server authoritative progression için client checksum güvenlik mekanizması olarak kullanılmaz.

## Observability

- [ ] Frame p95/p99 izlenir.
- [ ] Simulation ve presentation bütçeleri ayrı raporlanır.
- [ ] Quality tier değişimleri sayılır.
- [ ] Scheduler spiral guard sayılır.
- [ ] Recovery intent'leri sınıflandırılır.
- [ ] Telemetry payload budget'ı production config'de korunur.

## Recovery

- [ ] Renderer context loss için soft recovery callback'i vardır.
- [ ] Tekrarlanan başarısızlıklar hard/terminal recovery seviyesine çıkabilir.
- [ ] Persistence failure mevcut session state'i sessizce silmez.
- [ ] Memory pressure unpinned asset planına bağlanır.
- [ ] Recovery sonrası yeni frame baseline alınır.

## CI

- [ ] Runtime JS syntax kontrolü çalışır.
- [ ] Core acceptance suite çalışır.
- [ ] Extended acceptance suite çalışır.
- [ ] Aynı suite iki kez çalıştırılıp JSON çıktısı karşılaştırılır.
- [ ] Ownership scan renderer/timer/storage bypass'larını reddeder.
- [ ] Gerçek geliştirme turu için meaningful additions > 4.000 kabul kapısı korunur.

## Production readiness sinyalleri

Aşağıdaki koşullar sağlandığında runtime katmanı entegre edilmeye hazır kabul edilir:

```text
syntax                PASS
acceptance             PASS
determinism            PASS
ownership              PASS
recovery               PASS
persistence integrity PASS
memory bound           PASS
observability          PASS
```

Bu liste teknik bir entegrasyon kılavuzudur; ürün içindeki gameplay sahiplik sınırlarının yerine geçmez.
