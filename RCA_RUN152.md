# Run 152 RCA — workflow YAML heredoc parse failure

## Root Cause

Run 152'nin ilk doğrulama workflow'u, daha önce Run 150'de de yaşanan aynı hata sınıfını tekrarladı: çok satırlı governance kayıtlarını YAML `run: |` bloğu içindeki shell heredoc ile üretmeye çalışmak, dosya oluşturma/indentation katmanlarında YAML parse/config hatasına açık kaldı. Workflow job üretmeden doğrudan failure oldu; runtime, PWA veya oyun kodu çalışmadı.

## Prevention

Yeni Run 152 doğrulamasında YAML içinde governance metni heredoc ile üretilmeyecek. Kayıt yazımı bağımsız bir Python scriptine taşınacak; workflow yalnız scripti çağıracak. Böylece YAML yapısı küçük, mekanik ve parser açısından daha güvenli kalacak.

## Regression Test

Yeni workflow dosyası ayrı dalda push edilecek ve GitHub Actions'ın gerçek bir job oluşturduğu doğrulanacak. Job içinde `python -m py_compile scripts/applyRun152Records.py`, `node --check scripts/checkLatestRunUniqueness.js`, tam smoke/PWA/mobile/world safety zinciri ve final checkpoint uniqueness kontrolü çalışacak. Job oluşmadan workflow başarısız olursa Run 152 DONE sayılmayacak ve main'e hiçbir şey taşınmayacak.
