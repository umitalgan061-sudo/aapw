# Run216 Browser Harness Syntax RCA

**Tarih:** 2026-08-10  
**Kapsam:** Run216 editor/gameplay browser-proof harness yazımı  
**Runtime etkisi:** Yok; iki hata da uygulama runtime'ı çalıştırılmadan önce `node --check` aşamasında yakalandı.

## Root Cause

Run216 sırasında iki ayrı yeni browser-proof scriptinde aynı elle-yazım hatası tekrarlandı: `page.on('pageerror', ...)` listener satırında kapanış `)` karakteri eksik bırakıldı. Uzun, tek satırlı callback + çağrı + noktalı virgül yapısı görsel olarak kolay kaçtı. İlk olay `checkRun216EditorBrightAuthoringBrowser.js`, ikinci olay `checkGameNightReadabilityVisual.js` içinde oluştu.

Bu, editör aydınlatması veya oyun aydınlatması runtime hatası değildir. Her iki durumda da GitHub Actions önce additive/concurrency kapısını geçti, ardından `node --check` browser başlamadan hatayı buldu.

## Prevention

Yeni/superseding browser harness sürümlerinde `console`, `pageerror`, `response` gibi event listener kayıtları mümkün olduğunca çok satırlı yazılacak; callback kapanışı ile `page.on(...)` kapanışı ayrı ve açık biçimde görülecek.

Hatalı additive-only dosya geriye dönük değiştirilmez/silinmez. Düzeltilmiş harness yeni `V2`/sonraki dosya olarak eklenir. Böylece owner'ın mevcut satırı değiştirmeme kuralı korunur.

## Regression Test

Her browser workflow'unda Playwright kurulumu ve browser boot'undan **önce** aşağıdaki syntax kapısı zorunludur:

```bash
node --check <runtime-değişen-js>
node --check <browser-harness-js>
```

Bu kapı PASS olmadan pahalı browser kurulumu/testi başlamaz. Düzeltilmiş oyun-gece harness'i ayrıca runtime WebGL okunabilirlik ölçümüne geçmeden önce bu syntax kapısından geçecektir.

## Sonuç

Aynı hata üçüncü kez körlemesine tekrar edilmeyecek. Yeni browser harness listener'ları çok satırlı kalıp + erken `node --check` ile yazılacak; runtime değişikliği bu harness syntax hatalarından ayrı değerlendirilecektir.
