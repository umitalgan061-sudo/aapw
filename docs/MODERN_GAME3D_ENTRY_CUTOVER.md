# Modern Game3D Entry Cutover

## Amaç

Game3D giriş noktası, sayfa HTML'i içinde dağılmış JavaScript bootstrap mantığından TypeScript-first composition root modeline taşınmıştır. Sayfa artık yalnızca platform kabuğudur; yaşam döngüsünün sahibi `src/3d/modern/gameEntry.ts` modülüdür.

## Sahiplik sınırları

`game3d.html` yalnızca erişilebilirlik, canvas, yükleme yüzeyi, giriş görseli, import-map ve sayfa navigasyonunu taşır. Bootstrap, hata işleme, runtime oluşturma, legacy adapter çağrısı, event bridge, frame loop ve teardown TypeScript tarafındadır.

`src/3d/modern/gameEntry.ts` composition root görevi görür. `createModernRuntime()` ile capability negotiation, kalite başlangıcı, telemetry ve deterministik clock oluşturulur. Legacy `src/3d/game3d.js` tamamen kaldırılmadan önce bu katmandan dinamik olarak yüklenir; böylece mevcut Three.js renderer davranışı korunurken yeni karar katmanı aynı oturumun içine alınır.

`src/3d/modern/entryGate.ts` giriş ekranının DOM yaşam döngüsünü sahiplenir. Gate tek kez kurulabilir, `dispose()` çağrısı tekrarlandığında güvenlidir ve sayfa kapanışı ile dinleyicilerini temizler. Hareket eden "Geri dön" butonu yalnızca gate açıkken ve belirli bir cooldown altında yeniden konumlandırılır.

## Runtime akışı

1. HTML canvas ve loading göstergesini yayınlar.
2. TypeScript composition root canvası çözer.
3. Modern capability negotiation yapılır.
4. Quality controller, telemetry ve fixed-step clock oluşturulur.
5. Entry gate typed controller olarak kurulur.
6. Legacy renderer compatibility boundary üzerinden yüklenir.
7. Legacy ready/error olayları modern platform events yüzeyine köprülenir.
8. İlk runtime snapshot üretilir.
9. Browser destekliyorsa `requestAnimationFrame` tabanlı tek modern loop başlatılır.
10. Her frame için runtime pressure + quality + metrics güncellenir.
11. `dispose()` loop, gate ve event kaynaklarını bırakır.

## Çift loop koruması

Modern entry kendi başına ikinci bir Three.js render loop'u kurmaz. Legacy renderer, kendi mevcut initialization sözleşmesini korur; modern loop yalnızca karar/telemetri katmanını tick eder. Böylece migration aşamasında aynı frame için iki renderer sahipliği oluşturulmaz.

## Hata modeli

Bootstrap hatası loading yüzeyinde kullanıcıya sabit, açıklayıcı bir metin gösterir. Ham hata console'a bırakılır. Legacy event bridge kurulamazsa runtime tamamen bozulmaz; hata modern event bus'a `legacy:bridge-error` olarak aktarılır.

## WebGPU / WebGL2 yaklaşımı

Yeni katman backend bilgisini capabilities negotiation'dan alır. WebGPU mevcut ve güvenliyse modern yol seçilir; destek yoksa mevcut WebGL2 fallback davranışı korunur. WebGPU bir zorunluluk değildir.

## Input ve erişilebilirlik

Sayfa giriş düğmeleri gerçek `<button>` elementleri olarak kalır. Gate, `aria-modal`, `aria-label`, status/live-region ve reduced-motion CSS davranışını destekler. Input router modern katmanda keyboard, pointer, touch ve virtual kaynakları birleştirebilir.

## Persistence

Save sistemi schema + version + checksum ile sınırlandırılır. Yeni Game3D entry doğrudan save payload'una dokunmaz; persistence ownership modern runtime servislerinde tutulur. Böylece page bootstrap ile oyun state'i arasında sıkı coupling oluşmaz.

## Streaming ve kalite

Modern runtime'ın frame lifecycle'ı streaming planner ve adaptive quality controller ile aynı execution domain'inde kullanılabilir. Hedef; CPU/GPU/memory baskısında önce pahalı işlemleri sınırlamak, sonra render scale veya quality tier düşürmek ve sistem stabil olduğunda hysteresis üzerinden kademeli olarak geri yükseltmektir.

## Determinizm

Simulation-critical kodda ambient `Math.random()` ve wall-clock bağımlılığı yasaktır. Deterministic corpus, entry state-machine davranışının 4.096 kombinasyonda aynı sonucu verdiğini doğrular. Browser loop zamanı yalnızca ölçüm için kullanılır; simulation clock bağımsızdır.

## Migration planı

| Aşama | Legacy renderer | Modern entry | Durum |
|---|---|---|---|
| A | Tam sahiplik | Pasif karar katmanı | Tamamlandı |
| B | Compatibility boundary | Typed composition root | Bu cutover |
| C | Renderer API adapter | Render packet ownership | Sonraki aşama |
| D | Legacy scene bootstrap | Modern runtime orchestration | Sonraki aşama |
| E | Legacy module retirement | Tam TypeScript-first | Parite onayı sonrası |

## Geri dönüş stratejisi

Modern entry başarısız olursa deployment'ın geri dönüş noktası legacy renderer branch'idir. Gate ve DOM kabuğu bağımsız tutulduğu için rollback sırasında sayfanın temel navigasyonu ve loading surface'i korunur.

## Kabul kriterleri

- strict TypeScript kontrolü başarısızsa değişiklik kabul edilmez;
- modern platform verification başarısızsa değişiklik kabul edilmez;
- unit/integration testleri başarısızsa değişiklik kabul edilmez;
- production MPA build başarısızsa değişiklik kabul edilmez;
- deterministik corpus 4.096 benzersiz vaka içermelidir;
- acceptance iki kez aynı sonucu vermelidir;
- entry source içinde `eval`, `new Function` veya `document.write` bulunmamalıdır;
- HTML tarafında legacy `initGame3D()` çağrısının ikinci, bağımsız bir bootstrap kopyası bulunmamalıdır.

## Operasyonel not

Bu değişiklik legacy renderer'ın bir gecede silinmesi değildir. Amaç, gerçek kullanıcı akışını modern TypeScript composition root altına taşımak ve renderer emekliliğini ölçülebilir parity kapıları ile daha sonra yapmak.
