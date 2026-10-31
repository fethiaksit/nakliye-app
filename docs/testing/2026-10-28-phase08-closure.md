# Faz 08 kapanış — KOŞULLU

28 Ekim 2026. Önceki Faz 08 raporu ve kirli çalışma ağacı incelendi; önceki değişiklikler korundu. Yalnız izole fixture kayıtları kullanıldı. Production/beta deploy, canlı kullanıcı silme, canlı Redis/volume değişikliği veya yeni kalıcı servis yok.

## Sonuç

| Alan | Durum | Kanıt |
|---|---|---|
| Eski token ve oturum erişimi | GEÇTİ | Hesap, refresh ve fotoğraf endpoint'leri silinmiş hesap için 401; refresh/push/reset bağlantıları kaldırılıyor |
| Yeniden etkinleşme / eşzamanlı işlemler | GEÇTİ | CAS ve deleting durumu; 72 miniredis ve 50 gerçek izole Redis yarışı; -race geçti |
| Cüzdan ve komisyon güvenliği | GEÇTİ | Pozitif/negatif bakiye, rezervasyon, kurumsal bakiye ve komisyon rezervasyonu kapatmayı engelliyor; reddedilen kapatma para veya erişimi değiştirmiyor |
| Aktif iş / açık teklif / şikâyet | GEÇTİ | Kapanmamış iş ve ödeme onayı engelleri korundu; açık/incelemede şikâyette destek incelemesi gerekiyor; her iki şikâyet tarafı aynı atomik kontrole dahil |
| Operasyonel kişisel veri temizliği | GEÇTİ | Profil iletişim/parola/serbest metin temizliği, araç görselleri, doğrulanmamış belge dosyaları, sahipsiz yüklemeler ve reset kayıtları test edildi; başka kullanıcının dosyası ve deliller korundu |
| Tüm tarihsel kişisel verilerin gerekliliği | KOŞULLU | Şirket, mesaj, iş, şikâyet, onaylı belge, finans ve aydınlatma/audit kayıtları korunuyor; her kategorinin dayanak/süre/erişim/imha kararını uzman onaylamalı |
| Public hukuk/silme bağlantıları | KOŞULLU | Yerel derlenmiş /privacy, /terms, /kvkk, /contact, /account-deletion girişsiz 200. Doğrulanmış yayımlanmış web URL'si ve canlı form testi yok; tamamlandı sayılmadı |
| Hukuki onay / gerçek iPhone | AÇIK | Taslaklar yayıma onaylanmadı; native build ve fiziksel cihaz testi bu turda yapılmadı |

Test edilen akışlarda ve son kod incelemesinde açık teknik P0 saptanmadı. Bu sonuç tüm KVKK saklama kararlarının verildiği veya mağaza yayımının onaylandığı anlamına gelmez.

## Kapatılan teknik açıklar

1. Eski bir profil veya last-seen isteği, silinmiş kullanıcı kaydını tekrar aktif yazabiliyordu. Regresyonla gösterildi. Kullanıcı güncellemesi artık karşılaştırmalı WATCH/CAS yapıyor; kapatılan hesabın eski kaydı geri yazılamıyor.
2. Fotoğraf endpoint'i yalnız JWT imzasını kontrol ettiği için silinmiş hesabın eski token'ı saklanan fotoğrafı okuyabiliyordu (testte 200). Güncel kullanıcı/rol/durum kontrolü eklendi; artık 401. Yeni fotoğraf yanıtları `private, no-store` kullanıyor; daha önce indirilmiş içeriklerin cihazdan geri alınacağı iddia edilmiyor.
3. Uygunluk kontrolü ve kapatma arasında yeni iş, teklif veya bakiye hareketi oluşabiliyordu. Kapatma; kullanıcı, nakliye/teklif/şikâyet indeksleri ve ilgili finans kayıtlarını WATCH ederek önce `deleting` ve erişim kapatma tarihini atomik yazar. İş/ödeme/cüzdan yazımları aynı kullanıcı kaydını WATCH eder. İki işlem birden başarılı şekilde commit edemez.
4. Geç gelen refresh/push, reset, fotoğraf, belge/araç, şirket ve mesaj yazımları kapatma durumunu kontrol eder. Araç aktivasyonu ve kullanıcı doküman değişiklikleri de kapanışı aşamaz. Yeni bir hizmet veya kilit sunucusu eklenmedi; mevcut Redis WATCH/MULTI/Lua mekanizmaları kullanıldı.
5. Bakiye veya komisyon yükümlülüğü varken kapatma yerine destek mutabakatı istenir. Hiçbir otomatik tahsilat/iade/ledger silme eklenmedi. Sıfır bakiyeli kapatma, finansal geçmişi silmez.
6. Açık şikâyetin hem bildiren hem bildirilen tarafı korunur. Yeni şikâyet ve kapatma yarışında ikisi birden commit edemez.
7. Arşivlenmiş belgenin tekrar denemede silinmemesi korundu. Belge/araç listeleri kapatmada eksik/bozuk kaydı sessizce atlamaz; başka kullanıcıya ait referansla temizlik yapılmaz. Temizlik yarım kalırsa hesap `deleting` durumunda erişime kapalı kalır; yetkili destek UserID üzerinden aynı talebi sürdürebilir. Başarı ancak temizlik ve kimlik bağlantısı iptalinden sonra yazılır.
8. İncelemede, geçmişte teklifi geri çekmiş veya ödeme planını reddetmiş silinen şoförün yeni şoför seçimini engelleyebildiği görüldü. Atomik kontrol yalnız mevcut katılımcıları kapsayacak şekilde daraltıldı. Gerçek HTTP kabul akışı ve komisyon rezervasyonuyla regresyon testi geçti.

## Saklanan ve kaldırılan veri sınırı

- Redis birincil kullanıcı kaydındaki ad/telefon/e-posta değişir; parola, pazarlama seçimi, serbest silme/blok gerekçesi ve şoför profil alanları kaldırılır. Eski telefon/e-posta indeksleri çözülemez.
- Oturum yenileme, push bağlantısı, parola sıfırlama kod/token kayıtları iptal edilir; arka planda geç gelen kayıtlar kapatma durumunu aşamaz.
- Mevcut dosya depolaması `photo:*` Redis hash kayıtlarıdır. Kapatılan kullanıcının iş/mesaj/arşiv belge referansı olmayan yüklemeleri kaldırılır. Başka kullanıcıya ait dosya, iş kanıtı, mesaj eki ve arşiv belge korunur. Kayıp/bozuk belge referansında silme başarı sayılmaz.
- Mesaj, şirket kimlik/iletişim, nakliye adres/kanıt, şikâyet, onaylı belge ve finansal/audit kayıtlarında kişisel veri hâlâ bulunabilir. Bunlara yalnız ilgili yetkili erişim yolları açık kalır; silinen kullanıcının erişimi kapalıdır. Bu kayıtların tümünün yasal zorunluluk olduğu varsayılmadı ve topluca silinmedi.
- Yedeklerdeki tarihsel kişisel veriler ve restore sonrası silme taleplerinin tekrar uygulanması hukuk/operasyon incelemesinde açık. Saklama süresi tahmin edilmedi. “Gereksiz tüm kişisel veri her yerde silindi” beyanı verilmedi.
- Açık şikâyet veya bakiye nedeniyle uygulamadan kapatamayan kullanıcı, mevcut public talep/destek yoluyla inceleme isteyebilir. Mutabakatın işletme ve hukuki prosedürü ayrı onay gerektirir.

## Son testler

| Komut / senaryo | Sonuç |
|---|---|
| Backend `go test ./... -count=1` | Bütün testli paketler başarılı |
| Store hedefli `go test -race` | Başarılı; 6 tür × 12 yarış, ayrıca eski yazım, finans/şikâyet engelleri ve geçmiş teklif regresyonları |
| Gerçek Redis `TestAccountDeletionRealRedis` (`-race`) | 5 tür × 10 yarış başarılı; yeni `/tmp/nakliyego-phase08-*` Unix socket; port kapalı, AOF/RDB kapalı, FLUSH yok, gerçek volume yok; geçici süreç sonlandırıldı |
| Müşteri `npm test` | 74/74 başarılı |
| Şoför `npm test` | 25/25 başarılı |
| Admin `npm test` (build dahil) | 7/7 başarılı; public route yerel 200 kontrolleri dahil |
| Admin `tsc --noEmit` | Başarılı |
| Gerçek cihaz / canlı public form | Yapılmadı; başarı varsayılmadı |

Başlangıçta eski yazım ve silinmiş JWT fotoğraf testleri beklenildiği gibi başarısız oldu; son testlerde hata yok. Mevcut kurumsal ödeme onayı, cüzdan, bildirim ve bireysel akış regresyonları backend/mobil suite'leriyle tekrar geçti. Kanıt: [verification.txt](phase08-closure-20261028/verification.txt).

## Bu kapanışta değişen dosyalar

- `backend/internal/models/admin.go`
- `backend/internal/httpapi/{api,admin,flow_integration_test,legal_account_deletion_test,phase08_test,phase08_closure_test}.go`
- `backend/internal/store/{account_guard,account_deletion_fence,account_deletion_cleanup,account_deletion_closure_test,account_deletion_real_test}.go` (yeni)
- `backend/internal/store/{redis,admin,corporate,driver_wallet,load_edit,password_reset,push,wallet_policy,payment_approval}.go`
- `frontend/shared/{ui/account.jsx,legalTexts.js}`
- `docs/legal/hesap_ve_veri_silme_politikasi.md`
- `docs/store/phase08-data-inventory.md`
- Bu rapor, önceki rapordaki kapanış bağlantısı ve kanıt dosyası.

Önceki fazların değişiklikleri korunmuştur. Tüm kirli ağaç için `git diff --check`, önceki fazdaki `frontend/shared/conversationComposer.cjs:49` EOF boş satırını hâlâ bildirir; bu kapanışın dosyalarında boşluk hatası yok. Production deploy yapılmadı. Apple Developer/D-U-N-S beklenmedi. Faz 07 IAM/SNS/GitHub-hosted CI takip maddeleri geçerlidir.
