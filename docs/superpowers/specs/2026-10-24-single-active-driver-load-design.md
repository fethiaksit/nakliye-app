# NakliyeGo: Şoför başına tek aktif nakliye

Durum: İnceleme tamamlandı; uygulama öncesi tasarım onayı bekleniyor.

## Amaç ve kapsam

Şoförün aynı anda en fazla bir aktif nakliyesi olmalı. Asıl güvence backend/Redis
katmanında uygulanacak; mobil arayüz aynı kuralı anlaşılır biçimde gösterecek.
İş listesi, mevcut işin ilerletilmesi, mesajlaşma ve teslimat erişimi korunacak.
Yeni bağımlılık, production dağıtımı, canlı veri silme veya diğer şoförlerin
kayıtlarında toplu değişiklik yapılmayacak. Mevcut commit edilmemiş değişiklikler korunacak.

## Mevcut durumdan doğrulanan bulgular

- `AcceptOffer`, ilan/teklif/teslimat/komisyon kayıtlarını WATCH/MULTI ile yazıyor.
  Aynı şoförün başka bir aktif işi olup olmadığını kontrol etmiyor.
- Şoför cüzdanı üzerindeki WATCH yarışmayı algılıyor fakat yeterli bakiyesi olan
  şoförün sonraki kabulünü engellemiyor. Bakiye kontrolü iş kapasitesi kuralı değil.
- Kabul, yalnızca kabul edilen ilanın diğer tekliflerini reddediyor.
- `SaveOffer` bağımsız TxPipeline kullanıyor; teklif oluşturma/güncelleme ile kabul
  yarışını engellemek için aynı şoför kilidine katılması gerekiyor.
- Bireysel iptal `TransitionLoadStatus`, kurumsal iptal
  `TransitionLoadStatusAndReverseWallet`, doğrulanmış tamamlama
  `CompleteDeliveryWithReward` üzerinden ilerliyor. Admin iptali aynı yolları kullanıyor.
- `loads:driver:<id>` indeksi SaveLoad içinde yazılıyor fakat AcceptOffer içinde
  güncellenmiyor. Eski aktif işleri bulmak için yalnız bu indekse güvenilemez.
- `IsActiveLoadStatus` published durumunu da içeriyor; şoför meşguliyeti için ayrı,
  dar kapsamlı bir durum politikası gerekli. Mevcut genel yardımcı değiştirilmeyecek.
- Şoför ekranı aktif işi gösteriyor ancak diğer ilanlarda teklif formunu kapatmıyor.
- Müşteri kabul ekranı yalnız pending tekliflerde kabul düğmesi gösteriyor;
  mevcut apiError yordamı backend'in 409 mesajını gösterebiliyor.

## Yaklaşım

Mevcut WATCH/MULTI işlemlerini genişletmek öneriliyor. Ayrı bir ön kontrol yarış
koşulunu çözmez; yalnız mobil kontrol API'den aşılabilir. Ayrı Lua/mutex/servis
katmanı aynı işi ikinci kez kuracağından tercih edilmiyor.

## Aktif iş politikası ve kalıcı kayıt

Aktif durumlar: driver_selected, driver_en_route, at_pickup, picked_up,
en_route_to_delivery, delivered. Eski in_transit değeri mevcut kanonik dönüşümle
en_route_to_delivery kabul edilecek. completed, cancelled ve atanmamış published
ilanlar şoförü meşgul etmeyecek.

Şoför bazlı, süresiz Redis kaydı aktif ilan kimliklerini ve başlatılma sürümünü
tutacak. Önerilen gösterim `driver-active-loads:<driverID>` hash'i:
`version=1` ve her aktif ilan için `load:<loadID>=1`. TTL kullanılmayacak.
Kesin anahtar adı ve yardımcı fonksiyon ayrıntıları uygulayıcıya bırakılıyor.

İlk kullanımda kayıt eksikse mevcut `loads` kayıtları üzerinden yalnız ilgili
şoförün gerçek atamaları değerlendirilecek; eksik/eski driver indeksine
güvenilmeyecek. Okunan ilgili ilanlar ve şoför kaydı WATCH kapsamına alınacak;
bozuk veya okunamayan veri serbest şoför kabul edilmeyecek.
Eski bir şoförün birden fazla aktif işi varsa hiçbir iş silinmeyecek veya başka
şoföre taşınmayacak; hepsi kayıt altında tutulacak ve tamamı bitene kadar yeni
atama engellenecek. Başka şoförlerin kayıtlarına toplu migration uygulanmayacak.
Eski kayıtların tamamlanması/iptali de bu başlangıç denetimine katılacak.
İndeksteki stale referanslar gerçek ilan durumuyla doğrulanacak; temizleme ve
karar WATCH altında tutarlı olacak. Yeniden başlatma veya idempotent tekrar
şoförü yanlışlıkla serbest bırakmayacak.

## Atama ve teklif yarışı

1. Kabul, ilgili şoförün aktif iş kaydını ve teklif indeksini WATCH eder.
2. Başka aktif işi varsa komisyon değişikliği yapmadan ErrDriverBusy döner.
3. Boşsa aktif iş kaydı, ilan ataması, teslimat kaydı, mevcut komisyon rezervi
   ve teklif güncellemeleri aynı MULTI içinde yazılır.
4. Şoförün diğer ilanlardaki pending teklifleri aynı işlemde terminal duruma
   getirilir. Öneri: `unavailable`; bu durum tekrar kendiliğinden pending olmaz.
   Mobil etiket: "Şoför başka nakliye üstlendi". Tamamlanmadan sonra yeni ilanlara
   teklif verilebilir; kapanan teklifler otomatik yeniden açılmaz.
5. Teklif oluşturma/güncelleme de aynı şoför kaydını ve teklif indeksini WATCH
   eder. Kabul ile eşzamanlı yeni pending teklif kaçamaz; eski bir teklif nesnesi
   kabul edilmiş/terminal bir teklifi üzerine yazarak yeniden açamaz.
6. Aynı şoföre iki eşzamanlı kabulden biri başarılı olur. WATCH çatışması sınırlı
   yeniden okuma ile sınıflandırılır; diğerinde HTTP 409 ve istenen mesaj döner:
   "Bu şoförün devam eden bir nakliyesi bulunuyor. Lütfen başka bir şoför seçin."
   Daha önce unavailable olmuş teklife tıklamak da anlaşılır 409 üretir.
7. Admin üzerinden aktif duruma geçiş dahil mevcut atama/durum yazma yolları
   aynı kurala tabi olur. Düşük seviyeli kayıt yardımcılarının gerçek kullanım
   yollarında kuralı aşan bir atama bırakılmayacak.

## Tamamlama, iptal ve para hareketleri

delivered aşamasında aktif iş kaydı korunacak. Kod ve fotoğraf doğrulaması
başarılı completed işleminde ilgili ilan aktif kayıttan aynı MULTI içinde çıkar.
Müşteri ve admin iptalinde de aynı işlem yapılır. Mevcut %10 komisyon RESERVE,
COMMISSION ve RELEASE hesapları, idempotency anahtarları ve kurumsal cüzdan
ödül/iade işlemleri değiştirilmeyecek; sadece aynı atomik sınıra aktif iş
mutasyonu eklenecek. Eski çoklu aktif işlerde yalnız biten ilanın kaydı çıkar.

## Mobil davranış ve API

Şoför iş listesi yanıtına filtre/sayfalama dışında hesaplanan aktif iş bilgisi
eklenecek; bu sayede aktif iş ilk sayfada olmasa da teklif düğmesi engellenir.
App seviyesinde teklif kaydetme koruması ve detay ekranında bilgilendirme:
"Devam eden bir nakliyeniz var. Yeni iş alabilmek için mevcut nakliyeyi tamamlayın."
Mevcut işin operasyon ve teslimat bileşenleri aynen erişilebilir kalır.
Bekleyen teklifler yenilendiğinde unavailable etiketlenir; müşteri kabul düğmesi
göstermez. Eski ekrandan yapılan kabul backend 409 mesajını gösterir.
Mevcut sessiz yenileme mekanizması kullanılır; yeni polling sistemi kurulmaz.

## Değişiklik sınırı

Beklenen ürün dosyaları: models/load_status.go, store/redis.go, yeni store
aktif-iş yardımcısı, store/admin.go, store/corporate.go, store/delivery.go,
httpapi/api.go, driver App.jsx ve DriverScreens.jsx; gerekirse küçük bir ortak
mobil durum yardımcısı ve unavailable teklif etiketini gösteren bileşenler.
Komisyon hesaplarının bulunduğu driver_wallet.go ancak ortak WATCH anahtarını
bağlamak gerekiyorsa değişecek. Müşteri App.jsx mevcut hata gösterimi yeterliyse
değiştirilmeyecek. Son dosya listesi uygulama sonunda raporlanacak.

## Test ve beta doğrulaması

Başlangıç: `go test ./...` başarılı; mevcut 54 mobil test başarılı.
Yeni backend testleri miniredis/httptest ile izole çalışacak; canlı Redis'e
bağlanılmayacak. Boş/meşgul şoför, yeni teklif engeli, iki farklı müşterinin
yeterli komisyon bakiyesiyle eşzamanlı kabulü, delivered engeli, doğrulanmış
completed sonrası açılma, müşteri/admin iptali, tek komisyon rezervi,
eski/çoklu/stale kayıtlar, yeni store nesnesiyle restart, tekrar istek ve
teklif oluşturma-kabul yarışı sınanacak. Kurumsal cüzdan testleri korunacak.
Mobil durum ve teklif engelleme testleri eklenecek; iki uygulama iOS/Android
paketlemesi doğrulanacak. Gerçek iPhone testi yapılmış gibi raporlanmayacak.

Bu görev otomatik deployment içermez. Beta'da yeni backend bütün yazıcı
instance'lara uygulanmalı; eski/yeni yazıcıların karışık kalması yeni kuralı
aşabilir. Sonra güncel mobil JS yüklenir. İki test müşteri hesabı, yeterli bakiyeli
tek test şoförü ve iki ilan ile eşzamanlı kabul denenir; yalnız bir atama ve bir
komisyon rezervi beklenir. delivered, doğrulanmış completed ve iki iptal yolu
aynı test hesaplarıyla denenir. Diğer kullanıcıların işleri değiştirilmez.
