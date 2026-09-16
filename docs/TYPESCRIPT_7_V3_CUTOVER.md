# TypeScript 7 V3 Native Game Runtime

## Neyi değiştiriyor

Bu katman, AAPW'nin 3D oyun girişinde TypeScript'i yalnızca tip tanımı olarak değil, yaşam döngüsü ve orkestrasyon dili olarak kullanır. Mevcut JavaScript dünya uygulaması silinmez; tek bir açık adapter üzerinden çağrılır.

`src/3d/modern/v3/runtimeKernel.ts` deterministik saati, frame budget sınırlarını, pause/resume/stop geçişlerini, recovery durumunu, action kuyruğunu ve immutable render paketini yönetir.

`src/3d/modern/v3/runtimeApplication.ts` tarayıcı composition root'tur. Browser viewport/camera verisini typed source üzerinden toplar, modern runtime metriklerini besler ve legacy dünyayı `TypeSafeLegacyGameAdapter` arkasından çalıştırır.

`src/3d/modern/v3/legacyGameAdapter.ts` tek migration seam'dir. Eski `game3d.js` modülünün `initGame3D` sözleşmesini doğrular, yükleme/kapatma işlemlerini ölçer ve başarısızlığı üst katmana taşır. Yeni V3 kodu rastgele `any` ile legacy nesnelere erişmez.

## Dil politikası

Yeni kritik çalışma zamanı kodu TypeScript 7 + native ESM ile yazılır. JavaScript yalnızca geçici uyumluluk sahibi olarak tutulur. Bir JS modülünün native TS ile değiştirilmesi için typed contract, davranış testi, deterministik tekrar testi ve recovery kanıtı gereklidir.

AAPW zaten TypeScript 7, strict compiler seçenekleri, Vite 8, Vitest 5 ve Rust/WASM hot-path kullanıyor. Bu V3 adımı, bu toolchain'i gerçek 3D runtime sahipliğine genişletir.

## Determinism

Fixed-step clock 60 Hz hedefler; maksimum delta, maksimum catch-up adımı ve accumulator sınırıyla spiral-of-death davranışı sınırlar. Action anahtarları render packet üretiminden önce sıralanır; bu nedenle giriş eklenme sırası render kimliklerini değiştirmez.

## Rendering

V3 render paketi renderer-agnostic'tır. WebGPU tercih edilse bile WebGL2 fallback bilgisi kaybolmaz. Gerçek Three.js resource sahipliği V3 kernel içine taşınmaz; modern renderer katmanı kendi explicit resource/fallback politikalarıyla çalışır.

## Persistence ve ağ

V3 kernel save/network implementasyonu yerine açık `V3SaveIntent` ve `RuntimeDependencies` seam'leri sağlar. Böylece mevcut V4/V5/V6 persistence/network sahiplikleri ikinci bir state authority oluşturmadan bağlanabilir.

## 4096'lık regresyon matrisi

`generateTypeScript7V3CutoverMatrix.mjs` altı bağımsız eksenin kartesyen çarpımını üretir: yüzey, host, renderer, input, persistence ve migration stage. Her satır gerçek bir migration sözleşmesini temsil eder; risk, fallback gereksinimi, adapter gereksinimi ve deterministik saat kuralları da materialize edilir.

CI her push'ta 4096 satırı yeniden üretir, tekrar üretimde byte-identical sonucu doğrular, strict TypeScript kontrolü ve V3 runtime testlerini çalıştırır. 4000 anlamlı değişiklik eşiği, generated contract corpus + source additions ile ölçülür.

## Geçiş

1. Browser entry yalnızca TS composition root'u başlatır.
2. TS root legacy oyun bootstrap'ini tek adapter'dan geçirir.
3. Renderer, input, world ve persistence alt sistemleri ayrı parity kanıtlarıyla V3 native sahipliğine taşınır.
4. Son aşamada `game3d.js` legacy sahibi kaldırılabilir; bu turda fallback korunur.
