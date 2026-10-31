# iPhone beta build kaydı

İki uygulama için fiziksel iPhone (00008110-000448690E87601E) hedefli, imzalı Release build başarıyla alındı. JavaScript paketi gömülüdür; Metro gerekmez. Her iki pakette `beta-api-18-157-76-136.sslip.io` adresi doğrulandı. Şoför paketinde güncel “Ödeme Şeklini Onayla ve İşi Al” metni ayrıca doğrulandı.

- Müşteri: `/Users/fethiaksit/Library/Developer/Xcode/DerivedData/NakliyeGoMteri-fzyekclqhlvecscqbvuaosmkpoas/Build/Products/Release-iphoneos/NakliyeGoMteri.app` — cihaza yüklendi ve başlatıldı.
- Şoför: `/tmp/nakliyego-driver-beta-device/Build/Products/Release-iphoneos/NakliyeGoofr.app` — build başarılı; ilk yüklemede CoreDevice bağlantısı kesildi. Son kontrolde cihaz `unavailable`; yeniden bağlantı sonrası aynı paket kurulabilir, yeniden build gerekmiyor.

Yeniden kurulum komutu:

```sh
xcrun devicectl device install app --device 00008110-000448690E87601E /tmp/nakliyego-driver-beta-device/Build/Products/Release-iphoneos/NakliyeGoofr.app
xcrun devicectl device process launch --device 00008110-000448690E87601E com.nakliyego.driver
```

Kurulum için uygulama verileri silinmedi. Production deploy veya App Store gönderimi yapılmadı. Son beta endpoint kontrolünde kimliksiz `POST /api/loads/route-check/payment-approval` 404 döndü; yeni backend route'unun beta sunucusunda yayınlanması hâlâ gereklidir. Cihazda ödeme akışının uçtan uca geçtiği iddia edilmez.

Şoförün yerel native build bağımlılıkları `pod install --deployment` ile onarıldı; kilitli bağımlılık sürümleri değiştirilmedi. Hazır React framework arşivindeki exFAT hardlink eksikleri yerel Pods dosyalarında tamamlandı.
