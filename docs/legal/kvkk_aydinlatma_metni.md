# NAKLİYEGO KİŞİSEL VERİLERİN KORUNMASI VE İŞLENMESİ AYDINLATMA METNİ

**Son Güncelleme Tarihi:** 13 Ekim 2026

6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, **NakliyeGo Teknoloji A.Ş.** (“Şirket” veya “NakliyeGo”) olarak veri sorumlusu sıfatıyla, mobil uygulamalarımız (Müşteri ve Şoför), web platformlarımız ve ilgili dijital hizmetlerimiz kapsamında işlenen kişisel verileriniz hakkında sizleri bilgilendirmek isteriz.

---

### 1. İşlenen Kişisel Veri Kategorileri

| Kategori | İlgili Kişi Grubu | İşlenen Veriler |
| :--- | :--- | :--- |
| **Kimlik Bilgileri** | Müşteri, Şoför | Ad, soyad, T.C. kimlik numarası (kurumsal/fatura doğrulama) |
| **İletişim Bilgileri** | Müşteri, Şoför | Telefon numarası, e-posta adresi |
| **Konum Verileri** | Müşteri, Şoför | Başlangıç/varış adresleri, aktif sefer esnasında anlık GPS konumu |
| **Mesleki / Araç Bilgileri** | Şoför | Araç plakası, araç tipi, ehliyet, SRC belgesi, K yetki belgesi |
| **İşlem Güvenliği Verileri** | Tüm Kullanıcılar | IP adresi, cihaz modeli, işletim sistemi sürümü, oturum tokenları, hata logları |
| **Finansal / Ödeme Verileri** | Kurumsal Müşteri, Şoför | Cüzdan bakiye hareketleri, IBAN numarası, fatura bilgileri (Kredi kartı numaraları saklanmaz) |
| **Görsel Veriler** | Müşteri, Şoför | Yük fotoğrafları, teslimat kanıt fotoğrafları, profil görseli |

---

### 2. Kişisel Verilerin İşlenme Amaçları ve Hukuki Sebepleri

Kişisel verileriniz KVKK'nın 5. ve 6. maddelerinde belirtilen aşağıdaki hukuki sebeplerle işlenmektedir:

1. **Sözleşmenin Kurulması ve İfası (KVKK m.5/2-c):**
   - Müşteri ile taşıyıcı (şoför) arasında taşıma talebi oluşturulması, teklif verilmesi ve kabulü.
   - Teslimat kodu (6 haneli doğrulama) ile taşımanın güvenli şekilde tamamlanması.
   - Uygulama içi mesajlaşma aracılığıyla operasyonel koordinasyonun sağlanması.

2. **Hukuki Yükümlülüğün Yerine Getirilmesi (KVKK m.5/2-ç):**
   - Karayolu Taşıma Kanunu ve ilgili yönetmelikler gereği taşıyıcı yetki belgelerinin ve sevk kayıtlarının tutulması.
   - Vergi Usul Kanunu uyarınca fatura ve muhasebe kayıtlarının saklanması.
   - 5651 sayılı Kanun uyarınca erişim ve oturum loglarının tutulması.

3. **Meşru Menfaat (KVKK m.5/2-f):**
   - Sistem güvenliğinin sağlanması, şüpheli işlemlerin (brute-force, spam, sahte teklif) tespiti ve engellenmesi.
   - Uygulama performansının, çökme raporlarının (Sentry) ve kullanıcı deneyiminin (PostHog) anonim/sözde-anonim olarak izlenmesi.

4. **Açık Rıza (KVKK m.5/1):**
   - Şoförlerin aktif taşıma süreci dışında isteğe bağlı arka plan konum takibi ve pazarlama bildirimleri.

---

### 3. Kişisel Verilerin Aktarılması

Kişisel verileriniz, yukarıdaki amaçların gerçekleştirilmesi için yalnızca gerektiği ölçüde ve Kanun’un 8. ve 9. maddelerine uygun olarak aktarılır:
- **Taşıma Tarafları:** Teklifi kabul edilen şoför ile ilgili müşteri arasında ad, telefon ve taşıma adresi paylaşılır.
- **Teknoloji Altyapı Sağlayıcıları:** Bulut sunucu (AWS Docker ortamı), harita ve rota hesaplama (Google Maps Platform - koordinat bazlı), e-posta gönderimi (Resend - yalnızca doğrulama/şifre sıfırlama).
- **Hata ve Analitik Sağlayıcıları:** Sentry (hata izleme) ve PostHog (ürün analitiği) sağlayıcılarına **kişisel veri, telefon, e-posta, açık adres veya mesaj içeriği kesinlikle aktarılmaz**, yalnızca sözde-anonim teknik metrikler iletilir.
- **Yetkili Kamu Kurum ve Kuruluşları:** Yasal zorunluluk halinde adli ve idari makamlar.

---

### 4. Veri Saklama ve İmha Süreçleri

- **Hesap Bilgileri:** Hesap kapatıldıktan sonra yasal zamanaşımı süreleri (TTK ve BK uyarınca 10 yıl) boyunca saklanır.
- **Konum ve Sefer Kayıtları:** Taşıma tamamlandıktan sonra güvenlik ve itiraz süreçleri için azami 3 yıl saklanır.
- **Güvenlik ve Erişim Logları:** 5651 sayılı Kanun gereği asgari 2 yıl saklanır.
- **Hata ve Crash Logları:** Azami 90 gün sonra otomatik olarak silinir.

Sürelerin bitiminde veriler KVKK Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik'e uygun olarak imha edilir.

---

### 5. İlgili Kişinin Hakları (KVKK Madde 11)

Kullanıcılarımız Şirketimize başvurarak;
- Kişisel verilerinin işlenip işlenmediğini öğrenme,
- İşlenmişse buna ilişkin bilgi talep etme,
- Amacına uygun kullanılıp kullanılmadığını öğrenme,
- Yurt içinde veya yurt dışında aktarıldığı 3. kişileri bilme,
- Eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK 7. maddesi uyarınca silinmesini veya yok edilmesini isteme,
- Düzeltme/silme işlemlerinin aktarılan 3. kişilere bildirilmesini isteme,
- Münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhe bir sonucun ortaya çıkmasına itiraz etme,
- Kanuna aykırı işleme sebebiyle zarara uğraması halinde zararın giderilmesini talep etme haklarına sahiptir.

> **Başvuru Kanalı:** Başvurularınızı `kvkk@nakliyego.com` adresine kayıtlı e-postanızdan veya Şirket merkez adresimize yazılı olarak iletebilirsiniz.
