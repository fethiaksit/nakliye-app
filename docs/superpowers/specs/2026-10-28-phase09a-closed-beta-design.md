# Faz 09A Kapalı Beta Hazırlığı Tasarımı

## Amaç

Apple Developer üyeliği gerektirmeyen kapalı beta hazırlıklarını, mevcut beta backend'i ve yerel müşteri/şoför kaynakları üzerinde kanıtlamak; cihazda veya mağazada çalıştırılmayan adımları açık bırakmak.

## Kapsam

- Kayıt/giriş, ilan, adres/harita, teklif, mesaj, iptal, teslimat ve kurumsal ödeme onayı için müşteri/şoför E2E senaryoları.
- 4.100 TL teklif ve 500 TL kredi planında onay/ret, onaysız başlatma engeli, tamamlamada DriverWallet/komisyon/tek işlem güvenliği.
- Hesap silme ve yetkilendirme regresyonları; beta 401/403/5xx/bağlantı kontrolleri.
- iPhone 13, Android, push çalışma durumları, TestFlight ve Google Play kapalı test ön koşulları.

## Yaklaşım

Mevcut entegrasyon testleri davranış kanıtı olarak yeniden çalıştırılır. Beta API üzerinde önce veri değiştirmeyen sağlık ve yetki kontrolleri yapılır; kullanılabilir izole test hesabı kimlikleri varsa benzersiz `BETA TEST` kayıtlarıyla mutasyon senaryoları çalıştırılır. Fiziksel cihaz, APNs ve mağaza portalları gözlenmeden başarılı sayılmaz.

## Sınırlar

- Production'a erişilmez veya deploy yapılmaz.
- Beta Redis silinmez, FLUSH/volume işlemi yapılmaz.
- Gerçek müşteri, gerçek teslimat veya gerçek para kullanılmaz.
- Mevcut özellikler yalnız tekrarlanabilir bir hata kanıtlanırsa TDD ile düzeltilir.
- Faz 08 hukuk, public URL ve yedeklerde silme taleplerinin yeniden uygulanması riskleri takipte kalır.

## Seçilen yöntem

Mevcut kapsam ayrıntılı ve kullanıcı ek onay istemeden ilerlenmesini istedi. Bu nedenle mevcut testleri ve test yardımcılarını yeniden kullanan, önce otomasyon sonra beta smoke ve en son manuel cihaz/mağaza listesi üreten tek bir doğrulama akışı seçildi. Yeni E2E framework veya servis eklenmeyecek.
