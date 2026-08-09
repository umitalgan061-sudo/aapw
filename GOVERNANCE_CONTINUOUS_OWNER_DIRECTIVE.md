# Continuous Autonomous Development — Owner Directive

**Status:** ACTIVE OWNER DIRECTIVE — 2026-08-09

Bu dosya proje sahibinin doğrudan kararıdır ve `GOVERNANCE.md` içindeki aşağıdaki eski kuralları, çeliştikleri ölçüde **supersede eder**:

- `§8.7 Çalışma Süresi Sınırları` bütünüyle yürürlükten kalkmıştır.
- `§19 Çalıştırma İçinde Zincirleme` bölümündeki çalışma süresi tavanı, alt-görev sayısı tavanı ve çalıştırmayı yalnız bu limitlere ulaşıldığı için sonlandıran hükümler yürürlükten kalkmıştır.

## 1. Süre sınırı yok

Otonom geliştirme için keyfî bir 90 dakika/dosya, 6-8 saat/çalıştırma, toplam alt-görev sayısı veya benzeri çalışma süresi tavanı uygulanmaz. Bir iş yalnızca uzun sürdüğü için bırakılmaz ve bir çalıştırma yalnızca süre dolduğu için sonlandırılmaz.

Eski `1200 satır / 25 dosya` gibi run-level büyüklük değerleri de çalıştırmayı durdurma gerekçesi değildir. Değişiklikler yine inceleme ve geri alma kolaylığı için küçük, atomik ve doğrulanabilir commit/alt-görevlere bölünür; fakat bir alt görev tamamlanınca bu bütçeler gerekçe gösterilerek oturum bitirilmez.

## 2. Otomatik “Devam et” kuralı

Bir alt görev tamamlanır, güvenli biçimde geri alınır veya gerçek bir blocker nedeniyle o alt görevde ilerleme mümkün olmaz olmaz ajan **kullanıcının `Devam et` yazmasını beklemez**. Aynı çalıştırma içinde kendisine `Devam et` komutu verilmiş gibi davranır:

1. remote `main` yeniden kontrol edilir ve eşzamanlılık kuralı uygulanır;
2. en güncel `GOVERNANCE.md`, bu owner directive, `3D_GAME_PROGRESS.md`, son commit/ADR ve `QUESTIONS_FOR_OWNER.md` bağlamına göre sıradaki güvenli ve anlamlı alt görev seçilir;
3. yeni alt görev doğrudan başlatılır;
4. alt görev bitince aynı döngü yeniden uygulanır.

Bu zincir kullanıcıdan yeni bir mesaj gelmesini gerektirmez. Bir alt görevin sonunda özet üretmek de kendi başına çalışmayı durdurma nedeni değildir.

## 3. Gerçek durma koşulları

“Sürekli devam” kalite ve güvenlik kapılarını kaldırmaz. Ajan yalnız aşağıdaki gerçek koşullarda mevcut çalışma zincirini durdurabilir veya checkpoint bırakabilir:

- çözülemeyen ve owner kararı gerektiren bir ürün/tasarım kararı;
- güvenlik, veri kaybı, secret veya geri döndürülemez işlem riski;
- `GOVERNANCE.md` DoD/additive-only/eşzamanlılık kapısının güvenli ilerlemeyi gerçekten engellemesi;
- aynı hatanın tekrarlanması sonrası RCA yapılmasına rağmen güvenli çözüm bulunamaması;
- başka bir eşzamanlı oturumun aynı işi daha güncel/doğrulanmış biçimde yayınlamış olması;
- çalışma ortamının, aracın veya platform oturumunun teknik olarak sona ermesi;
- gerçekten güvenli ve anlamlı hiçbir açık alt görev kalmaması.

Bir alt görev bloke oldu diye bütün proje geliştirmesi durmaz; owner kararı gerektirmeyen başka güvenli iş varsa ona geçilir.

## 4. DoD ve yayın disiplini aynen korunur

Süresiz/otomatik devam, `DONE` standardını gevşetmez. Her yayınlanacak alt görev kendi gerekli `node --check`, smoke/regresyon, console, performans, PWA/cache, determinism, additive-only, visual proof, progress/ADR/perf/checkpoint ve concurrency kapılarını geçmeden DONE veya merge sayılmaz.

Bir doğrulama altyapısı geçici olarak bozuksa doğrulanmamış kod `main`e zorla alınmaz; mümkünse doğrulama altyapısından bağımsız güvenli hazırlık/başka alt görev yapılır ve geliştirme zinciri devam eder.

## 5. Oturumlar arası devam

Çalışma ortamı teknik olarak sonlandığında ajan açık checkpoint, branch/head, blocker ve sıradaki güvenli adımı bırakır. Bir sonraki otomatik çalıştırma bu kayıtlardan devam eder; tamamlanmış işi gereksiz yere yeniden yapmaz.

ChatGPT görev altyapısının desteklediği otomatik yeniden çağırma frekansı saatlik ise, oturumlar arası en sık desteklenen tekrar saatlik kullanılır. **Aktif bir çalıştırma içindeyken ise alt görevler arasında kullanıcıdan `Devam et` beklenmez.**

## 6. Öncelik

Bu owner directive ile `GOVERNANCE.md` arasında süre/çalıştırmayı sonlandırma konusunda çelişki varsa **bu dosya geçerlidir**. Diğer bütün kalıcı governance, determinism, additive-only, owner-gate, kalite ve güvenlik kuralları yürürlükte kalır.
