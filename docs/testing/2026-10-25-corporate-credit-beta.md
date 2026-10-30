# Kurumsal cüzdan karşılığı — beta doğrulama

Değişiklikler yereldir; beta veya production deploy yapılmadı. Dal: `codex/corporate-credit-consent`. Mobil cihaz/emülatör üzerinde beta kabul testi henüz yapılmadı.

## Davranış ve API

- Müşteri teklif seçerken `POST /api/offers/{offerId}/accept` gövdesinde `amountCents` gönderir. Gövdesiz veya sıfır kredi seçimleri mevcut doğrudan atama akışını kullanır.
- Pozitif kredi, müşteri bakiyesinden yalnız bir kez ayrılır; ilan `payment_approval_pending` olur ve `assignedDriverId` boş kalır. `paymentApproval` seçimin kimliğini, nakliyeyi, teklifi, şoförü ve sabit kuruş tutarlarını içerir.
- Şoför `POST /api/loads/{loadId}/payment-approval` ile `{ "selectionId": "...", "accept": true }` gönderir. Eksik karar, başka kullanıcı veya eski seçim kimliği kabul edilmez. Onayla atama ve indirimsiz %10 komisyon blokesi atomik yapılır.
- `accept: false`, krediyi atomik iade eder ve ilanı teklif sürecine döndürür. Yeniden seçim yeni kimlik ve yeni onay gerektirir. Ret sonrasında kredisiz seçim eski kredi koşullarını taşımaz.
- Onay sonrası kredi düzenlenemez. Eski `POST /api/corporate/loads/{id}/wallet` yazma ucu artık 409 döner; onayı atlayarak sonradan indirim eklenemez. Bu nedenle beta backend ve iki mobil uygulama birlikte doğrulanmalıdır.
- Tamamlamada teslimat kanıtı/durumu/geçmişi, komisyon tahsilatı, müşteri ödülü ve `CORPORATE_CREDIT_COMPENSATION` aynı Redis WATCH/MULTI işlemi içinde yazılır. Şoförün mevcut DriverWallet bakiyesi kullanılır. İkinci tamamlama 409 dönebilir; ikinci finansal kayıt oluşmaz.
- Her seçim `payment-approval:{selectionId}` altında kullanıcı, zaman ve nakliye kimliğiyle saklanır; aktif seçim Load üzerinde bulunur. Retten sonra yeni seçim yapılması eski denetim kaydını silmez.
- İptal kredi iadesi ve komisyon blokesi kaldırmayı aynı işlemde yapar; şoför karşılığı yazmaz. Finansal indeks türleri yazmadan önce doğrulanır ve WATCH edilir; bozuk indeks kısmi ödeme bırakmaz.
- Geçmiş tamamlanan nakliyeler için tarama veya otomatik kredi yükleme yoktur. Şoför karşılığı yalnız yeni, açıkça onaylanmış kredi seçimine bağlıdır.

## 4.100 TL / 60 TL kontrolü

Beta hesabı onaylı kurumsal müşteri olmalı; mevcut cüzdanında en az 60 TL, şoförün kullanılabilir cüzdanında en az 410 TL olmalıdır. Beta cüzdan politikasında ödül oranı %10 ve kullanım sınırı en az 60 TL olmalı. Mevcut oran politikası, kademeler ve kredisiz nakliye davranışı değiştirilmedi; testler %10 oranı açıkça ayarlar.

1. Şoför 4.100 TL teklif versin. Müşteri 60 TL seçerek ödeme onayı istesin.
2. Müşterinin bakiyesi 60 TL azalsın. Atanmış şoför bulunmasın; müşteride bekleme durumu görülsün.
3. Şoför ekranında 4.100 TL bedel, müşteriden 4.040 TL ve cüzdana +60 TL açıkça görülsün. Onaysız yola çıkma mümkün olmasın.
4. Şoför “Kabul Ediyorum — İşi Al” seçsin. Kullanıcı/zaman/nakliye kaydı ve 410 TL komisyon blokesi oluşsun.
5. Normal teslimat kodu ve fotoğrafıyla tamamlayın. Şoförün bakiyesi komisyon öncesine göre `-410 +60 = -350 TL` değişsin; komisyon blokesi kalksın ve kullanılabilir bakiyesi güncellensin. Hareketler ayrı ayrı `COMMISSION -410 TL` ve `CORPORATE_CREDIT_COMPENSATION +60 TL` olsun.
6. Müşteri %10 oranında 404 TL ödül kazansın. Bu ödül şoföre aktarılmasın. Admin detayında kullanılan kredi, onaylayan kullanıcı/zaman, yüklenen kredi ve komisyon ayrı görülsün.
7. Tamamlamayı tekrar gönderin ve yanıt kaybolmuş gibi yeniden deneyin. Bakiyeler ve kayıt sayıları aynı kalsın.
8. Ayrı ilanlarda ret, yeniden seçim, başka şoförle kredisiz seçim, onay öncesi/sonrası iptal deneyin. Kredi yalnız bir kez iade edilsin; şoföre kredi verilmesin.
9. Bireysel ve kurumsal kredisiz birer nakliyeyi mevcut akışla tamamlayın.

## Çalıştırılan kontroller

- Backend: `cd backend && go test -json ./... -count=1`.
- Yarış denetimi: `cd backend && go test -race ./internal/httpapi ./internal/store`.
- Eşzamanlı onay/ret, tamamlama/iptal ve tamamlama tekrarları: `go test ./internal/httpapi -run 'TestCorporateCredit(Concurrent|CompletionVersus)' -count=20`.
- Müşteri mobil: `cd frontend/customer-app && npm test`.
- Şoför mobil: `cd frontend/driver-app && npm test`. Native bileşen sınırları taklit edilerek gerçek ekran fonksiyonlarının ödeme bilgileri ve buton olayları denetlenir; cihaz testi yerine geçmez.
- Admin: `cd frontend/admin-panel && npm test` (build + render testleri), ayrıca `./node_modules/.bin/tsc --noEmit`.
- Değiştirilen mobil JSX dosyaları Babel ile ayrıştırıldı.
- Gerçek Redis 8.10.0: yalnız bu iş için açılan geçici yerel Unix socket üzerinde `NAKLIYE_CREDIT_TEST_REDIS_URL=unix:///tmp/nakliyego-credit-consent.sock go test ./internal/httpapi -run TestCorporateCreditRealRedis -count=1` geçti. Sekiz eşzamanlı tamamlama ve tekrar istekleri tek ödeme oluşturdu. Geçici Redis kapatıldı; mevcut Redis servislerine dokunulmadı. Normal pakette bu test ortam değişkeni yokken bilinçli olarak atlanır.

## İnceleme ve sınırlamalar

Bağımsız kod incelemesindeki ret → kredisiz seçim bulgusu düzeltildi ve aynı/başka şoför senaryoları eklendi. Tekrarlı yarış testinin yakaladığı “kazanan işlemin ödül kaydını yetersiz bakiye sayma” hatası, durum çakışması olarak düzeltilip yeniden test edildi. Başlangıçta backend testleri geçiyordu. Önceden mevcut konuşma, navigasyon ve EAS değişiklikleri korunmuştur; bunlar bu özelliğin değişiklikleri değildir. Bunların içindeki `conversationComposer.cjs` EOF boş satır uyarısına dokunulmadı.

## Son sonuçlar

| Kontrol | Sonuç |
| --- | --- |
| Backend tam paketler | 181 test/alt test geçti; gerçek Redis için ortam isteyen 1 test normal koşuda atlandı |
| Go yarış denetimi | httpapi ve store geçti; veri yarışı raporlanmadı |
| Tekrarlı yarış senaryoları | 3 senaryo × 20 tekrar geçti |
| Gerçek yerel Redis | 8 eşzamanlı tamamlama + tekrar istekleri geçti; tek ödeme |
| Müşteri mobil | 55 test geçti |
| Şoför mobil | 4 test geçti |
| Admin | Build + 7 render testi geçti; TypeScript hatası yok |
| Mobil JSX | Değiştirilen 6 dosya ayrıştırıldı |
| Özellik kapsamındaki diff | Whitespace kontrolü temiz |

4.100 TL / 60 TL senaryosu: müşteriden 4.040 TL, şoföre +60 TL kredi karşılığı, 410 TL komisyon ve müşteriye %10 politikada 404 TL ödül doğrulandı. Cihazda beta kabul testi sonraki adımdır; deployment yapılmadı.
