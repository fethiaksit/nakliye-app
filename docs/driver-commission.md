# Şoför teklifleri ve %10 hizmet bedeli

Şoför cüzdanı kurumsal müşterinin ödül cüzdanından bağımsızdır. Bakiye ve komisyon kuruş cinsinden tam sayı olarak saklanır. Mevcut TL teklif API'siyle uyumluluk korunur; komisyon hesaplanırken kuruşa dönüştürülür ve en yakın kuruşa yuvarlanır.

## Akış

- Teklif/güncelleme: kullanılabilir bakiye %10 hizmet bedelini karşılamalıdır; para hareketi veya bloke oluşmaz.
- Kabul: bakiye yeniden kontrol edilir; atama, teklif kabulü ve bloke aynı Redis WATCH/MULTI işlemi içindedir.
- Başlangıç ve teslim edilmesi: bloke sürer; tahsilat yoktur.
- Teslimat kodu/fotoğraf doğrulaması ile `completed`: komisyon bir kez bakiyeden ve blokeden düşer. İş durumu, doğrulama ve cüzdan kaydı birlikte yazılır.
- Tamamlanmadan müşteri/admin iptali: bloke kaldırılır. Kurumsal müşteri kredisi kullanılmışsa onun iadesi de aynı işlemde gerçekleşir.
- Aktif işler silinemez; önce iptal edilmelidir. Silinmiş ilanlara teklif/kabul yapılmaz. Taslak ve fotoğraf güncellemeleri eski kayıtla iş/komisyon durumunu ezemez.

## Kullanım

Şoför: **Hesabım → Cüzdanım**. Toplam, bloke, kullanılabilir bakiye ve `TOPUP`, `RESERVE`, `RELEASE`, `COMMISSION` hareketleri gösterilir. Teklif formunda canlı %10 hizmet bedeli ve kullanılabilir bakiye görünür.

Admin: **Şoför Hesapları → Hesabı yönet → Şoför cüzdanı**. Ad, telefon, e-posta veya ID ile arama; bakiyesi olan, blokesi olan ve bakiyesi olmayan hesapları filtreleme; sayfalar arasında gezinme desteklenir. Sıfır bakiyeli şoförler de listelenir. Hesap detayı kapatıldığında liste bakiyeleri yenilenir. Doğrulanmış ödeme, tutar ve benzersiz banka/dekont referansı ile yüklenir. Aynı referansla tekrar gönderim ikinci kredi yaratmaz; farklı tutarla tekrar kullanım reddedilir. Kartla yükleme/ödeme sağlayıcısı bu değişikliğin kapsamına dahil değildir.

API:

- `GET /api/driver/wallet` (yalnızca oturum sahibi şoför)
- `GET /api/admin/drivers/{id}/wallet`
- `POST /api/admin/drivers/{id}/wallet/topups`: `{ "amountCents": 100000, "reference": "banka-dekont-referansi" }`

## Yayına geçiş

Backend, şoför uygulaması ve admin paneli birlikte güncellenmelidir. Yeni şoför cüzdanları sıfır bakiye ile başlar; ilk tekliften önce admin yüklemesi gerekir. Eski bekleyen teklifler kabul sırasında bakiye kontrolüne tabidir. Bu değişiklikten önce kabul edilmiş ve komisyon kaydı bulunmayan işler geriye dönük ücretlendirilmez. Kurumsal ödül cüzdanları değiştirilmez.

Redis kalıcılığı/yedekleme mevcut dağıtım ayarlarına bağlıdır; yeni bir veritabanı servisi gerekmez.

## Doğrulama

- `cd backend && go test -race ./...`: tüm backend paketleri geçti.
- Admin `npm test`: üretim derlemesi ve altı test geçti.
- Şoför uygulaması: esbuild ile yerel importlar ve JSX derlemesi geçti; iOS/Android cihaz derlemesi bu Linux ortamında çalıştırılmadı.
- Tam proje `tsc --noEmit` kontrolünde ana dalda da bulunan eksik Cloudflare worker tipleri (`cloudflare:workers`, `Fetcher`, `D1Database`) mevcut. Değişen admin bileşenleri ayrıca kontrol edilir.

Yeni testler boş bakiye, teklif sırasında hareketsizlik, kabul blokesi, başlangıçta kesinti olmaması, tek sefer tahsilat, iptal iadesi, eşzamanlı kabuller, admin yetkisi, tekrar yükleme, eski işler, aktif/silinmiş işler ve kabul sırasında geciken fotoğraf yüklemesini kapsar.
