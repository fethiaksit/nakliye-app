# Beta ödeme onayı dağıtımı — 27 Ekim 2026

## Dağıtım

- Hedef: `https://beta-api-18-157-76-136.sslip.io`.
- Beta backend: `nakliye-beta-backend-1`, compose projesi `nakliye-beta`.
- İmaj: `nakliyego-beta:consent-20261027-152e3ce07526`.
- Sürüm: `consent-20261027-152e3ce07526`.
- Linux ARM64 binary SHA256: `152e3ce07526cd6f1b41575c4b01635642aa6651525d889194a419dac0804711`.
- Binary mevcut çalışma ağacından test sonrası derlendi; container içindeki binary hash'i aynı.
- Sadece backend `up -d --no-deps --no-build --pull never backend` ile yenilendi. Redis yeniden başlatılmadı; volume silinmedi, migration veya veri temizliği yapılmadı.
- `/health/ready` sağlıklı; herkese açık beta `/health` Redis hazır; yeni ödeme onayı route'u kimliksiz isteğe 401 dönüyor (önceki sürümde 404).
- Production backend ve Redis container kimlikleri, image kimlikleri, başlama zamanları ve mount'ları değişmedi. Production dağıtımı yapılmadı.

## Veri koruması

Sunucuda `/home/ubuntu/nakliye-beta/releases/consent-20261027/redis-before.rdb` (~103 MiB) RDB yedeği alındı. Yedek ve kontrol kayıtları yalnız sunucuda, erişimi kısıtlı dizinde saklanır. Eski compose release dosyası aynı dizinde `release-before.yml` olarak tutulur.

Deploy öncesi ve testlerden önceki deploy sonrası karşılaştırma: **793 → 793 anahtar, 763 kalıcı anahtar, kayıp kalıcı anahtar 0, içeriği değişen mevcut anahtar 0**. Redis ve production container'ları değişmedi. Test sonrası 906 anahtar var; kalıcı kayıt kaybı 0. Testler yeni hesap, nakliye ve denetim kayıtları oluşturdu. Sonraki kontrolde ortak aktivite/ilan indeksleri ile mevcut bir kullanıcının oturum/kullanıcı kaydı da değişmişti; bu nedenle test sonrasındaki verilerin tamamen aynı olduğu iddia edilmez. Deploy'un kendisi için birebir karşılaştırma temizdir.

## Gerçek beta API testi

Son başarılı test: `beta-consent-20261027-125653` (UTC; Türkiye 15:56:53). HTTPS beta adresinden, yeni ve açıkça test olarak adlandırılmış müşteri/şoför hesapları kullanıldı. Gerekli kurumsal onay ve test kredileri beta admin API'sinden verildi; mevcut müşteri/şoför cüzdanları kullanılmadı. Yönetim token'ı kısa ömürlü ve bellekte tutuldu; gizli anahtar veya oturum token'ı rapora yazılmadı.

- Teklif 4.100 TL, kredi 500 TL, müşteriden nakit 3.600 TL: bekleyen, atanmamış nakliye ve iki hesapta aynı ödeme planı.
- Onaysız `PATCH /api/loads/{id}/status`: **403**.
- Eski istemci alias'ı `/api/listings/{id}/status`: **403**.
- Admin durum geçişi, geçerli işlem notuyla: **409**.
- Ret: **200**, 500 TL iade; yinelenen ret **409**, ikinci iade yok.
- Tekrar seçim yeni onay kimliği üretir; eski kimlikle kabul **409**.
- Şoför kabulü **200**; ardından `driver_en_route` **200**.
- Test nakliyesi normal iptal API'siyle kapatıldı; kredi ve komisyon blokesi bırakılmadı.
- Gövdesiz eski istemci isteğiyle 0 TL kredi seçimi de onay bekliyor; onaysız başlatma **403**. Ret ve iptal başarılı.
- Müşteriye verilen geçici test kredisi denetimli admin düzeltmesiyle geri alındı; son müşteri test bakiyesi 0.
- İlk test scriptindeki yanlış admin endpoint'i 404 verdi; ardından cleanup scriptindeki `reason` yerine gerekli `note` alanı düzeltildi. Bu denemenin nakliyesi de iptal edilip müşteri test finansmanı geri alındı. Başarılı test doğru `/api/admin/loads/{id}/status` adresini kullanır.
- Beta'da teslimat/tamamlama yapılmadı. Tek seferlik teslimat kredi aktarımı önceki yerel testlerle doğrulandı; beta testi başlatma engeli, onay, ret/iade ve iptal kapsamındadır.

Makinece okunabilir sonuçlar: `beta-consent-20261027/api-results.json` ve `redis-deploy-audit.json`.

## iPhone / Expo

Bu özellikte yeni native modül, SDK veya app config değişikliği yok. Şoför `package.json` değişikliği yalnız test komutu; mevcut iOS/Pods değişiklikleri önceki derleme onarımlarıdır. Ödeme onayı için mevcut **development client** üzerinde native rebuild gerekmez. Repo içinde `expo-updates`/OTA dağıtımı yapılandırılmamış; JavaScript'i gömülü Release uygulaması Metro ile güncellenmez ve yeniden paketlenmelidir. 25 Ekim build kaydı Release paketlerinden söz eder; iPhone uygulama envanteri tek başına bugün kurulu paketin Debug/Release ayrımını kanıtlamaz.

İki `.env` dosyasının API hedefi beta. Eski 8081/8082 Metro süreçleri aynı müşteri projesini sunuyor ve bundle üretiminde `uv_cwd` hatası veriyordu. Eski süreçler kapatılıp doğru klasörlerden cache temizliğiyle başlatıldı:

```sh
cd /Volumes/KIOXIA/nakliye-app/frontend/customer-app
npm run start:dev-client -- --host lan --port 8081 --clear
```

```sh
cd /Volumes/KIOXIA/nakliye-app/frontend/driver-app
npm run start:dev-client -- --host lan --port 8082 --clear
```

Müşteri Metro 8081, şoför Metro 8082; manifest adları ayrı ayrı doğrulandı. Her iki iOS JavaScript bundle başarıyla üretildi; beta API adresi ve ilgili onay arayüzü/eylemleri bundle içinde doğrulandı. iPhone ve Mac aynı Wi-Fi'da olmalı, yerel ağ izni açık olmalı. Development launcher'dan müşteri için `http://192.168.111.7:8081`, şoför için `http://192.168.111.7:8082` açılıp Reload yapılmalı (Mac IP'si değişirse güncellenir). Telefon ekranında akışın çalıştırıldığı iddia edilmez; beta kabul testi HTTP API düzeyindedir.

Dağıtım öncesi `go test ./... -count=1` tüm paketlerde geçti. Gerçek Redis URL isteyen yerel test normal koşuda atlanır; beta testi gerçek beta Redis'i kullandı.
