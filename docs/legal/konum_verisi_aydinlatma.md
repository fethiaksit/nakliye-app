# NAKLİYEGO KONUM VERİLERİNİN İŞLENMESİNE İLİŞKİN BİLGİLENDİRME

**Sürüm:** 1.0.0
**Yürürlük Tarihi:** 14 Ekim 2026
**Son Güncelleme:** 14 Ekim 2026

İşbu Bilgilendirme Metni, NakliyeGo Müşteri ve Şoför mobil uygulamalarında konum verilerinin toplanma yöntemlerini, işlenme amaçlarını, saklama sürelerini ve kullanıcıların bu konudaki hak ve kontrol mekanizmalarını açıklamak amacıyla hazırlanmıştır.

---

### 1. Müşteri Mobil Uygulamasında Konum Verisi Kullanımı
- **Ön Plan Konum İzni:** Müşteri ilanı oluştururken kalkış ve varış adreslerini harita üzerinde kolayca işaretleyebilmesi ve tersine coğrafi kodlama (reverse geocoding) ile adresin otomatik tamamlanabilmesi amacıyla kullanılır.
- **Mesafe ve Fiyat Hesaplama:** Başlangıç ve varış koordinatları Google Maps Rota API'sine iletilerek güvenli rota mesafesi ve tahmini süre hesaplanır.
- **Arka Plan Konumu:** Müşteri uygulamasında kesinlikle arka plan konum takibi **yapılmaz**. Uygulama kapalıyken veya arka plandayken müşteri konumu hiçbir şekilde okunmaz veya kaydedilmez.

---

### 2. Şoför Mobil Uygulamasında Konum Verisi Kullanımı (Ön Plan ve Arka Plan)
Taşımacılık hizmetinin niteliği ve güvenliği gereği Şoför uygulamasında konum verisi iki farklı düzeyde işlenir:

1. **Yakındaki Yüklerin Listelenmesi (Ön Plan):**
   - Şoför ana sayfayı açtığında bulunduğu coğrafi konuma en yakın yük ilanları listelenir. Böylece şoför boş kilometre yapmadan iş fırsatlarına ulaşabilir.
2. **Aktif Sefer Sırasında Canlı Takip ve ETA Hesabı (Ön Plan ve Arka Plan):**
   - Şoför bir yük için teklif verip müşteri teklifi onayladıktan sonra; şoförün aracı teslim alma noktasına sürmesi ("driver_en_route", "at_pickup") ve yükleme yapıldıktan sonra teslimat adresine seyahati ("picked_up", "en_route_to_delivery") evresinde konum takibi yapılır.
   - Bu süreçte şoförün navigasyon ekranını arka plana atması, telefonunu kilitlemesi veya çağrı yanıtlaması halinde dahi yük sahibine doğru Tahmini Varış Süresi (ETA) ve yük güvenliği takibi sunulabilmesi için arka plan konum izni kullanılır.
3. **Arka Plan Takibinin Kesin Sınırları:**
   - Şoförün üzerinde **aktif bir taşıma görevi yoksa**, arka plan konum takibi kesinlikle **çalışmaz ve veri toplanmaz**.
   - Alıcı tarafından 6 haneli güvenlik teslimat kodu verilip şoför tarafından sisteme girildiği ve teslimat tamamlandığı anda canlı konum paylaşımı derhal **sonlandırılır**.

---

### 3. Konum Verilerinin Güvenliği ve Paylaşım Sınırları
- Şoförün canlı konumu üçüncü kişilerle veya diğer şoförlerle asla paylaşılmaz; sadece o an taşınmakta olan yükün sahibi olan müşteri tarafından görüntülenebilir.
- Harita rota hesaplamalarında yalnızca enlem/boylam koordinatları kullanılır; kişisel kimlik veya araç plaka verileri harita sağlayıcılarına iletilmez.
- Geçmiş sefer rotaları, olası kaza, kayıp, hasar veya yasal itiraz durumlarında inceleme yapılabilmesi amacıyla güvenlik loglarında saklanır.

---

### 4. Konum İzinlerinin Yönetimi ve Kapatılması
Kullanıcılar cihaz işletim sistemi ayarlarından konum izinlerini istedikleri an değiştirebilir:
- **iOS:** Ayarlar > NakliyeGo > Konum > "Asla", "Uygulamayı Kullanırken" veya "Her Zaman" seçenekleri.
- **Android:** Ayarlar > Uygulamalar > NakliyeGo > İzinler > Konum > "Yalnızca uygulama kullanılırken izin ver" veya "Her zaman izin ver".

Konum izninin tamamen kapatılması durumunda harita üzerinde manuel adres seçimi yapılabilir; ancak şoförler için canlı sefer takibi gerektiren aktif iş süreçleri aksayabilir.
