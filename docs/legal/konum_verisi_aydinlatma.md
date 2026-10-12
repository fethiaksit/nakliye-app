# NAKLİYEGO KONUM VERİSİ İŞLEME VE İZİN AYDINLATMASI

**Yürürlük Tarihi:** 13 Ekim 2026

NakliyeGo Müşteri ve Şoför uygulamaları, lojistik ve taşımacılık operasyonlarının güvenli, doğru ve zamanında gerçekleşebilmesi için konum verilerinizi işlemektedir.

---

### 1. Müşteri Uygulamasında Konum Kullanımı

- **Ön Plan Konum İzni:** Yükleme yapılacak başlangıç adresinin ve teslimat adresinin harita üzerinde kolayca işaretlenebilmesi için kullanılır.
- **Canlı Takip:** Taşıma başladığında, yalnızca ilgili ilana atanmış şoförün konumu müşteriye gösterilir; müşterinin anlık konumu taşıma sırasında sürekli takip edilmez.
- **Arka Plan Konumu:** Müşteri uygulamasında arka plan konum takibi **yapılmaz**.

---

### 2. Şoför Uygulamasında Konum Kullanımı (Foreground & Background)

Şoför uygulaması, niteliği gereği konum tabanlı iş eşleştirme ve takip mekanizmasına dayanır:

1. **Yakındaki İşlerin Listelenmesi (Ön Plan):**
   - Şoförün mevcut konumuna en yakın yük ilanlarını listelemek ve boş kilometre maliyetini düşürmek amacıyla konum verisi okunur.

2. **Canlı Sefer Takibi ve ETA Hesabı (Ön Plan ve Arka Plan):**
   - Şoför bir yükü teslim almak üzere yola çıktığında ve teslimat noktasına seyrederken, uygulamanın arka plana atılması (veya ekranın kapanması) durumunda dahi müşteriye tahmini varış süresi (ETA) ve yük güvenliği takibi sunulabilmesi için arka plan konum izni talep edilir.
   - **Önemli İlke:** Arka plan konum takibi yalnızca şoförün üzerinde **aktif ve devam eden bir taşıma görevi ("yolda", "yüklendi")** varken çalışır. Şoför aktif bir iş taşımıyorken arka plan konumu işlenmez.

---

### 3. Konum Verilerinin Korunması ve Sınırları

- Şoförün kesin konumu diğer şoförlerle veya halka açık olarak paylaşılmaz.
- Yalnızca teklifi kabul edilmiş ve o anda taşınmakta olan yükün sahibi olan müşteri, aktif sefer süresince aracı takip edebilir.
- Teslimat kodu girilip taşıma tamamlandığı anda canlı konum paylaşımı derhal sonlandırılır.
- Konum geçmişi, rota optimizasyon analizleri ve olası hukuki itirazlar haricinde harici üçüncü taraflarla ticari amaçla paylaşılmaz.
- Kullanıcılar istedikleri zaman cihaz ayarlarından (iOS: Ayarlar > NakliyeGo > Konum, Android: Ayarlar > Uygulamalar > NakliyeGo > İzinler) konum izinlerini değiştirebilir veya kapatabilir.
