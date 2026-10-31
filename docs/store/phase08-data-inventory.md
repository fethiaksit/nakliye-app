# Faz 08 — Gerçek veri envanteri ve mağaza beyan taslağı

28 Ekim 2026. Hukuk ve işletme incelemesi bekler; mağazaya gönderilmedi. Backend modeli, API, mobil izin çağrıları ve mevcut altyapı incelendi. Yapılandırmaya bağlı harici sağlayıcılar dağıtımda ayrıca doğrulanmalıdır. Veri sorumlusu unvanı, adresi ve başvuru kanalı resmî kayıtlardan doğrulanacak; tahmin edilmedi.

| Veri / kaynak | Müşteri | Şoför | Amaç / Apple kategorisi / Google kategorisi |
|---|---|---|---|
| Ad, e-posta, telefon; User, kayıt ve profil | Evet | Evet | Hesap/iletişim; Contact Info / Personal info |
| Parola özeti, kullanıcı/oturum kimliği; auth | Evet | Evet | Güvenlik ve hesap yönetimi; User ID / User IDs. Parola düz metin saklanmaz |
| Şirket, yetkili, vergi ve fatura adresi; corporate | Kurumsal | Hayır | Kurumsal doğrulama ve finans; Contact/Other Data / Personal-Financial info; gerçek belgeler ayrıca incelenecek |
| Adres, koordinat, rota; load ve harita çağrıları | Evet | İş/mesaj kapsamında | Hizmet; Precise Location ve Physical Address / Precise location. Hassas koordinatlar kullanıcıyla bağlantılı |
| Araç, plaka, ruhsat, ehliyet, SRC; vehicles/documents | Hayır | Evet | Yeterlilik; Photos/Other User Content/Other Data / Photos, Files and docs, Personal info |
| Psikoteknik, adli sicil gibi belge türleri; driver document definitions | Hayır | Yüklenebilir | Sağlık veya özel nitelikli veri içerebilir; Health/Other Sensitive Info kategorileri hukuk ve fiilî belge kapsamıyla doğrulanmalı. Gereklilik henüz kanıtlanmış değil |
| Mesaj metni, fotoğraf, paylaşılan konum; conversations | Evet | Evet | İletişim; Messages/Photos/User Content / Messages, Photos, Location |
| Yük, teklif, fiyat, teslimat fotoğrafı/kodu, iş geçmişi | Evet | Evet | Hizmet ve uyuşmazlık; User Content/Purchase History / App activity, Financial info, Photos |
| Bakiye, rezervasyon, kredi, komisyon, işlem kayıtları; wallets | Kurumsal | Evet | Finans ve hakların korunması; Financial Info / Financial info. Kart PAN/CVV toplandığı tespit edilmedi; yeni ödeme SDK'sı eklenirse yeniden incelenmeli |
| Şikâyet, açıklama, destek kaydı | Evet | Evet | Destek; Customer Support/Other User Content / Other user-generated content |
| Expo token, platform, projectId; push | Evet | Evet | Bildirim; Device ID/Other Data / Device or other IDs. İzin isteğe bağlı; token kullanıcıya bağlı |
| IP, istek kimliği, API erişim/güvenlik logları | Evet | Evet | Güvenlik/teşhis; Diagnostics/Other Data / Diagnostics, Device IDs. Log ve sağlayıcı meta veri kapsamı dağıtımda kontrol edilecek |
| Kullanıcı bağlantılı PostHog olayları/flags | Kapalı | Kapalı | Ayrı analitik rızası olmadığı için init ağ toplamayı etkinleştirmiyor; marketingConsent ile açılmıyor |

Kaynaklar: `backend/internal/models/{models,corporate,admin}.go`, `backend/internal/httpapi/{api,corporate,push}.go` (mesaj/belge route ve işleyicileri dahil), `frontend/shared/{posthog,notifications}.js`, iki uygulamanın hesap ekranları ve kamera/konum bileşenleri. Dosya adlarıyla birlikte gerçek route/model kullanımı esastır; tespit, mağaza konsolundaki nihai kategori seçimi yerine geçmez.

## Aktarım, bağlantı ve paylaşım

Veriler çoğunlukla kullanıcı kimliğiyle bağlantılıdır; “anonim”, “veri toplanmıyor” veya “hesap silince tüm veri yok oluyor” beyanı verilmemeli. AWS backend/Redis/S3 yedekleri, Expo push ile APNs/FCM, yapılandırılan e-posta hizmeti ve harita/rota sağlayıcıları işlemci/alıcı incelemesine alınmalıdır. Harita SDK'sının bağımsız telemetrisi ve sağlayıcı sözleşmeleri ayrıca incelenmeden “takip yok / paylaşım yok” nihai cevabı verilmemeli. İşin karşı tarafına gerekli adres, mesaj ve iş bilgileri gider. Yönetici inceleme alanları teklif/favori şoför yanıtlarından çıkarıldı. Reklam ID veya reklam SDK kullanımı incelenen akışlarda bulunmadı; bunun tek başına Apple ATT değerlendirmesi olmadığı kaydedildi.

Apple “collected/linked/tracking” ve Google “collected/shared/required/optional” soruları her uygulama için ayrı doldurulmalı. Hizmet sağlayıcı istisnası ancak gerçek sözleşme ve kullanıma göre seçilmeli. HTTPS, yerel beta HTTP istisnaları, log/yedek erişim kontrolü ve üçüncü taraf SDK veri kapsamı yayım dağıtımında teyit edilmeli.

## İzin incelemesi

- Konum: RouteStep/RoutePicker ve ConversationCenter içindeki açık kullanıcı eylemlerinde foreground izin. Elle adres alternatifi mevcut; canlı kaynakta background request/watch yok.
- Kamera/fotoğraf: LoadPhotoPicker, DeliveryCompletionCard, şoför belge/araç ve mesaj ekleme eylemlerinde. Ses kaydı özelliği yok; image-picker mikrofon izni ve Android RECORD_AUDIO config'te kapatıldı.
- Bildirim: otomatik giriş token kaydı artık izin istemiyor; var olan izni kullanıyor. DeviceNotificationsPage açık izin düğmesi üzerinden istek ve yeniden kayıt yapıyor. Reddetmek hesabı veya ödeme onayını engellemez.
- İzin metni/config değişiklikleri mevcut binary'ye JS yenilemesiyle geçmez: yeni native build + gerçek cihaz izin kontrolü gerekir. Faz 08'de native build/cihaz kurulumu yapılmadı.

## Hesap kapatma ve saklama sınırları

`POST /api/me/delete-account`: oturum ve parola doğrular, bütün nakliye kayıtlarını inceler; kapanmamış iş/ödeme onayı/teslim edilmiş ancak tamamlanmamış iş veya açık ilanda bekleyen şoför teklifi varsa reddeder. Teklif mevcut geri çekme endpointiyle kapatılabilir. Okunamayan kayıt kontrolü başarısızsa silmez. Müşteri ve şoför ekranları başarılı API sonrası çıkış yapar; API hatasında giriş sürer.

`POST /api/account-deletion-requests`: herkese açık, hız sınırlı form; otomatik silme değil destek talebi. Yinelenen yanıt başvuru varlığını ayrı mesajla açığa çıkarmaz. Yönetici tamamlama: yetkili oturum + bağımsız kimlik doğrulaması beyanı + işlem notu gerektirir. Kayıtlı iletişim kanalı dışındaki başvuru bilgisine güvenilmemeli.

Ana profil adı/telefon/e-posta değişir; parola, marketing izni, oturum/push bağlantıları kaldırılır. Araçlar deaktive edilir, araç görseli ve doğrulanmamış belge dosyaları silinir. Onaylı belirli mesleki belgeler arşiv statüsünde kalır. Bu davranış hukuki zorunluluk/süre doğrulaması değildir.

Cüzdan, nakliye, mesaj, şikâyet, şirket snapshot'ları ve başvuru kayıtları korunur. Mevcut şirket/iş/mesaj kayıtları kişiye geri bağlanabilir; tam anonimleştirme yok. Pozitif/negatif bakiye, komisyon rezervasyonu ve açık/incelemede şikâyet kapatmayı engeller; önce destek mutabakatı gerekir. Otomatik iade yapılmaz. Delil için gerekli kayıtların kapsamı hukuki incelemeye tabidir.

**Yayım engelleri:** kategori bazlı saklama gerekçesi/süresi, gereksiz kalan içeriklerin hedefli silinmesi, belge erişimi, yedek yaşam döngüsü ve restore sonrası silme taleplerinin yeniden uygulanması onaylanmadı. Otomatik süreli imha yok. Kapatma önce WATCH/MULTI ile atomik bir deleting durumu oluşturur; iş, teklif, finans ve kimlik bilgisi yazımları bu durumu kontrol eder. Dosya temizliği çok adımlıdır; kesintide erişim kapalı kalır ve yetkili destek aynı kapatmayı devam ettirebilir. Finansal kayıtlar bu amaçla topluca silinmemeli.

## Resmî inceleme kaynakları

- [KVKK Aydınlatma Tebliği](https://www.kvkk.gov.tr/Icerik/4132/aydinlatma-yukumlulugunun-yerine-getirilmesinde-uyulacak-usul-ve-esaslar-hakkinda-teblig): aydınlatma ve açık rıza ayrı işlemler; bu taslakta hukuki dayanaklar incelemeye bırakıldı.
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/): üçüncü tarafların davranışı dahil gerçek veri toplama ve kullanıcı bağlantısı beyan edilmeli.
- [Google Play hesap silme gereksinimi](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en): uygulama içi ve web talep yolu; saklama istisnaları açıkça anlatılmalı. Bu sayfanın hazırlanması tek başına mağaza uygunluğu kanıtı değil.
