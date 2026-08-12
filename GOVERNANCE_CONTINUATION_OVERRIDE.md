# GOVERNANCE CONTINUATION OVERRIDE — Owner Direktifi

**Tarih:** 2026-08-09
**Yetki:** Proje sahibi doğrudan kararı
**Öncelik:** Bu dosya, `GOVERNANCE.md` içindeki çalışma süresi ve çalıştırma-içi zincirleme ile ilgili daha eski ve çelişen ifadeleri supersede eder. Diğer tüm güvenlik, kalite, determinism, PWA, performans, owner-gate ve eşzamanlılık kuralları yürürlükte kalır. Proje sahibinin 2026-08-12 tarihli doğrudan kararıyla additive-only zorunluluğu ayrıca kaldırılmıştır.

## 1. Çalışma süresi tavanı kaldırıldı

Bir geliştirme çalıştırması yalnızca zaman geçtiği için sonlandırılmaz. `GOVERNANCE.md` §8.7 içindeki yaklaşık 6–8 saatlik çalıştırma geneli süre tavanı artık geçerli değildir. Güvenli ve anlamlı bir sonraki alt görev bulunduğu sürece çalışma zinciri devam eder.

Dosya bazlı takılma/anti-loop yaklaşımı bir **çalışmayı sonlandırma kuralı değildir**: aynı dosya veya aynı hata verimsiz biçimde bloke ediyorsa mevcut riskli alt görev geri alınır/bırakılır ve sıradaki güvenli alt göreve geçilir.

## 2. Alt görev bitince otomatik devam

Bir alt görev doğrulama/DoD/commit açısından kendi güvenli sınırına ulaştığında kullanıcıdan ayrıca `devam et` komutu beklenmez. Ajan kendine otomatik olarak devam talimatı uygulanmış kabul eder, `main` eşzamanlılık kontrolünü tekrarlar, güncel progress/ADR/owner-gate bağlamını kontrol eder ve sıradaki güvenli, anlamlı alt görevi seçerek çalışmayı sürdürür.

`GOVERNANCE.md` §19'daki çalışma süresi tavanına bağlı zincirleme şartı bu direktifle supersede edilmiştir. 1200 satır / 25 dosya gibi yayın-birimi bütçeleri kalite ve inceleme sınırı olarak korunabilir; bu bütçeye ulaşmak projenin durduğu anlamına gelmez. Mevcut güvenli yayın birimi kapatılır ve sonraki otomatik çalıştırma kaldığı yerden devam eder.

## 3. Kalite kapısındaki “dur” semantiği

`GOVERNANCE.md` §8.6 veya başka bir kalite/güvenlik kuralı belirli bir alt görev için “dur” diyorsa bunun varsayılan anlamı **tüm geliştirme zincirini bitirmek değil, o riskli alt görevi durdurmak/geri almak ve başka güvenli işe geçmektir**. Ancak güvenli başka iş yoksa, owner kararı olmadan ilerlemek gerekiyorsa, geri alınamaz/yüksek riskli bir durum varsa veya kullanılan platform/tool hiçbir güvenli ilerleme yolu bırakmıyorsa o çalıştırma blokeli olarak sonlandırılabilir.

## 4. Süreklilik ve platform sınırı

Ajan çalışma zamanı dışında gerçekten arka planda işlem yürütüyormuş gibi davranmaz. Platform bir çalıştırmayı doğal olarak kapattığında proje “durmuş” sayılmaz; bir sonraki otomatik çalıştırma `main` ile yeniden senkronize olup Session Snapshot'ı okuyarak kaldığı yerden kendiliğinden devam eder.

## 5. Session Snapshot zorunluluğu

Bundan sonraki otomatik/otonom geliştirme çalıştırmalarında Session Snapshot sırası en az şu belgeleri kapsar:

1. `GOVERNANCE.md`
2. **`GOVERNANCE_CONTINUATION_OVERRIDE.md` (bu dosya)**
3. `3D_GAME_PROGRESS.md`
4. güncel remote `main` / son commitler
5. `DECISIONS.md` son kararlar
6. `QUESTIONS_FOR_OWNER.md`

Bu dosya kaldırılmadıkça veya proje sahibi daha yeni bir direktifle açıkça supersede etmedikçe çalışma süresi tavanı geri getirilemez ve tamamlanan alt görev sonrasında sıradaki güvenli işe otomatik geçiş varsayılandır.
