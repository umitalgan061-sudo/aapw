# Westeros — Yedi Krallık Haritası 🐉

## 📱 PWA (Progressive Web App) Uygulaması

Bu uygulama modern PWA teknolojisi ile geliştirilmiş olup, masaüstü ve mobil cihazlarda standalone app gibi çalışabilir.

---

## 📁 Dosya Yapısı & Bağlantıları

```
got/
├── index.html              # Ana HTML dosyası (manifest & sw registration)
├── style.css             # Tüm stiller (PWA modu CSS dahil)
├── script.js             # Ana JavaScript (Firebase & oyun mantığı)
├── service-worker.js     # Service Worker (offline + cache)
├── manifest.json         # PWA manifest (install + metadata)
├── browserconfig.xml     # Windows tile konfigürasyonu
└── README.md             # Bu dosya
```

### Dosyalar Nasıl Bağlanmıştır?

1. **index.html** → **style.css**: 
   ```html
   <link rel="stylesheet" href="style.css">
   ```

2. **index.html** → **script.js**:
   ```html
   <script src="script.js"></script>
   ```

3. **index.html** → **manifest.json**:
   ```html
   <link rel="manifest" href="manifest.json">
   ```

4. **index.html** → **service-worker.js** (JavaScript ile kayıt):
   ```javascript
   navigator.serviceWorker.register('service-worker.js', { scope: './' })
   ```

---

## 🚀 PWA Özellikleri

### ✅ Kurulu Özellikler

#### 1. **Offline Desteği**
- Service Worker tüm yerel ve dış kaynakları cache'ler
- Bağlantı kesintisinde, cache'ten sunulur
- Offline mod CSS sınıfı uygulanır

#### 2. **Installation (App Olarak Kurulum)**
- Manifest dosyası app bilgilerini tanımlar
- Kullanıcılar `+ Kur` butonundan yükleyebilir
- Home screen'e ekleme desteği

#### 3. **Standalone Mode**
- Installed app olarak çalıştığında:
  - Tarayıcı UI gizlenir
  - Full screen sunum
  - Safe area desteği (notch, rounded corners)
  - Custom splash screen

#### 4. **Auto-Update**
- Service Worker 60 saniyede bir güncelleme kontrol eder
- Yeni versiyon bulunduğunda bildirim gösterilir
- Sayfa yenileme butonundan anında güncelle

#### 5. **Auto-Save (Oyun Verisi)**
- Oyun durumu 30 saniyede bir otomatik kaydedilir
- localStorage'a yedeklenir
- Bağlantı geri geldiğinde senkronize edilir

#### 6. **Storage Quota Monitor**
- Depolama kullanımı kontrol edilir
- %90 üzerine çıkarsa uyarı gösterilir
- IndexedDB destekli ileride

#### 7. **Smart Caching**
- **Yerel kaynaklar**: Cache-first stratejisi (hızlı)
- **Dış kaynaklar**: Network-first stratejisi (güncel)
- Başarısız network request'ler cache'ten sunulur

---

## 📋 PWA Manifest İçeriği

`manifest.json` şu bilgileri tanımlar:

```json
{
  "name": "Westeros — Yedi Krallık Haritası",
  "start_url": "./index.html",
  "display": "standalone",
  "theme_color": "#c8960a",
  "background_color": "#06040a",
  "icons": [ /* SVG icons */ ],
  "screenshots": [ /* App screenshots */ ]
}
```

---

## 🔄 Service Worker Stratejisi

### Cache Adı
`westeros-v1` - Her güncelleme ile sürüm artırılır

### Kaydedilen Kaynaklar
- ✅ Yerel HTML, CSS, JS
- ✅ Font CDN (preconnect)
- ✅ Font Awesome CDN
- ✅ Harita background image

### Güncelleme
1. Yeni SW kurulur (`installing` state)
2. Eski SW active iken yeni SW hazırlanır
3. Sayfa yenilendiğinde yeni SW aktif olur
4. Update notification gösterilir

---

## 💾 Data Persistence

### localStorage Kullanımı
- **gameData_backup**: Son oyun durumu
- **lastSync**: Son senkronizasyon zamanı
- Limit: ~5-10MB tarayıcıya göre

### Erişim
```javascript
PWAStorage.set('key', value)      // Kaydet
PWAStorage.get('key', default)    // Oku
PWAStorage.remove('key')          // Sil
PWAStorage.checkQuota()           // Kullanımı kontrol et
```

---

## 🌐 Offline Mode

### Otomatik Tespit
```javascript
window.addEventListener('offline', () => {
  document.body.classList.add('offline-mode');
});

window.addEventListener('online', () => {
  document.body.classList.remove('offline-mode');
});
```

### CSS Görselleri
- Kırmızı pulse bar başta görünür
- Ekran hafif desatüre olur (0.98 brightness)
- Tüm işlevler çalışır (cached data kullanılarak)

---

## 📱 Cihaz Uyumluluğu

### Desktop
- ✅ Chrome/Edge PWA (Install butonundan)
- ✅ Firefox (Add to Home Screen)
- ✅ Safari (Web Clip)

### Mobile
- ✅ iOS 13+: Web App mode
- ✅ Android Chrome: Full PWA
- ✅ Android Firefox: PWA
- ✅ Samsung Internet: PWA

### Safe Area Support
- iPhone X+ notch uyumluluğu
- Rounded corner devices
- Landscape orientation safe zones

---

## 🔧 Konfigürasyon & Özelleştirme

### Theme Renkleri
[style.css](style.css) içinde CSS variables:
```css
:root {
  --gold: #c8960a;
  --gold-glow: rgba(200,150,10,.8);
  --bg: #06040a;
  --text: #f5f5f0;
}
```

### Service Worker Timeout
Varsayılan 60 saniye, değiştirmek için:
```javascript
setInterval(() => {
  registration.update();
}, 30000); // 30 saniye
```

### Auto-Save Interval
Varsayılan 30 saniye:
```javascript
PWAGameSync.saveInterval = 20000; // 20 saniye
```

---

## 🔍 Debugging & Advanced Features

### Debug Suite (window.WesterosDebug)
```javascript
// Enable debug suite with keyboard shortcuts:
// Ctrl+Shift+D: Toggle debug console
// Ctrl+Shift+P: Toggle performance monitor

WesterosDebug.analytics.track('event_name', { data: 'value' });
WesterosDebug.logger.log('INFO', 'Message', { details: 'data' });
WesterosDebug.health.report();
WesterosDebug.getMetrics();
WesterosDebug.exportLogs();
```

### Health Check System
App automatically checks:
- ✅ Service Worker status
- ✅ localStorage availability  
- ✅ Network connectivity
- ✅ Memory usage

Run manual check:
```javascript
WesterosHealth.checkAll().then(() => WesterosHealth.report());
```

### Performance Monitoring
Monitor FPS, memory, service worker, and network status in real-time. Enable with `Ctrl+Shift+P`

### Keyboard Shortcuts
- `Ctrl+Shift+D`: Debug console toggle
- `Ctrl+Shift+P`: Performance monitor toggle
- More shortcuts extensible in WesterosShortcuts

---

### Service Worker Kontrol
DevTools → Application → Service Workers

### Offline Mode Test
DevTools → Network → Throttling → Offline

### Cache İçeriği
DevTools → Application → Cache Storage

### Storage Kullanımı
DevTools → Application → Local Storage

### Manifest Doğrulama
Chrome DevTools → Application → Manifest
- ✅ Adı, açıklaması, icons, colors

---

## 📊 Performance Optimizations

1. **Preconnect**: Font ve CDN'ler için
2. **DNS-Prefetch**: Map image hosting
3. **Scrollbar-Gutter**: Layout shift önlemesi
4. **Touch-Friendly**: Min 44x44px buttons
5. **Responsive**: 100dvh (dynamic viewport)

---

## ⚙️ İleride Geliştirilebilecek
- [ ] IndexedDB ile daha büyük veri saklama
- [x] Danışman (Advisor) sistemi
- [x] Hanedan Evlilikleri (Marriage Alliances)
- [x] Hanedan Evlilikleri için dinamik maliyet ve bonuslar
- [x] Paralı Asker (Mercenary) sistemi
- [x] Vassal Entegrasyonu
- [ ] Periodic Background Sync (veri senkronizasyon)
- [ ] Web Push Notifications
- [ ] Share Target API (Sistem share menüsüne entegre)
- [ ] File System API (Oyun kaydını export)
- [ ] Sync API (Offline iken yapılan işlemleri senkronize et)

---

## 📝 Lisans & Kredi

- **Framework**: Vanilla JavaScript
- **Fonts**: Google Fonts (Cinzel, IM Fell English)
- **Icons**: Font Awesome 6.6.0
- **Backend**: Firebase (opsiyonel)

---

## 🎮 Oyun Başlatma

### Local
```bash
# HTTP server başlat (HTTPS gerektirebilir)
python -m http.server 8000
# veya
npx http-server
```

### Browser
```
http://localhost:8000/got/index.html
```

### PWA Kurulum
1. 3 nokta menü → "App'ı kur"
2. veya Adres çubuğundaki "+" ikonu
3. Kurulduktan sonra app drawer'dan çalıştır

---

## 🐛 Troubleshooting

### Service Worker Kaydı Başarısız
- HTTPS kullanın (localhost hariç)
- `service-worker.js` aynı dizinde mi?
- Developer console'da hata var mı?

### Offline Çalışmıyor
- Cache listing check: DevTools → Cache Storage
- Network tab'da kaynakları kontrol et
- Service Worker state'i `activated` mı?

### Installation Butonu Görünmüyor
- HTTPS mi? (Localhost hariç)
- manifest.json geçerli mi?
- Icons SVG format mı?

---

## 📞 İletişim & Feedback

Sorun veya öneriniz varsa:
1. Developer Console'ı açın (F12)
2. Hataları kontrol edin
3. Network tab'da request'leri izleyin

---

**Son Güncelleme**: 2026-05-09
**Westeros PWA v1.0** 🏰
