# NAKLİYEGO ÇEREZ VE ÜÇÜNCÜ TARAF ANALİTİK POLİTİKASI

**Son Güncelleme:** 13 Ekim 2026

NakliyeGo dijital platformlarında güvenliği artırmak, sistem hatalarını tespit etmek ve kullanıcı deneyimini iyileştirmek için sınırlı üçüncü taraf izleme ve analitik teknolojileri kullanılmaktadır.

---

### 1. Çerez ve Yerel Depolama (Local Storage) Kullanımı

Web admin panelimizde ve mobil uygulamalarımızda yalnızca **Zorunlu ve İşlevsel Çerezler / Yerel Depolama Anahtarları** kullanılır:
- **Oturum ve Kimlik Doğrulama:** Kullanıcının giriş durumunu korumak ve güvenli API çağrıları yapabilmek için JWT erişim anahtarları cihazın güvenli saklama alanında (SecureStore / Keychain) tutulur.
- **Güvenlik Çerezleri:** CSRF saldırılarını engellemek ve şüpheli oturumları tespit etmek için kullanılır.
- **Pazarlama ve Reklam Çerezleri:** Platformumuzda kullanıcıları diğer sitelerde takip eden üçüncü taraf reklam/hedefleme çerezleri **kullanılmaz**.

---

### 2. Entegre Edilen İzleme Sistemleri ve Gizlilik Tedbirleri

Platformumuzda iki ana teknik izleme sistemi bulunmaktadır:

#### A. Sentry (Hata İzleme ve Çökme Raporlama)
- **Amaç:** Uygulama çökmelerini, sunucu 500 hatalarını ve performans darboğazlarını gerçek zamanlı tespit etmek.
- **Gizlilik Koruması:**
  - `beforeSend` veri temizleme katmanı uygulanmıştır.
  - Authorization başlıkları, Cookie bilgileri, JWT tokenları, parola alanları ve açık kimlik bilgileri loglardan **kesinlikle filtrelenir**.
  - Yalnızca anonim stack trace ve hata türü iletilir.

#### B. PostHog (Ürün Analitiği ve Özellik Yönetimi)
- **Amaç:** Hangi özelliklerin kullanıldığını (ilan oluşturma, teklif verme, teslimat tamamlama) ve uzaktan özellik bayraklarını (Feature Flags) yönetmek.
- **KVKK ve Gizlilik Koruması:**
  - Müşteri veya şoförün telefon numarası, e-posta adresi, açık adresi, IBAN numarası, T.C. kimlik numarası veya mesajlaşma metinleri **asla PostHog sunucularına gönderilmez**.
  - Yalnızca operasyonel metrikler (örneğin: araç sınıfı, mesafe aralığı, buton tıklanması) sözde-anonim kullanıcı kimliği (UUID) ile iletilir.

---

### 3. Kullanıcı Hakları ve İtiraz

Kullanıcılar cihaz ayarlarından analitik izleme tercihlerini değiştirebilir veya KVKK madde 11 kapsamında verilerinin işlenmesine ilişkin itiraz haklarını `kvkk@nakliyego.com` adresinden kullanabilirler.
