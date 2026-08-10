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

## 7. GitHub Actions 2.000 dakika dolumunda public-runner fallback — Owner kararı 2026-08-10

2026-08-10 tarihinde private repository için GitHub Free hesabındaki aylık 2.000 GitHub-hosted Actions dakikası tamamen doldu ve Run216 DoD işleri `runner_id=0` / boş `steps` ile checkout başlamadan bloke oldu. Proje sahibi, geliştirme ve governance doğrulamalarının beklemeden devam edebilmesi için repository görünürlüğünü **public** yapmayı ve repository adını `westeros-pwa` yerine **`aapw`** olarak değiştirmeyi açıkça onayladı.

Bu kararın kalıcı operasyon kuralları:

1. Canonical repository kimliği aynı repo ID'sini koruyan `umitalgan061-sudo/aapw`'dir. Eski `westeros-pwa` adı yalnız geçmiş referans/redirect olarak kabul edilir; yeni commit, PR, workflow ve otomasyonlarda mümkün olduğunda `aapw` adı kullanılır.
2. Repository public kaldığı sürece standart GitHub-hosted runner'lar governance/DoD zincirini çalıştırmak için kullanılabilir. Public'e geçiş hiçbir DoD, additive-only, determinism, PWA, performans, visual-proof, console-zero veya concurrency kapısını gevşetmez.
3. `aapw` adına geçiş **güvenlik veya gizlilik kontrolü değildir**; yalnız operasyonel/adlandırma kararıdır. Public repository'deki içerik herkes tarafından okunabilir/forklanabilir kabul edilir.
4. Public repository current tree'sinde yeni secret, token, API key, credential veya private veri commitlenmesi yasaktır. Daha önce history'ye girdiği bilinen credential'lar (özellikle `QUESTIONS_FOR_OWNER.md` içinde kayıtlı eski NVIDIA API key olayı) public durumunda da compromised kabul edilir; ilgili credential owner tarafından revoke/rotate edilmelidir. Repo adının değiştirilmesi bu riski azaltılmış saydırmaz.
5. Actions tüketimini gereksiz büyütmemek için ağır browser/PWA/perf workflow'larında mümkün olan her yerde workflow/ref-scoped `concurrency` + `cancel-in-progress: true` kullanılır. Aynı head için anlamsız tekrarlar yapılmaz; önce hafif contract probe ile runner sağlığı doğrulanır.
6. Repository daha sonra tekrar private yapılırsa bu bölüm silinmez; tarihsel operasyon kaydı olarak kalır. Private'a dönüş yalnız owner kararıyla yapılır ve o anda geçerli GitHub-hosted runner kotası/billing durumu yeniden kontrol edilir.
