# Şoför ödeme onayı hata düzeltmesi

## Bulgu

Yerelde ödeme onayı endpoint'i, kart ve 12 saniyelik liste yenilemesi vardı. Ancak nakliye durum alanı yanlışlıkla `driver_selected` olduğunda, bekleyen onay kaydına veya pozitif kredi tahsisine rağmen operasyon endpoint'i işe başlamayı kabul ediyordu. Yeni regresyon testi hem bekleyen kayıtla hem eksik onay kaydıyla bu durumu 200 yanıtıyla yeniden üretti.

Şoförün açık detayı yalnız ilk liste sayfasında bulunan işlerden güncelleniyordu. Ayrıca onay kartı rota ve yük detaylarının altında kalıyordu.

25 Ekim 2026 tarihinde yapılandırılmış beta sunucusuna yapılan kimliksiz kontrol: `/health` Redis hazır olduğunu gösterdi; `POST /api/loads/route-check/payment-approval` **404** döndü. Güncel yerel sürüm bu route'u kayıtlı tutar ve kimliksiz istek için 401 döndürür. Beta'da bu route henüz sunulmuyor; yerel düzeltmelerin beta backend'e alınması gerekir. Bu kontrol gerçek bir nakliye kaydına veya oturuma dokunmadı. Kurulu telefon uygulamasının sürümü bu ortamdan doğrulanamadı.

## Düzeltme

- Operasyon geçişleri ve tamamlama, kredi tahsisi ile şoförün kalıcı kullanıcı/zaman/nakliye/tutar onayını birlikte doğrular. Yalnız durum alanına güvenilmez. Onaysız kredi kaydıyla API üzerinden yola çıkılamaz. İptal/iade akışı açık kalır.
- Ortak durum `payment_approval_pending`; `driver_payment_approval_pending` okuma uyumluluğu eklendi. Mobilde bekleyen onay kaydı, eski operasyon durumu gelse bile operasyon düğmelerini kapatır.
- Kart iş detayının üstündedir. Bedel, nakit, kredi ve toplamı gösterir; “Ödeme Şeklini Onayla ve İşi Al” ve “Reddet” eylemlerini sunar.
- Açık şoför detayı sayfa/filtre sonucuna bağımlı kalmadan açılışta, uygulamaya dönüşte ve 12 saniyede bir doğrudan nakliye endpoint'inden yenilenir. Müşterinin mevcut 12 saniyelik detay yenilemesi korunur.
- Ret sonrası kredi iadesi ve tekrar teklif akışı korunur; müşteriye uygulama bildirimi gönderilir. Tekrar kararlar önceki gibi çakışmayla reddedilir.
- Onaylı tutarların sabitliği ve mevcut DriverWallet'a tamamlamada tek yükleme korunur. Kredisiz nakliyelere ek onay getirilmez.

## Beta sürümü ve build

İki uygulamanın `eas.json` içindeki `preview` profili aynı beta API adresini kullanır: `https://beta-api-18-157-76-136.sslip.io/api`. Kod bu son `/api` parçasını normalize eder; çift `/api/api` oluşturmaz. Production profillerine dokunulmadı.

Dağıtılmış beta APK'ları için **iki mobil uygulama yeniden build edilmelidir**; kaynak değişikliği mevcut APK'yı güncellemez. Projede Expo Updates/OTA yapılandırması bulunmadı. Development client'ta güncel Metro JavaScript'i yüklemek yeterlidir; bu, dağıtılmış preview APK testi yerine geçmez. Backend'in de beta ortamında güncel route ve kontrollerle çalışması gerekir. Hiçbir deploy veya build gönderimi yapılmadı.

## Kabul senaryosu

4.100 TL teklif +60 TL kurumsal kredi: iki hesabın nakliye detayında aynı bekleyen seçim görülür; şoför onay vermeden başlatma 409 ile reddedilir. Şoför kabulünden sonra her iki hesapta `driver_selected / approved` görülür. 4.040 TL nakit, 60 TL şoför kredisi, 410 TL komisyon ve %10 politika ile 404 TL müşteri ödülü doğrulanır. Tekrar tamamlamada ikinci kredi yazılmaz. Eski/tutarsız kayıtlarda onay eksikse başlatma engellenir; otomatik onay veya geriye dönük kredi oluşturulmaz. Böyle bir beta kayıt güvenli iptal/iade ile yeniden seçilmelidir.

Cihaz üzerinde beta testi yapılmadı; beta endpoint'inin güncellenmesi ve yeni APK'larla bu senaryonun çalıştırılması gerekir.

## Yerel test sonuçları

- `backend: go test ./... -count=1`: tüm paketler geçti. Gerçek Redis için ortam isteyen mevcut test normal koşuda atlanır.
- `go test -race ./internal/httpapi -run TestCorporateCredit -count=1`: geçti, veri yarışı raporlanmadı.
- Müşteri `npm test`: 55/55 geçti.
- Şoför `npm test`: 5/5 geçti; bekleyen kayıt + eski operasyon durumunda onay düğmesi görünür, “Yola Çıktım” görünmez; durum adı uyumluluğu doğrulandı.
- Yeni backend regresyonu: `driver_selected` durumuna rağmen bekleyen onay veya onayı eksik pozitif krediyle başlatma 409 olur. 4.100/60 testinde müşteri ve şoför detayları onay öncesi/sonrası birlikte kontrol edilir; yinelenen onay 409 olur ve ikinci bloke oluşturmaz. Tamamlama +60 TL ve tek ödeme kontrolü korunur.
- Değişen JSX dosyaları Babel ile ayrıştırıldı; scoped diff whitespace kontrolü temiz. Bağımsız kod incelemesi ek bulgu bildirmedi.

Ek doğrulama: `/api/listings/{id}/status` ve admin durum endpoint'i de eksik/bekleyen onayla `driver_selected → driver_en_route` geçişini 409 ile reddediyor. Son backend tam test turu ve 5 şoför testi geçti.

## Son düzeltmede değişen dosyalar

- Backend: `backend/internal/store/payment_approval.go` (kredi + kalıcı onay kontrolü), `store/admin.go` (ortak durum geçişi koruması), `store/delivery.go` (tamamlamada aynı kontrol), `models/load_status.go` (durum adı uyumluluğu), `httpapi/payment_approval.go` (ret bildirimi).
- Mobil: `frontend/driver-app/App.jsx` (bağımsız detay yenilemesi), `src/screens/DriverScreens.jsx` (zorunlu üst kart ve operasyon engeli), `src/components/driver/ActiveJobCard.jsx` (liste kartında operasyon engeli), `frontend/shared/loadStatus.js` (ortak onay kontrolü).
- Testler: `backend/internal/httpapi/corporate_credit_consent_test.go`, `frontend/driver-app/src/utils/paymentApproval.test.cjs`.

Fiziksel iPhone build'i sırasında hazır React framework arşivinin exFAT üzerinde eksik kalan module map / umbrella header bağlantıları yerel Pods dosyalarında tamamlandı. Şoför CocoaPods yapılandırması `pod install --deployment` ile kilit dosyasındaki sürümler korunarak yeniden oluşturuldu. Bu işlem ödeme akışını veya production yapılandırmasını değiştirmez.
