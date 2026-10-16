# NAKLİYEGO HESAP SİLME VE KİŞİSEL VERİ SİLME POLİTİKASI

**Sürüm:** 1.0.0
**Yürürlük Tarihi:** 14 Ekim 2026
**Son Güncelleme:** 14 Ekim 2026

İşbu Politika, NakliyeGo platformu kullanıcılarının (Müşteri ve Şoför) hesaplarını kapatma, üyelikten ayrılma ve 6698 sayılı KVKK ile App Store ve Google Play geliştirici politikaları uyarınca kişisel verilerinin silinmesini veya anonimleştirilmesini talep etme haklarını ve bu taleplerin işletilme prosedürlerini düzenler.

---

### 1. Hesap Silme Talebi Oluşturma Yöntemleri

Kullanıcılarımız hesap silme ve veri imha taleplerini aşağıdaki kanallardan iletebilirler:

1. **Mobil Uygulama İçi (Doğrudan ve Otomatik):**
   - Müşteri veya Şoför uygulamasında: `Profil > Hesap İşlemleri > Hesabımı Sil` adımı.
   - Güvenlik gerekçesiyle kullanıcının mevcut hesap şifresi istenir.
   - Şifre doğrulaması başarılı olduğunda hesap silme işlemi başlatılır.
2. **Harici Web Sayfası (Google Play Gereksinimi):**
   - Uygulama yüklü olmasa dahi, herkese açık olan [DOĞRULAMA GEREKLİ: https://nakliyego.com/account-deletion] sayfasından kayıtlı telefon/e-posta ile hesap silme başvurusu yapılabilir.
3. **E-posta Yoluyla:**
   - Kayıtlı e-posta adresinden `zeytinavm@gmail.com` adresine yazılı talep iletilerek.

---

### 2. Silme Öncesi Kontroller ve Ön Koşullar

Hesap silme işlemi öncesinde sistem aşağıdaki kontrolleri otomatik olarak gerçekleştirir:
- **Aktif Taşıma Görevi:** Kullanıcının (müşteri veya şoför olarak) henüz tamamlanmamış aktif bir nakliyesi ("driver_en_route", "at_pickup", "picked_up", "en_route_to_delivery") bulunuyorsa, taşıma tamamlanmadan veya usulüne uygun iptal edilmeden hesap silinemez.
- **Açık Teklifler:** Şoförün bekleyen açık teklifleri varsa sistem bunları otomatik olarak geri çeker.
- **Finansal Bakiye ve Uyuşmazlıklar:** Kurumsal müşterinin çözülmemiş bakiye veya açık fatura borcu, şoförün ödenmemiş platform komisyonu veya devam eden bir destek/şikâyet ihtilafı bulunuyorsa, bu hususlar neticelendirilmeden hesap kapatılamaz.

---

### 3. Kişisel Verilerin Silinmesi, Anonimleştirilmesi ve Saklama Ayrımı

Kullanıcı hesabı silindiğinde veri tabanı kayıtlarında aşağıdaki işlemler icra edilir:

1. **Derhal Silinen / İptal Edilen Veriler:**
   - Oturum anahtarları (Access Token, Refresh Token) ve oturum kayıtları derhal iptal edilir.
   - Cihaz push bildirim tokenları (Expo Push Token) silinir.
   - Şoförün aktif araç ve belge bildirimleri pasife alınır.
   - Arama ve giriş indekslerinden (telefon ve e-posta eşlemeleri) kullanıcı kaydı kaldırılır; böylece eski bilgilerle sisteme giriş yapılamaz.
2. **Anonimleştirilen Veriler:**
   - Kullanıcı profili üzerindeki doğrudan kimlik belirten ad, soyad, açık telefon ve e-posta bilgileri geri döndürülemez biçimde anonimleştirilir (Örn: "Silinmiş Kullanıcı").
   - Geçmiş tamamlanmış yük kayıtlarındaki metin mesajları ve görsel ekler tecrit edilir.
3. **Yasal Saklama Yükümlülüğü Kapsamında Korunan Kayıtlar (İstisnalar):**
   - **5651 sayılı Kanun Uyarınca:** IP adresi ve sistem erişim logları 2 (iki) yıl süreyle,
   - **6102 sayılı TTK ve 213 sayılı VUK Uyarınca:** Fatura, makbuz, cüzdan bakiye hareketleri ve mali işlem kayıtları 10 (on) yıl süreyle,
   - **4925 sayılı Karayolu Taşıma Mevzuatı ve Zamanaşımı Uyarınca:** Taşıma sevk ve teslimat teyit kayıtları azami zamanaşımı süresi boyunca,

yetkisiz erişime kapalı, şifrelenmiş ve yalnızca yasal makamların denetim veya mahkeme talepleri için erişilebilen güvenli arşivde saklanır. Bu kayıtlar hiçbir operasyonel süreçte kullanılamaz.

---

### 4. İşlem Sonucu ve Bilgilendirme
Hesap silme işlemi başarılı olduğunda:
- Kullanıcıya ekran üzerinde "Hesabınız ve kişisel verileriniz başarıyla silinmiştir / anonimleştirilmiştir" bildirimi gösterilir.
- Tüm aktif oturumlar kapatılarak kullanıcı giriş ekranına yönlendirilir.
