export const CURRENT_TERMS_VERSION = '1.0.0';
export const CURRENT_TERMS_DATE = '14 Ekim 2026';

export const LEGAL_DOCS = {
  terms: {
    id: 'terms',
    title: 'Kullanım Koşulları',
    subtitle: 'Platform Kullanıcı Sözleşmesi',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO PLATFORM KULLANICI SÖZLEŞMESİ (KULLANIM KOŞULLARI)

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. TARAFLAR VE ARACILIK ROLÜ
İşbu Kullanıcı Sözleşmesi, Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü] ("NakliyeGo") ile platform üzerinden yük taşıma talebi oluşturan (Müşteri) veya teklif sunan (Şoför) Kullanıcı arasında akdedilmiştir.
NakliyeGo, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun uyarınca "Aracı Hizmet Sağlayıcı"dır. NakliyeGo bir taşıma taahhüt firması veya fiili taşıyıcı DEĞİLDİR. Fiili taşıma hizmeti doğrudan bağımsız Şoför ile Müşteri arasında akdedilir.

2. ARACILIK HİZMETİ VE SÜREÇ
- Müşteri, yükün cinsi, tahmini ağırlığı, boyutları, kat/asansör durumu ve zamanlamasını sisteme girerek ilan oluşturur.
- Şoförler ilanı inceleyerek teklif verir.
- Teklifin Müşteri tarafından kabulü ile taşıma mutabakatı doğar.
- Müşteri, yükü sağlam ve eksiksiz teslim almadan önce 6 haneli güvenlik kodunu şoförle paylaşmamalıdır. Kodun girilmesi ve teslimat kanıt fotoğrafının yüklenmesi taşımanın tam yerine getirildiğinin teyididir.

3. YASAKLI MADDELER
Platform aracılığıyla kanunen taşınması suç teşkil eden kaçak mallar, ruhsatsız silah, mühimmat, yanıcı/patlayıcı/parlayıcı maddeler, uyuşturucu ve çalıntı malların taşınması kesinlikle yasaktır. Aykırılık halinde hesap derhal kapatılır ve yetkili adli mercilere bildirilir.

4. ÜCRET VE MUTABAKAT
Platformdaki fiyat tahminleri gösterge niteliğinde olup nihai taşıma ücreti Şoförün verdiği ve Müşterinin onayladığı tutardır. Kurumsal müşteriler onaylı kurumsal cüzdan bakiyelerini kullanabilirler.

5. SORUMLULUK SINIRLARI
Taşıma fiilinden kaynaklanan kaza, eşya hasarı veya gecikmelerden doğrudan Şoför sorumludur [DOĞRULAMA GEREKLİ: Taşıma Sigortası Kapsamı]. NakliyeGo tarafların şikâyet ve hakemlik süreçlerini yönetir.

6. YETKİLİ MAHKEME
Uyuşmazlıkların çözümünde İzmir Mahkemeleri ve İcra Daireleri [DOĞRULAMA GEREKLİ: Yetkili Mahkeme] yetkilidir.`,
  },

  privacy: {
    id: 'privacy',
    title: 'Gizlilik Politikası',
    subtitle: 'Kişisel Verilerin Korunması ve Gizlilik İlkeleri',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO GİZLİLİK POLİTİKASI (PRIVACY POLICY)

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. VERİ SORUMLUSU
Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü]
Vergi Dairesi / VKN: Hasan Tahsin Vergi Dairesi — 3850507457
Adres: 6220 Sokak No: 12/A, Bornova / İzmir
E-posta: zeytinavm@gmail.com

2. TOPLANAN VERİLER
- Kimlik ve Hesap: Ad, soyad, telefon numarası, e-posta, parola özeti (Argon2id), kurumsal hesaplar için unvan ve vergi no.
- Şoför ve Araç: Plaka, araç türü, kasa boyutları, taşıma kapasitesi, ehliyet, SRC ve psikoteknik belgeleri.
- Konum Bilgisi: Müşteriler için adres seçimi ön plan konumu; şoförler için yakındaki işleri listeleme (ön plan) ve aktif taşıma esnasında müşteriye canlı rota takibi (ön plan ve arka plan konumu).
- İçerik ve Güvenlik: Kargo fotoğrafları, teslimat kodu, teslimat kanıt fotoğrafı, operasyonel mesajlar ve sistem logları.

3. VERİLERİN İŞLENME AMAÇLARI
İlan oluşturma, şoför eşleştirme, güvenli teslimat teyidi, faturalandırma ve 5651 sayılı kanun kapsamındaki yasal loglama yükümlülüklerinin yerine getirilmesi.

4. ÜÇÜNCÜ TARAFLARLA PAYLAŞIM
Verileriniz hiçbir surette satılmaz veya pazarlama amaçlı kiralanmaz. Yalnızca:
- Eşleşen Karşı Taraf: Taşımanın ifası için ad, telefon ve taşıma adresi,
- Google Maps Platform: Adres arama ve rota hesabı için koordinatlar,
- Resend: Doğrulama ve şifre sıfırlama e-postaları,
- Yasal merciler: Resmi zorunluluk halinde.

5. VERİ GÜVENLİĞİ VE HESAP SİLME
Veriler TLS şifrelemesi ve Argon2id parola özetleme ile korunur. Kullanıcılar 'Profil > Hesap İşlemleri > Hesabımı Sil' adımından diledikleri an hesaplarını silebilirler.`,
  },

  kvkk: {
    id: 'kvkk',
    title: 'KVKK Aydınlatma Metni',
    subtitle: '6698 Sayılı Kanun Madde 10 Bilgilendirmesi',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `6698 SAYILI KVKK KAPSAMINDA AYDINLATMA METNİ

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. VERİ SORUMLUSUNUN KİMLİĞİ
Feti Akşit Limited Şirketi [DOĞRULAMA GEREKLİ: Resmî Ticaret Sicil Unvanı Kontrolü]
Vergi Dairesi / VKN: Hasan Tahsin Vergi Dairesi — 3850507457
Tebligat Adresi: 6220 Sokak No: 12/A, Bornova / İzmir
E-posta: zeytinavm@gmail.com | KEP: [DOĞRULAMA GEREKLİ: KEP Adresi]

2. HUKUKİ SEBEPLER (KVKK m. 5 ve 6)
- Sözleşmenin Kurulması ve İfası (m. 5/2-c): İlan eşleme, taşıma icrası, mesajlaşma, 6 haneli teslimat kodu doğrulaması.
- Hukuki Yükümlülük (m. 5/2-ç): 5651 sayılı Kanun logları, TTK ve VUK uyarınca muhasebe kayıtları.
- Meşru Menfaat (m. 5/2-f): Dolandırıcılık engelleme, sistem güvenliği, anonim hata izleme.
- Açık Rıza (m. 5/1): İsteğe bağlı ticari ileti ve pazarlama onayları.

3. İLGİLİ KİŞİNİN HAKLARI (KVKK m. 11)
Veri sahipleri; verilerinin işlenip işlenmediğini öğrenme, yanlış verileri düzelttirme, silinmesini talep etme ve kanuna aykırı işleme sebebiyle zararın giderilmesini isteme haklarına sahiptir.
Başvurularınızı sistemde kayıtlı e-postanızdan zeytinavm@gmail.com adresine gönderebilirsiniz. Talepleriniz en geç 30 gün içinde sonuçlandırılır.`,
  },

  consent: {
    id: 'consent',
    title: 'Açık Rıza Metinleri',
    subtitle: 'Ticari İletişim ve İsteğe Bağlı Veri İşleme Onayları',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO AÇIK RIZA BEYANLARI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

ÖNEMLİ İLKE:
Aydınlatma yükümlülüğü tek taraflı bilgilendirme olup onay gerektirmez. Aşağıdaki açık rıza beyanları tamamen İSTEĞE BAĞLIDIR ve varsayılan olarak İŞARETLENMEMİŞTİR. Onay vermemeniz temel nakliye aracılık hizmetini kullanmanızı engellemez.

1. TİCARİ ELEKTRONİK İLETİ VE PAZARLAMA RIZASI
NakliyeGo tarafından sunulan özel indirimler, avantajlı nakliye fırsatları ve kampanyalar hakkında SMS, e-posta, telefon ve anlık mobil bildirim kanalları üzerinden ticari elektronik ileti gönderilmesine ve iletişim verilerimin pazarlama amacıyla işlenmesine onay veriyorum.
(Bu izni dilediğiniz zaman uygulama içi Bildirim Ayarları alanından ücretsiz olarak geri alabilirsiniz.)

2. ŞOFÖRLER İÇİN BOŞ DÖNÜŞ VE İŞ ÖNERİSİ KONUM RIZASI
Üzerimde aktif bir taşıma görevi bulunmadığı zamanlarda da, boş kilometre yapmamı önlemek amacıyla bulunduğum bölgedeki yeni nakliye ilanlarının bana anlık olarak önerilmesi için konum verilerimin işlenmesine onay veriyorum.
(Aktif bir yük taşırken konum takibi sözleşme ifası gereğidir; bu rıza yalnızca boşta olunan zamanları kapsar.)`,
  },

  location: {
    id: 'location',
    title: 'Konum Verisi Aydınlatması',
    subtitle: 'Ön Plan ve Arka Plan Konum İzin Bilgilendirmesi',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO KONUM VERİSİ İŞLEME VE İZİN AYDINLATMASI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. MÜŞTERİ UYGULAMASI KONUM KULLANIMI
- Ön Plan Konumu: Yükleme ve boşaltma adreslerinin harita üzerinde hızlı seçilmesi ve Google Maps rota mesafe hesabı için kullanılır.
- Arka Plan Takibi: Müşteri uygulamasında kesinlikle arka plan konumu ALINMAZ ve İŞLENMEZ.

2. ŞOFÖR UYGULAMASI KONUM KULLANIMI
- Yakındaki İlanlar (Ön Plan): Şoförün mevcut konumuna yakın yükleri listeleyerek yakıt tasarrufu sağlamak için kullanılır.
- Canlı Sefer Takibi (Ön Plan & Arka Plan): Şoför teklifi kabul edilen bir yükü teslim almaya veya teslimata götürürken, uygulama simge durumuna küçültülse dahi müşteriye tahmini varış süresi (ETA) ve yük güvenliği takibi sunabilmek için arka plan konumu kullanılır.

3. KESİN GÜVENLİK SINIRI
- Şoförün üzerinde aktif ve devam eden bir taşıma yoksa arka plan konumu ASLA İŞLENMEZ.
- Teslimat kodu girilip taşıma tamamlandığı anda canlı konum paylaşımı derhal DURDURULUR.
- Konum izinleri cihaz ayarlarından (iOS/Android) dilediğiniz zaman değiştirilebilir.`,
  },

  deletion: {
    id: 'deletion',
    title: 'Hesap ve Veri Silme Politikası',
    subtitle: 'Hesap Kapatma ve Veri İmha Prosedürü',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO HESAP VE KİŞİSEL VERİ SİLME POLİTİKASI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. HESAP SİLME YÖNTEMLERİ
- Mobil Uygulama: 'Profil > Hesap İşlemleri > Hesabımı Sil' adımı ile şifrenizi doğrulayarak hemen silebilirsiniz.
- Web Portalı (Google Play Uyumu): https://nakliyego.com/account-deletion adresinden dışarıdan silme talebi iletebilirsiniz.

2. SİLME ÖNCESİ GEREKLİLİKLER
- Aktif ve devam eden nakliye görevi bulunan kullanıcılar, taşıma tamamlanmadan veya iptal edilmeden hesap silemez.
- Açık bakiye uyuşmazlığı veya devam eden şikâyet incelemesi varsa neticelendirilmesi gerekir.

3. SİLME VE ANONİMLEŞTİRME SÜRECİ
- Hesap silindiğinde tüm oturum tokenları ve bildirim anahtarları derhal iptal edilir.
- Kullanıcı adı, telefonu ve e-postası geri döndürülemez biçimde 'Silinmiş Kullanıcı' olarak anonimleştirilir.
- Yasal Saklama: TTK ve VUK gereği fatura/muhasebe kayıtları 10 yıl, 5651 logları 2 yıl boyunca yetkisiz erişime kapalı arşivde saklanır ve süre bitiminde imha edilir.`,
  },

  driverTerms: {
    id: 'driverTerms',
    title: 'Şoför Hizmet Koşulları',
    subtitle: 'Bağımsız Taşıyıcı Kullanım Standartları',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO TAŞIYICI (ŞOFÖR) HİZMET KOŞULLARI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. BAĞIMSIZ STATÜ
Şoför, NakliyeGo'nun personeli veya acentesi değil; kendi nam ve hesabına faaliyet gösteren bağımsız bir nakliyecidir. NakliyeGo yalnızca aracı teknoloji platformudur.

2. GEREKLİ YASAL BELGELER
Şoför platformda iş yapabilmek için:
- Geçerli Sürücü Belgesi (Ehliyet),
- Mesleki Yeterlilik Belgesi (SRC 3 / SRC 4),
- Psikoteknik Raporu,
- K1 veya K2 Taşıma Yetki Belgesi,
- Zorunlu Trafik Sigortasını eksiksiz sağlamakla yükümlüdür.

3. TEKLİF VE GÜVENLİ TESLİMAT KURALI
- Kabul edilen teklif bağlayıcıdır. Keyfi iptaller hesap dondurma sebebidir.
- Taşıma tamamlandığında alıcıdan 6 haneli Güvenlik Teslimat Kodu alınarak sisteme girilmeli ve net bir Teslimat Kanıt Fotoğrafı yüklenmelidir.

4. KOMİSYON VE VERGİ
NakliyeGo her tamamlanan işten belirlenen oranda platform hizmet bedeli tahakkuk ettirir. Şoför kendi vergi ve fatura yükümlülüklerinden bizzat sorumludur.`,
  },

  customerTerms: {
    id: 'customerTerms',
    title: 'Müşteri Hizmet Koşulları',
    subtitle: 'Nakliye Talep ve Taşıma Standartları',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO MÜŞTERİ NAKLİYE HİZMET KOŞULLARI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. İLAN VE DOĞRU BEYAN
Müşteri eşyaların ağırlığı, ölçüleri, kırılganlık durumu, kat numarası ve asansör durumunu eksiksiz belirtmelidir. Eksik beyan sebebiyle oluşacak ilave iş gücü ve intikal maliyetleri müşteriye aittir.

2. AMBALAJ VE PAKETLEME
Eşyaların karayolu nakliyesine uygun koruyucu ambalajla paketlenmesi müşterinin sorumluluğundadır.

3. 6 HANELİ GÜVENLİK KODU KURALI
Müşteri, yük sağlam ve hasarsız teslim edilmeden önce güvenlik kodunu şoföre kesinlikle vermemelidir. Kodun verilmesi ve sisteme girilmesi eşyanın eksiksiz ve sağlam teslim alındığının yasal ibra beyanıdır.

4. KURUMSAL CÜZDAN
Kurumsal müşteriler onaylı bakiyelerini kullanarak faturalı nakliye hizmeti alabilirler.`,
  },

  dispute: {
    id: 'dispute',
    title: 'İptal ve Uyuşmazlık Prosedürü',
    subtitle: 'Şikâyet Yönetimi ve Hakemlik Esasları',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO İPTAL, ŞİKÂYET VE UYUŞMAZLIK PROSEDÜRÜ

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. İPTAL KURALLARI
- Teklif kabulü öncesi ilan iptali ücretsizdir.
- Şoför adrese intikal ettikten sonra müşterinin keyfi iptalinde şoförün asgari yol masrafı tazmin edilir.
- Şoförün haksız iptalinde ceza puanı ve hesap askıya alma uygulanır.

2. ŞİKÂYET KATEGORİLERİ
Uygulamada 'Profil > Destek > Şikâyet ve Öneri' menüsünden:
- Ödeme anlaşmazlığı,
- Hasar ve zayiat,
- Gelmeme (no-show),
- Yanlış yük beyanı,
- Güvenlik ve ahlaka aykırı davranış başlıklarında destek talebi açılabilir.

3. TÜKETİCİ HAKLARI
Uyuşmazlıklarda Tüketici Hakem Heyetleri ve Tüketici Mahkemelerine başvuru hakkı saklıdır.`,
  },

  retention: {
    id: 'retention',
    title: 'Veri Saklama ve İmha Politikası',
    subtitle: 'Saklama Süreleri ve Periyodik İmha Tablosu',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO KİŞİSEL VERİ SAKLAMA VE İMHA POLİTİKASI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. SAKLAMA SÜRELERİ
- Üyelik ve Kimlik Kayıtları: Hesap aktifliği + 10 yıl (TTK zamanaşımı)
- Fatura ve Mali Hareketler: 10 yıl (VUK m. 253, TTK m. 82)
- Taşıma ve Teslimat Kodları: 3 yıl (Karayolu Taşıma Kanunu ve zamanaşımı)
- Konum Kayıtları: Sefer tamamlandıktan sonra 3 yıl
- Sistem ve Erişim Logları: 2 yıl (5651 sayılı Kanun)
- Destek ve Şikâyet Kayıtları: 3 yıl

2. İMHA YÖNTEMLERİ
Süresi dolan veriler 6 ayda bir yapılan periyodik imha süreçlerinde güvenli silme, manyetik/kriptografik yok etme veya geri döndürülemez anonimleştirme yöntemleriyle imha edilir.`,
  },

  cookies: {
    id: 'cookies',
    title: 'Çerez ve Analitik Politikası',
    subtitle: 'Çerezler, Sentry ve PostHog Kullanım İlkeleri',
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_DATE,
    content: `NAKLİYEGO ÇEREZ VE ANALİTİK POLİTİKASI

Sürüm: 1.0.0 | Yürürlük: 14 Ekim 2026

1. KULLANILAN ÇEREZLER
Platformlarımızda yalnızca Zorunlu ve Güvenlik Çerezleri kullanılır. Reklam ve profil çıkarma çerezleri KULLANILMAZ.
- Oturum ve Yetkilendirme: Giriş durumunu koruyan güvenli anahtarlar (Keychain / Keystore).
- CSRF ve İstek Güvenliği Çerezleri.

2. TEKNİK İZLEME VE GİZLİLİK
- Sentry (Hata İzleme): Parola, token, telefon, e-posta ve açık adresler kod seviyesindeki PII filtresiyle temizlenir; yalnızca teknik hata yığını izlenir.
- PostHog (Ürün Analitiği): Yalnızca sözde-anonim kullanım metrikleri toplanır; kimlik bilgileri kesinlikle aktarılmaz.

3. TERCİH YÖNETİMİ
Web tarayıcınızdan veya cihazınızın uygulama ayarlarından izinleri yönetebilirsiniz.`,
  },
};
