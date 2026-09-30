# AAPW TypeScript Ownership V14

src/3d altında Three.js vendor kodu dışında bütün JavaScript runtime yollarına TypeScript sahipliği getirildi. Mevcut TS sahipleri korunur; TS sahibi olmayan modüller TS owner + izole .legacy.js payload modeline taşınır. Bu model mevcut HTML, PWA ve import yollarını kırmadan eski uygulama davranışını korurken sonraki strict portların temelini oluşturur.

V14 ayrıca çoklu cihaz input normalization, bounded work queue, adaptive frame/render budget, checksum kontrollü persistence ve telemetry health kontrol düzlemini modern game3D girişine bağlar.
