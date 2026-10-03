# Şehir içi yük taşıma fiyatı — city-v2

Bu tarife, İzmir için önerilen başlangıç değerleriyle hesaplanan bir **referans tahmindir**. Kabul edilen şoför teklifi kesin tutarı belirler. Fiyat aralığı istatistiksel bir piyasa güven aralığı değildir; önerilen tutarın %90–%115 bandıdır. Canlı yakıt verisi veya otomatik piyasa doğrulaması kullanılmaz.

| Araç | Taban (ilk 5 km dahil) | Sonraki km | Hesaplama kapasitesi |
|---|---:|---:|---|
| Minivan | 1.250 TL | 35 TL | 500 kg / 4 m³ |
| Panelvan | 1.600 TL | 45 TL | 1.200 kg / 13 m³ |
| Kamyonet | 2.100 TL | 60 TL | 3.000 kg / 18 m³ |
| Kamyon | 3.250 TL | 85 TL | 12.000 kg / 60 m³ |

Kapasiteler araç seçimi ve doluluk için varsayımsal sınıf değerleridir; gerçek aracın ruhsatına veya fiziksel uygunluğuna dair garanti değildir. Kamyon için üst sınır, başlangıç uygulama varsayımıdır. “Uygun aracı sistem önersin” seçimi, hem ağırlık hem hacmi karşılayan en küçük sınıfı kullanır. Özellikle seçilen daha büyük araç korunur; küçük araç yetersizse tahmin uygun sınıfa yükseltilir ve müşteri özetinde önerilen araç gösterilir. Normal sınıflarda ilan ve şoför filtreleri bu etkin sınıfı kullanır; orijinal tercih `requestedVehicleType` alanında korunur. Açık/kapalı kasa ve TIR gereksinimleri değiştirilmez. Açık/kapalı kasa kamyonet tarifesine eşlenir. Sınıf aralarındaki boşluklarda bir üst araç kullanılır.

```text
Doluluk = max(toplam kg / sınıf kg kapasitesi, toplam m³ / sınıf hacmi)
0–%50: 1.00; >%50–%75: 1.08; >%75–%90: 1.15; >%90: 1.25

Ara tutar = taban + max(0, km - 5) × km bedeli + taşıma yardımı + iki adresin kat bedeli
Tahmin = 50 TL'ye yuvarla(ara tutar × doluluk × saat × aciliyet + bekleme)
Aralık = 50 TL'ye yuvarla(tahmin × 0.90), 50 TL'ye yuvarla(tahmin × 1.15)
```

- Müşteri yükler/indirir: yardım ücreti yok. Şoför yardım eder: iş başına 400 TL (iki adres için iki kez alınmaz).
- Bir yardımcı: 900 TL; iki: 1.700 TL. Üçüncü ve sonraki her yardımcı: +800 TL. Yardımcı varsa ayrıca şoför yardım bedeli alınmaz. Mevcut uygulamanın 1–20 yardımcı desteği korunur.
- Kat bedeli her adreste ayrı: 1–2. kat 250 TL; 3–4. kat 500 TL; 5+ kat 800 TL. Müşteri sorumluluğunda veya eşyaya uygun asansör varsa bedel yok. Zemin ve bodrum katları için ek bedel yok.
- Yardımcı talebinde, belirtilmemiş yükleme/boşaltma sorumluluğu ekip olarak varsayılır. Açıkça “müşteri” seçilmiş adresin kat bedeli alınmaz.
- Türkiye saati: 07.00–19.00 ×1.00, 19.00–23.00 ×1.10, 23.00–07.00 ×1.20. Önceki öneride boş kalan 07.00–08.00 normal tarifeye dahil edilir.
- Hemen / planlı başlangıca en fazla 2 saat: ×1.20. Bugün / aynı gün 2 saatten sonrası: ×1.10. İkisi birlikte uygulanmaz. “Bugün” saat belirtmediğinden gece katsayısı varsayılmaz.
- Mevcut bekleme desteği korunur: ilk 30 dakika ücretsiz, 31–60 dakika 300 TL, 61–120 dakika 600 TL; sonraki başlayan her saat +400 TL. Bu ek bedel çarpanlardan sonra eklenir.
- Paketleme, montaj, forklift ve özel hizmetler otomatik tarifeye dahil değildir; şoför teklifine konu olur.
- Komple ev, TIR ve kamyon üst kapasitesini aşan yüklerde `manualQuoteRequired: true`; önerilen fiyat/aralık sıfırdır ve uygulama **Özel teklif gerekli** gösterir. Küçük yük fiyatıyla evden eve fiyatı uydurulmaz.

Toplam hacim `dimensions.volumeM3` üzerinden alınır. Yoksa `lengthCm × widthCm × heightCm / 1.000.000` kullanılır. Eksik fiziksel veride mevcut 50 kg / 1 m³ varsayımı korunur ve müşteri ekranında belirtilir. Kullanıcının toplam yük hacmini girmesi önemlidir.

## API ve kayıtlar

`POST /api/pricing/estimate` müşteri kimlik doğrulaması ister. Gövdesi `/api/loads` oluşturma gövdesiyle aynıdır; adresler/ara duraklar sunucuda Google rota servisiyle hesaplanır. İlan veya durum kaydı oluşturmaz. Yanıt `PricingSnapshot` nesnesidir. Müşterinin km fiyatı, hesapladığı fiyat veya çarpanlar kabul edilmez.

Önizleme ve ilan oluşturma/güncelleme aynı motoru kullanır. Anlık saat veya Google rota sonucu değişirse yeni tahmin değişebilir. Müşteri özeti, değişen formun eski yanıtını kullanmaz. Tahmin hatasında yeniden deneme sunar.

`pricing` kaydı tarife sürümünü, araç sınıfını, dahil km, doluluk, yardım/kat ücretlerini, saat/aciliyet katsayılarını ve önerilen fiyat/aralığı saklar. Eski kayıtlar yeniden fiyatlanmaz. Şema eklemeleri Redis JSON kayıtlarıyla geriye uyumludur. Yeni ilanlarda `agreedPriceTl` teklif kabul edilene kadar 0 kalır; kabul edilen teklif, referans aralığının dışında da olabilir.

## Dağıtım

Backend ve iki Expo uygulamasının güncellenmesi gerekir. Backend önce yayınlanmalıdır; yeni müşteri uygulaması `/api/pricing/estimate` uç noktasını kullanır. Backend yeniden derlenip yeniden başlatılmalıdır. Native bağımlılık eklenmemiştir.

Eski `BASE_DRIVER_FEE` / `PRICE_PER_KM` değişkenleri bu tarifeyi artık değiştirmez. Yeni opsiyonel değişkenler:

```dotenv
MINIVAN_BASE_FEE=1250
MINIVAN_PRICE_PER_KM=35
PANELVAN_BASE_FEE=1600
PANELVAN_PRICE_PER_KM=45
KAMYONET_BASE_FEE=2100
KAMYONET_PRICE_PER_KM=60
KAMYON_BASE_FEE=3250
KAMYON_PRICE_PER_KM=85
```

Yazılmazlarsa tabloda belirtilen değerler kullanılır.

## Örnekler (normal saat, aciliyet yok)

- 10 km minivan, müşteri taşır: 1.250 + 5 × 35 = 1.425 → **1.450 TL**.
- 22 km panelvan, şoför yardımcı: 1.600 + 17 × 45 + 400 = 2.765 → **2.750 TL**.
- 35 km kamyonet, 2.000 kg, müşteri taşır: (2.100 + 30 × 60) × 1.08 = 4.212 → **4.200 TL**.

Doğrulama: `cd backend && go test ./... && go vet ./...`; `cd frontend/customer-app && npm test`; iki uygulama için `npx expo export --platform ios` JavaScript paket kontrolü. iOS native imzalama/cihaz derlemesi bu Linux ortamında çalıştırılmaz.
