# Kurumsal ödeme onayı — 27 Ekim 2026

Mevcut ödeme onayı, ret, mobil kart ve atomik cüzdan altyapısı korundu. Eksik bağlantı: `amountCents: 0` veya gövdesiz eski mobil teklif kabul isteği, kurumsal müşteri için doğrudan atama yapıyordu. Regresyon testi önce bu davranışla başarısız oldu.

Kurumsal seçimler artık kredi sıfır olsa da `payment_approval_pending` oluşturur. Cüzdan politikası kapalıyken sıfır kredi seçilebilir; pozitif kredi limitleri korunur. Sıfır kredi için nakliye tahsis kaydı tutulur ancak cüzdana sıfır tutarlı harcama/iade veya şoför kredi aktarımı yazılmaz. Ret sonrası yeni seçim kimliği gerekir. Store teklif kabulü ve operasyon/tamamlama kontrolleri kurumsal onayı zorunlu tutar; eski onaysız kurumsal işler de başlayamaz. Müşteri butonu ve doğrulama metni sıfır kredide de onay beklendiğini belirtir.

Yerel API uçtan uca testi: 4.100 TL teklif, 500 TL kredi, 3.600 TL nakit. Müşteri ve şoför detayları aynı onay tutarlarını döndürür. Onaysız başlatma reddedilir; kabul sonrası 410 TL komisyon ayrı kaydedilir; teslimat doğrulamasıyla DriverWallet'a 500 TL yalnız bir kez aktarılır. Yinelenen onay/tamamlama ikinci ödeme oluşturmaz. Sıfır kredi ret/tekrar seçim ve onayı eksik eski kayıtla başlatma da test edilir.

Doğrulama: `backend/go test ./... -count=1`, müşteri `npm test` (55), şoför `npm test` (6); müşteri JSX ayrıştırması ve `go test -race ./internal/httpapi -run 'TestCorporateCredit|TestCorporateZero' -count=1` geçti. Gerçek Redis URL isteyen mevcut test yapılandırma olmadığından atlandı. Testler yerel HTTP handler ve miniredis kullanır; gerçek cihaz veya production uçtan uca testi değildir. Deploy yapılmadı. Önceden mevcut çalışma ağacı değişiklikleri korundu.
