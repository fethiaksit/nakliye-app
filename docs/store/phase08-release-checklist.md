# Faz 08 — Mağaza hazırlığı / yayım öncesi takip

28 Ekim 2026. Mağaza gönderimi ve production deploy yapılmadı. Apple üyeliği/D-U-N-S tamamlanmadan kod ve belge hazırlığı ilerletildi. Hiçbir test hesabı production'da açılmadı; gerçek kullanıcı veya gizli bilgi bu dosyaya yazılmamalı.

## Listeleme taslakları

| Alan | Müşteri | Şoför |
|---|---|---|
| Ad | NakliyeGo Müşteri | NakliyeGo Şoför |
| Kısa açıklama | Nakliye talebi oluşturun, teklifleri karşılaştırın ve işinizi takip edin. | Nakliye taleplerine teklif verin, ödeme koşullarını inceleyin ve işlerinizi takip edin. |
| Açıklama taslağı | Yükünüzün adres, tarih ve ihtiyaçlarını girerek nakliye talebi oluşturun. Şoför tekliflerini değerlendirin; ilgili iş üzerinden mesajlaşın ve nakliye durumunu izleyin. Kurumsal işlerde kredi ve nakit dağılımı ayrıca şoförün onayına sunulur. | Nakliye taleplerini inceleyin ve uygun işlere teklif verin. Kurumsal işlerde toplam bedel, nakit alacak ve teslimat sonrası aktarılacak krediyi görerek kabul veya ret verin. Mesajları, teslimat adımlarını ve cüzdan hareketlerini takip edin. |
| Kategori adayı | Apple Business; Google Business veya Maps & Navigation | Apple Business; Google Business veya Maps & Navigation |
| Bundle / package | com.nakliyego.customer | com.nakliyego.driver |

Kategori adaydır; konsoldaki güncel seçenek ve gerçek ürün amacıyla doğrulanacak. “Garantili sigorta”, “tam anonim”, “ücretsiz”, “kesintisiz canlı takip” veya fiyat taahhüdü gibi doğrulanmamış iddialar eklenmemeli.

## Konsol ve hukuki kontrol

- [ ] Resmî veri sorumlusu unvan/adres/iletişim, yayıncı kimliği ve destek sorumlusu doğrulandı.
- [ ] `docs/legal` ve mobil/web ortak taslakları hukuk incelemesinden geçti; amaç/dayanak/alıcı/aktarım ve saklama matrisi tamamlandı. Taslaklar sessizce yürürlüğe konulmamalı; mevcut termsVersion değiştirilmedi.
- [ ] Veri envanteri her uygulama için Apple Privacy ve Google Data Safety formlarına ayrı işlendi; üçüncü taraf SDK ve altyapı davranışları doğrulandı.
- [ ] Tam veri silme istisnaları ve kalan kayıtların gerekliliği belgelendi; gereksiz kalan verilerin hedefli silinmesi, iade/mutabakat ve yedek restorasyon prosedürü onaylandı.
- [ ] Herkese açık HTTPS `/privacy`, `/terms`, `/kvkk`, `/contact`, `/account-deletion` URL'leri onaylı ortamda yayımlandı; giriş/install gerektirmeden gerçek tarayıcıdan açıldı. Faz 08'de yalnız yerel derlenmiş public route 200 kontrolleri yapıldı.
- [ ] Web formunun NEXT_PUBLIC_API_URL (origin veya /api) / NEXT_PUBLIC_ADMIN_API_URL (/api/admin) değeri ilgili ortama ayarlı; ayar yoksa aynı origin `/api` reverse proxy gerekiyor. CORS, ağ yanıtı ve gerçek destek talep takibi beta üzerinde kontrol edildi.
- [ ] Şifre/parola kurtarma ve destek kimlik doğrulama prosedürü test edildi. Web başvurusu tek başına kimlik kanıtı değildir.
- [ ] Yaş/İçerik derecelendirme anketleri mesaj, kullanıcı içeriği, konum ve ticari hizmet özelliklerine göre dolduruldu. Kesin yaş tahmini verilmedi; çocuk hedef kitle kararı işletme/hukuk tarafından alınmalı.
- [ ] Kullanıcı içeriği bildirme/şikâyet, engelleme ve destek moderasyon davranışı mağaza kurallarına göre ayrıca incelendi.
- [ ] Telif/marka, ikonlar, gizlilik manifesti/required-reason API ve ihracat/şifreleme beyanları güncel native build ile kontrol edildi.

## İnceleme hesapları ve ekran görüntüleri

- [ ] Beta/staging içinde kişisel veri içermeyen bireysel müşteri, onaylı kurumsal müşteri ve onaylı şoför hazırlandı. Gerçek telefon/adres/belge kullanılmamalı; mağaza ekibine erişilebilir onaylı inceleme ortamı seçilmeli.
- [ ] Giriş bilgileri yalnız konsolun güvenli App Review/App access alanında paylaşıldı; repoya/parola loguna yazılmadı. OTP/MFA gerekiyorsa tekrarlanabilir inceleme yolu tanımlandı.
- [ ] İkinci, silinebilir müşteri/şoför hesapları ile yanlış parola, aktif iş engeli, temiz hesap kapatma ve girişin reddi fiziksel cihazda test edildi.
- [ ] 4.100 TL teklif / 500 TL kredi / 3.600 TL nakit senaryosu; onay bekliyor, şoför kabul/ret, yeniden seçim, tamamlanınca kredi ve ayrı komisyon gösterimleri hazırlandı. Bildirim onay yerine geçmemeli.
- [ ] Müşteri ekranları: talep, teklifler, ödeme planı/onay bekleme, mesaj, iş takibi, hesap/gizlilik/silme.
- [ ] Şoför ekranları: işler/teklif, zorunlu ödeme onayı kabul-ret, aktif iş, teslimat, cüzdan, hesap/belge/silme.
- [ ] Gerçek sürümden iPhone ve hedeflenen Android telefon boyutlarında ekran görüntüleri üretildi; gerekiyorsa desteklenen tablet boyutları eklendi. Kişisel veriler, gerçek bakiye/mesajlar ve geliştirme menüsü görünmüyor.
- [ ] Yeni native build'de konum/kamera/fotoğraf izinleri yalnız eylemde, mikrofon izni yok; bildirim açık/arka plan/kilitli cihaz senaryoları doğrulandı. Faz 08'de cihaz testi/build yapılmadı.

## Faz 07'den devreden takip

| Açık madde | Kanıt / eksik doğrulama |
|---|---|
| IAM | S3 versioning/lifecycle/bucket encryption yapılandırması ve SNS subscription listesi yetki kısıtı nedeniyle doğrulanamadı; mevcut AES256 nesne kanıtı tek başına bucket politikası kanıtı değil |
| SNS | Gerçek uyarının hedef aboneye teslimi uçtan uca gösterilmedi |
| GitHub-hosted CI | Yerel CI kontrolleri mevcut; GitHub-hosted runner üzerinde workflow sonucu bekliyor |
| iOS push | Faz 08 öncesi APNs/EAS credential ve provisioning eksikleri vardı; gerçek iPhone teslimi kanıtlanmadı. Bu faz bunları tamamlanmış saymaz |

Kaynaklar: [Apple Privacy Details](https://developer.apple.com/app-store/app-privacy-details/), [Google hesap silme koşulları](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Güncel konsol anketi/cihaz gereksinimleri gönderim gününde yeniden kontrol edilmeli.
