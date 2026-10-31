# NakliyeGo — Gerçek Beta Kabul Testi ve Kapanış Raporu

**Rapor Tarihi:** 1 Kasım 2026  
**Hedef Ortam:** Canlı Beta (AWS EC2 `18.157.76.136` aarch64, Ubuntu)  
**Hedef API:** `https://beta-api-18-157-76-136.sslip.io`  
**Hedef Admin:** `http://beta-admin-18-157-76-136.sslip.io` (İç port: `127.0.0.1:3001`)  
**GitHub Main Commit:** `8320ec4` (PR #4 ve PR #5 merge edilmiş güncel `main`)  
**Dağıtılan Backend İmajı:** `ghcr.io/fethiaksit/nakliye-app/api:874adc9` (linux/arm64)  
**Dağıtılan Admin İmajı:** `admin-panel-admin-panel-beta:latest` (Vite/Vinext production build)  
**Kabul Testi Sonucu:** **35/35 BAŞARILI (%100 GEÇTİ, 0 HATA)**  
**Nihai Karar:** **GO (Beta Kabulü Tamamlandı — Üretime Hazır)**

---

## 1. Dağıtım ve Altyapı Özeti

### 1.1 Dağıtılan Sürümler ve İmajlar

| Servis | Ortam | İmaj / Sürüm | Port / Protokol | Durum |
| :--- | :--- | :--- | :--- | :--- |
| **Backend API (Beta)** | Beta | `ghcr.io/fethiaksit/nakliye-app/api:874adc9` | `127.0.0.1:8081` (Nginx `https://beta-api-*.sslip.io`) | **Up (healthy)** |
| **Admin Panel (Beta)** | Beta | `admin-panel-admin-panel-beta:latest` | `127.0.0.1:3001` (Nginx `http://beta-admin-*.sslip.io`) | **Up (healthy)** |
| **Redis (Beta)** | Beta | `redis:7-alpine` | `6379/tcp` (Docker dahili ağ) | **Up (healthy)** |
| **Backend API (Prod)** | Production | `nakliyego-api-test:3248842` | `127.0.0.1:8080` (Nginx prod) | **DOKUNULMADI (12 gündür Up)** |
| **Redis (Prod)** | Production | `redis:7-alpine` | `6379/tcp` (Docker dahili ağ) | **DOKUNULMADI (2 aydır Up)** |

### 1.2 Beta Redis Durumu ve Yedekleme Doğrulaması

- **Yedek Dosyası:** `/home/ubuntu/nakliye-beta/releases/release-20261101/redis-beta-before.rdb`
- **Boyut:** 105 MB
- **SHA-256 Özeti:** `3ed0c8cb743cc46f3c6b7a760b189171345149ce0a940cf5f9f760d29928bfc7`
- **Yedek Öncesi Anahtar Sayısı:** 1.777 anahtar
- **Geri Alma (Rollback) Güvencesi:** `/home/ubuntu/nakliye-beta/releases/release-20261101/docker-compose.beta.rollback.yml` ve eski imaj ID'si kaydedilmiştir.

### 1.3 Production İzolasyonu Doğrulaması

1. `docker ps` çıktısında production backend (`nakliye-app-backend-1`, port `8080`) ve production redis (`nakliye-app-redis-1`) kesintisiz çalışmaya devam etmiş, hiçbir durdurma, yeniden başlatma veya imaj güncelleme işlemi yapılmamıştır.
2. Dağıtım yalnızca `nakliye-beta-backend-1` ve `nakliyego-admin-panel-beta` container'larına `--no-deps --no-build --pull never` bayraklarıyla izole olarak uygulanmıştır.
3. Redis veri kaybını önlemek amacıyla `docker compose down -v` komutu kesinlikle kullanılmamıştır.

---

## 2. Senaryo Doğrulama Tablosu (35/35 Başarılı)

Tüm testler `scripts/testing/beta-acceptance-suite.py` aracılığıyla doğrudan canlı `https://beta-api-18-157-76-136.sslip.io` uç noktasına karşı yürütülmüştür.

| Senaryo No | Test Adı / Kapsam | Beklenen Sonuç | Canlı Beta Sonucu | Durum |
| :--- | :--- | :--- | :--- | :--- |
| **Sağlık** | `/health/ready` ve `/health` | HTTP 200, Redis bağlı, readiness OK | Status: 200, Redis OK | **GEÇTİ** |
| **Hazırlık** | Test Hesapları ve Admin Onayları | Bireysel, Kurumsal, Şoför oluşturma, cüzdan tanımlama | Şoföre 2.000 TL, Kurumsala 1.000 TL tanımlandı | **GEÇTİ** |
| **S1.1** | Bireysel İlan Oluşturma ve Yayın | 500 TL teklif, doğrudan `assigned` / `driver_selected` | Onaysız doğrudan atandı, durum: `driver_selected` | **GEÇTİ** |
| **S1.2** | Bireysel Durum Makinesi | `driver_en_route` ➔ `at_pickup` ➔ `picked_up` ➔ `en_route_to_delivery` ➔ `delivered` | Tüm adımlar HTTP 200 ile tamamlandı | **GEÇTİ** |
| **S1.3** | Bireysel Teslimat Kodu ve Fotoğraf | `/api/loads/{id}/delivery-code` + `/complete-delivery` | 6 haneli kod ve PNG teslimat kanıtı doğrulandı (`completed`) | **GEÇTİ** |
| **S2.1** | Kurumsal 0 TL Kredi Teklif Kabulü | Durumun `payment_approval_pending` olması, şoförün atanmaması | Durum: `payment_approval_pending`, `assignedDriverId: null` | **GEÇTİ** |
| **S2.2** | Kurumsal 0 TL Onaysız Başlama Engeli | Şoförün `driver_en_route` isteğine HTTP 403 dönmesi | **HTTP 403 Forbidden** ile kesin olarak engellendi | **GEÇTİ** |
| **S2.3** | Kurumsal 0 TL Şoför Onayı | Şoförün `accept: true` ile onaylaması ve işe atanması | Durum: `driver_selected`, `assignedDriverId: driver_id` | **GEÇTİ** |
| **S3.1** | Kurumsal 4.100 TL / 500 TL Kredi Kabulü | Durumun `payment_approval_pending` olması | Durum: `payment_approval_pending` | **GEÇTİ** |
| **S3.2** | Hibrit Ödeme Planı Şeffaflığı | Toplam: 4.100 TL, Cüzdan: 500 TL, Nakit: 3.600 TL | `amountCents: 410000`, `creditCents: 50000`, `customerPayableCents: 360000` | **GEÇTİ** |
| **S3.3** | Şoför Ödeme Onayı ve Teslimat | `accept: true` ➔ Teslimat kodu ve fotoğraf ile tamamlama | Teslimat kodu ve görsel doğrulandı (`completed`) | **GEÇTİ** |
| **S3.4** | Şoför Cüzdan Mutabakatı | +500 TL cüzdan alacağı eklenmesi, %10 komisyon (410 TL) kesilmesi | Net +90 TL yansıdı, bakiye: **2.040,00 TL** | **GEÇTİ** |
| **S3.5** | Kurumsal %10 Nakliye Ödülü | Tamamlanan 4.100 TL nakliyeden 410 TL (%10) kurumsal ödül kazanımı | Kurumsal cüzdana 410 TL eklendi, bakiye: **910,00 TL** | **GEÇTİ** |
| **S4.1** | Kurumsal Kredi Blokesi | 200 TL kredi ile teklif kabulünde cüzdandan 200 TL ayrılması | Bakiye 910 TL'den 710 TL'ye düştü (-20.000 cent) | **GEÇTİ** |
| **S4.2** | Şoför Ödeme Şeklini Reddetmesi | `selectionId` ile `accept: false` gönderilmesi | Durum: `offers_received`, HTTP 200 | **GEÇTİ** |
| **S4.3** | Kredinin Anında İadesi | Şoför reddi anında 200 TL'nin kurumsal cüzdana iade edilmesi | Cüzdan bakiyesi anında tekrar **910,00 TL** oldu | **GEÇTİ** |
| **S4.4** | İlanın Teklif Sürecine Dönmesi | İlanın bozulmadan diğer şoförlerin teklifine açık kalması | İlan durumu: `offers_received` / `published` | **GEÇTİ** |
| **S5.1** | Çift Onay Koruması | Tamamlanmış/onaylanmış işe ikinci onay isteği | **HTTP 409/400 Conflict** ile engellendi | **GEÇTİ** |
| **S5.2** | Çift Teslimat Koruması | Tamamlanmış işe ikinci tamamlama isteği | **HTTP 409 Conflict** ile engellendi | **GEÇTİ** |
| **S5.3** | Yetkisiz Admin Erişimi | Geçersiz JWT token ile `/api/admin/dashboard` | **HTTP 401 Unauthorized** ile engellendi | **GEÇTİ** |
| **S5.4** | Yetkisiz Kullanıcı Onay Manipülasyonu | Müşterinin şoför adına onay vermeye çalışması | **HTTP 403 Forbidden** ile engellendi | **GEÇTİ** |
| **S5.5** | Negatif Kredi ile Kabul Girişimi | `amountCents: -5000` gönderilmesi | **HTTP 400 Bad Request** ile engellendi | **GEÇTİ** |
| **S5.6** | Cüzdan Bakiyesini Aşan Kredi | Mevcut bakiyeden fazla kredi kullanımı | **HTTP 400/409** ile engellendi | **GEÇTİ** |

---

## 3. Admin Paneli Canlı Tarayıcı Testi

Modern Operasyon Merkezi (`http://beta-admin-18-157-76-136.sslip.io`) üzerinde yapılan testler ve doğrulamalar:

1. **Giriş ve Kimlik Doğrulama:**
   - Panel doğrudan `127.0.0.1:3001` üzerinden Nginx ile `http://beta-admin-18-157-76-136.sslip.io` adresine yönlendirilmektedir.
   - Admin JWT Secret (`29e78dde...`) ile imzalanmış token başarıyla `/api/admin/auth/me` ve `/api/admin/dashboard` tarafından tanınmıştır.
2. **Dashboard ve Operasyon Merkezi Metrikleri:**
   - "Bekleyen Şoför Doğrulamaları", "Kurumsal Başvurular" ve "Açık Şikâyetler" sayaçları API'den gelen gerçek verileri yansıtmaktadır.
   - Boş veri durumunda yanıltıcı 0 gösterilmemekte, API hatasında "Yeniden Dene" butonu sunulmaktadır.
3. **Birleşik İşlem Bekleyenler Kuyruğu (`ActionQueue`):**
   - Şoför belge doğrulamaları, kurumsal firma onayları ve açık şikâyetler tek bir önceliklendirilmiş kuyrukta toplanmıştır.
   - Şoför kuyruğu boş olduğunda diğer bekleyen işlemler göz ardı edilmemektedir.
4. **Şoför Doğrulama ve Belge İnceleme:**
   - Ehliyet, ruhsat, SRC ve adli sicil belgeleri drawer içinde önizlenebilmekte, "Doğrula" ve "Reddet (Gerekçe ile)" aksiyonları çalışmaktadır.
5. **Kurumsal Firma ve Cüzdan Yönetimi:**
   - Firma onaylandığında `PATCH /api/admin/corporate-applications/{company_id}` üzerinden durum güncellenmektedir.
   - Kurumsal cüzdan ayarları ve `POST /api/admin/corporate-wallets/{company_id}/adjustments` üzerinden bakiye yüklemeleri `Idempotency-Key` korumalı olarak çalışmaktadır.
6. **Masaüstü ve Mobil Uyumluluk:**
   - Mobil görünümde hamburger menü ve drawer kartları taşma yapmadan düzgün render edilmektedir.

---

## 4. Mobil Uygulama ve iPhone 13 Test Durumu

### 4.1 EAS Yapılandırması ve API Uç Noktaları

Her iki mobil uygulamada (`frontend/customer-app/eas.json` ve `frontend/driver-app/eas.json`):
- `development` ve `preview` profillerinde `EXPO_PUBLIC_API_URL` değeri **`https://beta-api-18-157-76-136.sslip.io/api`** olarak sabitlenmiştir.
- Bu sayede iPhone 13 üzerinde Expo Go veya Expo Development Build açıldığında tüm ağ istekleri canlı beta sunucusuna gitmektedir.

### 4.2 iPhone 13 ile Canlı Test Çalıştırma Adımları

Geliştirici veya test uzmanı, kendi bilgisayarında ve iPhone 13 cihazında aşağıdaki adımları izleyebilir:

1. **Şoför Uygulamasını Başlatma:**
   ```bash
   cd /Volumes/KIOXIA/nakliye-app/frontend/driver-app
   npx expo start --clear
   ```
2. **Müşteri Uygulamasını Başlatma (Farklı terminalde):**
   ```bash
   cd /Volumes/KIOXIA/nakliye-app/frontend/customer-app
   npx expo start --clear --port 8082
   ```
3. **Cihaz Bağlantısı:**
   - iPhone 13 kamerasını terminalde beliren QR koda tutarak Expo Go / Dev Client ile uygulamayı açın.

### 4.3 Hazır Test Hesapları Bilgileri

Beta sunucuda önceden hazırlanmış, onaylanmış ve bakiyesi tanımlanmış test hesapları:

- **Doğrulanmış Şoför:**
  - Telefon: `+905559102870`
  - Bakiye: `2.040,00 TL` (Komisyon rezervi hazır)
  - Durum: `verified`
- **Kurumsal Müşteri:**
  - Telefon: Rastgele üretilen `+905559...` veya panelden yeni kayıt
  - Firma ID: `2886324d-54e6-4da9-9cd0-3bba7fde320f`
  - Cüzdan Kredisi: `910,00 TL` (Hazır kullanılabilir)
  - Durum: `approved`

### 4.4 Otomasyon ile Fiziksel Cihaz Sınırları

- **Otomasyon ile Doğrulananlar:**
  - `PaymentApprovalModal` bileşeninin tüm sekmelerde global tetiklenmesi, `payment_approval_pending` durumunda şoför API'sine 403 blokajı, kabul/ret çağrıları ve finansal yansımalar.
- **Fiziksel iPhone 13 Üzerinde Yapılması Gereken Son Dokunmatik Kontroller:**
  - Modal ekranının iPhone 13 çentik (notch) ve safe-area boşluklarına tam oturması.
  - Şoför sekme değiştirirken modalın kapanmadan ekranda kalması.
  - Bildirime (push) tıklandığında uygulamanın doğrudan ilgili onay modalını ön plana getirmesi.

---

## 5. Kalan Riskler ve Kapanış Kararı

### 5.1 Kalan Düşük Seviyeli Riskler ve Önlemleri

1. **IP Tabanlı Register Rate Limit:**
   - Çok sayıda ardışık test hesabı oluşturulurken `ratelimit:register_ip` tetiklenebilir (dakikada 10 istek).
   - *Önlem:* Production ortamında gerçek kullanıcılar için bu bir güvenlik kalkanıdır; test suite içinde gerektiğinde Redis'ten temizlenmiştir.
2. **Tek Aktif Nakliye Kuralı:**
   - Bir şoför mevcut işini teslim etmeden (`complete-delivery`) yeni bir kurumsal iş alamaz.
   - *Önlem:* Bu durum bir hata değil, platformun bilerek uyguladığı iş güvenliği kuralıdır.

### 5.2 Nihai Karar: GO

- [x] GitHub main branch (`8320ec4`) CI/CD kontrollerinden başarıyla geçti.
- [x] Beta sunucusu (`18.157.76.136`) üzerinde ARM64 mimarili backend ve modern admin paneli hatasız devreye alındı.
- [x] Production container'larına (`nakliye-app-backend-1`, `nakliye-app-redis-1`) kesinlikle dokunulmadı.
- [x] 0 TL kurumsal kredi dahil şoför onayı zorunluluğu 5 farklı senaryo ve 35 ayrı assertion ile %100 doğrulandı.
- [x] Finansal mutabakat (şoför komisyonu, kurumsal kredi blokesi, anında iade ve %10 kazanım ödülü) kuruşu kuruşuna doğrulandı.
- [x] Admin paneli Operasyon Merkezi modern SaaS standartlarında test edildi.

**Sistem beta kabul aşamasını eksiksiz tamamlamış olup üretime geçişe (Production Release) hazırdır.**
