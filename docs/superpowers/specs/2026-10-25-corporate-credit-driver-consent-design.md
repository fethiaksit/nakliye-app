# Kurumsal kredi karşılığı ve şoför ödeme onayı

## Amaç ve kapsam
Kurumsal müşterinin kullandığı krediyi, açıkça onay veren şoförün mevcut DriverWallet hesabına yalnızca başarılı teslimat tamamlanmasında aktarmak. Müşteri kalan nakliye bedelini şoföre öder. Bireysel nakliyeler ve kredi kullanılmayan mevcut işleyiş korunur.

## Yaklaşım
Mevcut teklif seçimi, kurumsal kredi tahsisi, DriverWallet ve Redis WATCH/MULTI tamamlama işlemi genişletilir. Ayrı cüzdan veya teslimat sonrasında bağımsız ödeme görevi kullanılmaz: bunlar minimum değişiklik ve atomik tamamlama gereksinimine uymaz. Bu yaklaşım kullanıcı tarafından 25 Ekim 2026 tarihinde prensip olarak onaylanmış; kullanıcı ek onay istemeden uygulamaya geçilmesini istemiştir.

## Teklif ve onay
- Kurumsal müşteri teklif seçerken kredi tutarını kuruş olarak gönderir. Backend bedeli tekliften, müşteri ve şoförü yetkili kayıtlardan belirler.
- Pozitif kredi kullanımı, müşteri bakiyesini atomik olarak bloke eden/ayıran ve ilanı ödeme onayı bekliyor durumuna alan bir seçim oluşturur. Bu aşamada iş atanmaz ve başlatılamaz. Mevcut kurumsal cüzdan muhasebesine uygun rezervasyon temsili uygulama sırasında seçilecektir; kullanılabilir bakiye aynı kredinin yeniden harcanmasını engellemelidir.
- Şoför seçilmiş teklifin bedelini, müşteriden alınacak tutarı ve cüzdan karşılığını görerek açıkça onaylar veya reddeder. Backend seçilmiş şoförü ve güncel seçim kimliğini doğrular.
- Onay; nakliye, teklif, şoför kullanıcı kimliği, zaman, anlaşılan bedel ve kredi tutarıyla saklanır. Atama ve mevcut komisyon rezervasyonu onayla birlikte atomik yapılır.
- Reddetme veya müşteri iptali krediyi yalnızca bir kez serbest bırakır/iade eder. Reddetmede ilan teklif sürecine döner; eski onay uçları sonraki seçimi etkileyemez.
- Onaylı tutar değiştirilemez; değiştirme önce seçimi iptal edip yeni seçim ve onay gerektirir. Mevcut doğrudan kredi uygulama uç noktası bu koşulu atlayamaz.

## Tamamlama ve muhasebe
- Tamamlama, kalıcı onayı ve sabitlenen bedelleri yeniden doğrular.
- Teslimat kanıtı, nakliye durumu/geçmişi, müşteri kredi kullanımı/ödülü, şoför komisyonu ve şoför kredi karşılığı aynı Redis atomik işleminde yazılır.
- Şoför kaydı CORPORATE_CREDIT_COMPENSATION türünde, nakliye bazlı benzersiz işlem kimliğiyle mevcut DriverWallet bakiyesine ve kullanılabilir bakiyesine eklenir. Bonus olarak sunulmaz.
- WATCH çatışmaları sınırlı tekrar denemeyle ele alınır; tekrar gönderilen tamamlama ikinci kayıt yaratamaz. Eksik/bozuk kayıt tüm işlemi engeller.
- Komisyon indirimsiz anlaşma bedelinin %10'u; müşteri ödülü mevcut politika kapsamında indirim sonrası tutarın %10'udur. Müşteri ödülü şoföre aktarılmaz.
- Geçmiş tamamlanmış nakliyelere veya yeni onay kaydı bulunmayan eski nakliyelere otomatik karşılık yazılmaz.

## Arayüzler
Müşteri seçiminde kredi ve kalan ödeme; seçim sonrasında şoför onay durumu gösterilir. Şoföre istenen bilgilendirme, bedel dökümü ve “Kabul Ediyorum — İşi Al” / “Reddet” eylemleri sunulur. Admin detayında kurumsal kredi, onaylayan kullanıcı/zaman, yüklenen şoför kredisi ve komisyon ayrı gösterilir. Cüzdan hareketi mevcut kurallarla komisyonlarda kullanılabilen kredi karşılığı olarak etiketlenir.

## Doğrulama ve teslim
4.100 TL / 60 TL senaryosu: 4.040 TL kalan ödeme, 60 TL şoför kredisi, 410 TL komisyon ve 404 TL müşteri ödülü. API entegrasyon testleri açık onay, yetkisiz istek, onaysız başlatma, tutar değişikliği, ret/iptal/iade, eşzamanlı seçim/onay/iptal/tamamlama, ağ hatasından sonra tekrar ve geçmiş nakliye davranışlarını kapsar. İlgili mobil/admin kontrolleri ve proje testleri çalıştırılır; sonuç ve ortam sınırlamaları raporlanır. Production deploy yapılmaz; beta doğrulama adımları hazırlanır.

## Çalışma alanı
Önceden bulunan kullanıcı değişiklikleri korunur. Gereksiz refactor, yeni bağımlılık ve ikinci şoför cüzdanı eklenmez.
