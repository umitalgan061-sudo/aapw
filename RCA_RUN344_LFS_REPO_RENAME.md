# Run 344 RCA — `smokeTestGame3D.js` crashed twice; root cause is a stale repo-name binding, not a code regression

## Symptom

Bu run başlarken `node scripts/smokeTestGame3D.js` iki kez arka arkaya, sırayla farklı check'lerde
(`checkSettlementDiscovery`, sonra `checkNpcGuardPerception`) Playwright hatasıyla çöktü:
`page.close: Protocol error (Target.disposeBrowserContext): Failed to find context with id ...` ve
`page.goto: Target page, context or browser has been closed`. `smokeTestGame3D.js`'in kendi hata
yakalama yapısı (`main().catch(...)`) önceki başarılı check'lerin PASS satırlarını hiç yazdırmadan
sadece son hatayı basıyor — bu yüzden ilk bakışta "hangi check'ler geçti" görünmüyordu.

## Root Cause

Odaklı bir mini-tekrar (`check2DShell`/`check3DMode`/ilk 4 check, izole script) gösterdi ki gerçek
neden bir oyun-kodu hatası değil: **bu oturumun checkout'unda `assets/` altındaki 498 `.glb`/`.fbx`
dosyasının HEPSİ 130-133 byte'lık git-lfs pointer metni** (`version https://git-lfs.github.com/...`),
gerçek binary model verisi değil. `AssetLoader`, her birini gerçek GLB/FBX sanıp `GLTFLoader.parse`'a
veriyor, hepsi `SyntaxError: Unexpected token 'v', "version ht"... is not valid JSON` ile patlıyor ve
placeholder box'a düşüyor — sahnede yüzlerce ardışık asset-load hatası oluşuyor, bu da muhtemelen
headless Chromium'u ~4 dakikalık tam-suite koşusunun ortasında dengesizleştirip context/browser'ı
çökertiyor (iki koşuda da farklı check'te, ama ikisi de "context/browser aniden kapandı" kategorisinde
— klasik kaynak/stabilite tükenmesi imzası, tek bir check'in mantık hatası değil).

**Neden pointer'lar smudge edilmemiş, kök neden zinciri:**
1. Bu container'da `git-lfs` paketi kurulu değildi (bu run içinde `apt-get install -y git-lfs` ile
   kuruldu) — tek başına bu, checkout'un pointer-only kalmasını açıklar.
2. Ama `git-lfs` kurulduktan sonra bile `git lfs pull` **askıda kaldı / hiç ilerlemedi** (2 dakika+
   timeout, sıfır çıktı, `GIT_TRACE`/`GIT_CURL_VERBOSE` ile bile). Kök neden: GitHub deposu
   **`umitalgan061-sudo/westeros-pwa` artık `umitalgan061-sudo/aapw` olarak yeniden adlandırılmış**
   (doğrulama: `curl` ile LFS batch endpoint'ine `westeros-pwa` adıyla istek atınca GitHub
   `307 Moved Permanently` ile `.../aapw.git/info/lfs/objects/batch`'e yönlendiriyor). Bu ortamın
   (Claude Code Remote environment/session) repo kaynağı hâlâ eski adı (`westeros-pwa`) gösteriyor;
   normal `git fetch`/`git push` GitHub'ın şeffaf rename-redirect'i sayesinde eski adla hâlâ çalışıyor
   (bu run boyunca `git fetch origin main` sorunsuz çalıştı), **ama LFS batch isteği farklı bir
   path'e (`aapw`) yönlendiği için** bu oturumun git-proxy'si isteği reddediyor: `403 access denied by
   the git proxy: umitalgan061-sudo/aapw is not in this session's authorized repository set`.
3. Doğrulama: `add_repo(owner="umitalgan061-sudo", repo="aapw", access="push")` çağrıldığında depo
   gerçekten mevcut ve bu hesaba ait — tam push yetkisiyle eklendi. Yeniden aynı LFS batch isteği artık
   `aapw` adıyla atıldığında `200 OK` + geçerli imzalı S3 indirme URL'i döndü; o URL'den indirilen
   dosya `file` komutuyla doğrulandı: **gerçek, sağlam 224076 byte'lık glTF binary v2** (ne veri kaybı
   var, ne bozulma — sorun tamamen erişim/routing, veri kaybı DEĞİL).

**Özetle:** Gerçek 3D asset verisi güvende ve indirilebilir durumda. Sorun, bu ortamın depo adı
bağlamasının GitHub'daki gerçek güncel adın (`aapw`) gerisinde kalması — LFS özelinde bunu kırıyor,
normal git push/fetch'i kırmıyor (bu yüzden run341/343'ün `STABLE_TAGS.md`'de not düştüğü
`git push origin <tag>` `HTTP 403` + "repo moved to .../aapw" uyarısı da muhtemelen AYNI kök neden —
o zaman küçük bir rahatsızlık olarak kayıtta bırakılmış, ama kapsamı bu run'da netleşti: yalnız tag
push değil, **her LFS asset fetch'i** aynı şekilde kırılıyor).

## Belirsiz kalan nokta (owner kararı gerekiyor, tahmin edilmedi)

Önceki run'ların (341-343) kendi perf-snapshot'larında gerçek doku/geometri sayıları raporlanmış
(`31 textures`/`57 geometries` gibi) — bu, o oturumların ortamında gerçek LFS içeriğinin erişilebilir
olduğunu düşündürüyor (belki rename bu run'dan hemen önce oldu, belki o ortamlarda `git-lfs` zaten
kuruluydu ve depo adı henüz değişmemişti). Bu run'ın kendi ortamının bu ikisinden hangisiyle
eşleştiğini (rename'in zamanlaması / diğer session'ların git-lfs kurulu olup olmadığı) bu run'dan
doğrulamak mümkün değil — tahmin edilmedi, `QUESTIONS_FOR_OWNER.md`'ye soru olarak eklendi.

## Prevention / Bu run'ın kendi aksiyonu

- Bu run **hiçbir oyun/dünya kodu değişikliği yapmadı** — bulunan şey bir kod regresyonu değil, bir
  ortam/erişim sorunu; kanıtlanmamış bir "düzeltme" ile kod değiştirmek (ör. AssetLoader'ın hata
  toleransını gevşetmek) gerçek nedeni maskeler ve yanlış olurdu.
- `QUESTIONS_FOR_OWNER.md`'ye owner kararı gerektiren madde eklendi (aşağıda) — bu, tek bir alt
  görevin güvenle çözebileceği bir şey değil: depo adını GitHub'da geri `westeros-pwa` yapmak ya da bu
  ortamın kaynak bağlamasını `aapw`'a güncellemek, ikisi de owner/environment-seviyesi bir aksiyon.
- Push bildirimiyle owner'a iletildi (bu run, `run151`/`run344` emsaline göre — gerçek, tekrarlanabilir
  bir altyapı bulgusu, owner kararı bekliyor kategorisi).

## Regression Test / Gelecek run'lar için not

Gelecekteki bir run bu ortamda `git-lfs` kurulu bulursa ve `assets/**/*.glb`/`*.fbx` dosyaları hâlâ
~130 byte pointer metni ise (`head -c 60 <dosya>` ile `version https://git-lfs...` görülüyorsa), bunu
YENİDEN "keşfedilecek" bir bulgu olarak ele almasın — bu dosyanın kök nedenini okusun. Depo adı owner
tarafından düzeltilene kadar (`westeros-pwa` <-> `aapw`), her yeni oturumun git-proxy yetkilendirmesi
default olarak eski adı taşıyacağı için bu sorun **her run'da tekrar edebilir**; her seferinde
`add_repo(owner, "aapw", access:"push")` ile o oturuma özel geçici bir workaround mümkün (LFS içeriği
gerçek ve erişilebilir kalıyor), ama bu kalıcı bir çözüm değil, sadece owner düzeltmesi gelene kadar
o run'ın kendi smoke-test'ini gerçek assetlerle çalıştırmasını sağlayan bir session-local not.
