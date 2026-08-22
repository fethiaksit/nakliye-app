# Nakliye Platformu

Tek Go API'sine bağlanan iki Expo/React Native uygulamasından oluşur:

- `frontend/customer-app`: ilan oluşturan müşteri uygulaması
- `frontend/driver-app`: yayınlanmış ilanları ve tekliflerini yöneten şoför uygulaması
- `backend`: kullanıcı, ilan, teklif, fotoğraf ve mesaj verilerini Redis'te kalıcı tutan API

API'nin tek uygulama prefix'i `/api`'dir. Health endpoint'i `GET /health` olarak prefix dışında tutulur.

## Gereksinimler

- Go 1.25 veya üzeri
- Redis 7 veya üzeri
- Node.js 20 ya da 22 (Node 23+ kullanmayın)
- Fiziksel cihaz ve geliştirme bilgisayarı için aynı yerel ağ
- Faturalandırması etkin bir Google Cloud projesi ve kısıtlanmış Google Maps anahtarları

## Backend

```bash
cd backend
cp .env.example .env
```

`.env` içindeki `JWT_SECRET` değerini en az 32 karakterlik rastgele bir değerle değiştirin. Örneğin:

```bash
openssl rand -base64 48
```

Redis'i mevcut kurulumunuzla veya Docker ile başlatın:

```bash
docker compose up -d redis
```

Ardından API'yi tek komutla çalıştırın:

```bash
cd backend
go run ./cmd/api
```

Başlangıçta environment, port, Google Maps server yapılandırma durumu ve Redis bağlantısı doğrulanır; secret değerleri loglanmaz. Sağlık kontrolü:

```bash
curl http://localhost:8080/health
```

Başarılı yanıt en az `{"status":"ok"}` içerir. Redis erişilemiyorsa endpoint `503` ve standart hata gövdesi döndürür.

## Fiziksel cihaz API adresi

Bilgisayarın yerel ağ adresini bulun (örneğin `192.168.1.40`) ve her iki aktif uygulamada `.env` oluşturun:

```bash
cd frontend/customer-app
cp .env.example .env

cd ../driver-app
cp .env.example .env
```

Her iki dosyada da kendi IP adresinizi kullanın:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.X:8080/api
```

Fiziksel cihazda `localhost` ve `127.0.0.1` cihazın kendisini gösterir; backend bilgisayarda çalışıyorsa bu adresleri kullanmayın. URL host olarak da (`http://192.168.1.X:8080`) `/api` eklenmiş olarak da verilebilir; istemci tek `/api` prefix'ine normalize eder.

Bilgisayar firewall'ında TCP `8080` portunun yerel ağdan erişilebilir olduğundan emin olun. Cihaz tarayıcısından `http://192.168.1.X:8080/health` açılmadan uygulama testine geçmeyin.

## Customer app

```bash
cd frontend/customer-app
npm ci
npm run ios -- --device # veya: npm run android -- --device
# Development client cihaza kurulduktan sonraki çalıştırmalar:
npm start
```

## Driver app

```bash
cd frontend/driver-app
npm ci
npm run ios -- --device # veya: npm run android -- --device
# Development client cihaza kurulduktan sonraki çalıştırmalar:
npm start
```

## Web admin paneli

Admin paneli `frontend/admin-panel` altında ayrı bir web uygulamasıdır. Mobil
uygulamaların JWT ve refresh tokenları admin endpointlerinde kabul edilmez.
Backend `.env` dosyasında aşağıdaki bağımsız kimliği tanımlayın:

```env
ADMIN_EMAIL=operations@example.com
ADMIN_PASSWORD=replace-with-a-strong-admin-password
ADMIN_JWT_SECRET=replace-with-a-different-32-character-secret
```

Production'da düz `ADMIN_PASSWORD` yerine Argon2id biçimindeki
`ADMIN_PASSWORD_HASH` kullanılabilir. `ADMIN_JWT_SECRET`, mobil `JWT_SECRET`
değerinden farklı olmalıdır. Admin değişkenleri boş bırakılırsa mevcut mobil API
çalışmaya devam eder, ancak admin girişi güvenli biçimde kapalı kalır.

Paneli yerelde başlatmak için:

```bash
cd frontend/admin-panel
cp .env.example .env.local
npm ci
npm run dev
```

Panel; dashboard, kullanıcı engelleme/aktifleştirme, şoför-belge-araç
doğrulama, ilan ve durum geçmişi, mesaj şikâyeti inceleme, günlük hareketler ve
sistem istatistiklerini `/api/admin` üzerinden yönetir.

Repository içindeki opsiyonel Node kurulumu kullanılacaksa, kök dizinde zsh ile şunu source edin:

```bash
source frontend/activate-node.zsh
```

## Expo Go ve development build

Aktif bağımlılık sürümleri Expo SDK 54 ile uyumludur: React Native 0.81.5 ve `react-native-maps@1.20.1`. iOS Expo Go yalnızca MapKit/Apple Maps binary'sini sunduğundan uygulama Expo Go'da harita açmaz ve development build gerektiğini açıkça gösterir. Apple Maps fallback yoktur. Bütün native haritalar `provider={PROVIDER_GOOGLE}` ile çalışır; adres/rota verisi yalnız Google backend servislerinden gelir.

`react-native-maps@1.20.1` için SDK 54'ün yerleşik `ios.config.googleMapsApiKey` ve `android.config.googleMaps.apiKey` yapılandırması `app.config.js` tarafından environment'tan üretilir. Native anahtar veya config değişikliğinden sonra development build gerekir:

```bash
cd frontend/customer-app # veya frontend/driver-app
npx expo prebuild --clean
npx expo run:ios --device
# veya
npx expo run:android --device
```

Native paket ya da `app.config.js` değiştikten sonra eski development client'ı kullanmayın; yeniden build edin. `RNMapsAirModule could not be found` hatası çoğunlukla JavaScript paketleriyle cihazdaki eski native binary'nin eşleşmediğini gösterir. Expo'nun resmi dokümanları: [react-native-maps / SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/map-view/) ve [development build kullanımı](https://docs.expo.dev/develop/development-builds/use-development-builds/).

## Harita servisleri

Google Cloud Console'da faturalandırmayı ve şu servisleri etkinleştirin:

- Maps SDK for iOS
- Maps SDK for Android
- Places API (New)
- Geocoding API
- Routes API

Backend `.env` yalnız server anahtarını içerir:

```env
GOOGLE_MAPS_SERVER_API_KEY=your_server_key
```

Server anahtarını Places API (New), Geocoding API ve Routes API ile; üretimde mümkünse backend çıkış IP'siyle kısıtlayın. Bu anahtar mobil bundle'a eklenmez. `GOOGLE_MAPS_API_KEY` eski kurulumlar için uyumlu alias olarak okunur, yeni kurulumlarda açık isimli `GOOGLE_MAPS_SERVER_API_KEY` kullanılmalıdır.

Gerçek iOS/Android development build'lerinde Google tabanlı native harita kullanılırsa mobil uygulamaların `.env` dosyalarındaki aşağıdaki anahtarlar public native SDK kimlikleridir; bundle/package ID ile kısıtlayın:

```env
GOOGLE_MAPS_ANDROID_API_KEY=your_android_maps_key
GOOGLE_MAPS_IOS_API_KEY=your_ios_maps_key
```

- Customer: `com.nakliyego.customer`
- Driver: `com.nakliyego.driver`

Android anahtarını ilgili package ID + imzalama SHA-1 değeriyle ve yalnız Maps SDK for Android'e; iOS anahtarını ilgili bundle ID ile ve yalnız Maps SDK for iOS'a kısıtlayın. Server anahtarı yoksa fake sonuç veya başka provider üretilmez; API kontrollü servis hatası verir.

Backend uçları:

- `GET /api/maps/places/autocomplete?input=&session_token=&lat=&lng=` — Türkiye (`TR`), Türkçe ve opsiyonel konum bias'lı autocomplete
- `GET /api/maps/places/:placeId?session_token=` — adres, koordinat ve Google address component çözümleme
- `POST /api/maps/reverse-geocode` — seçilen koordinatı Google açık adresine dönüştürme
- `POST /api/maps/routes/calculate` — Google Routes ile sürüş rotası
- `GET /api/maps/status` — yalnız yapılandırma durumunu kontrol eder; Google'a istek göndermez ve ücret oluşturmaz

Google `formattedAddress` ana gösterim değeridir. Pickup ve delivery altında koordinat/placeId ile birlikte `street`, `streetNumber`, `neighborhood`, `district`, `city`, `province`, `postalCode`, `country` ve `countryCode` mevcutsa saklanır. Repository'nin gerçek persistence katmanı Redis'tir; PostgreSQL schema/migration dizini yoktur. Yeni JSON alanları eski Redis ilanlarıyla geriye uyumludur.

Eski Redis kayıtlarında Google dışı rota kalmışsa, server anahtarını ayarladıktan sonra önce dry-run, ardından kontrollü uygulama çalıştırın:

```bash
cd backend
go run ./cmd/routebackfill
go run ./cmd/routebackfill --apply
```

## Doğrulama komutları

```bash
cd backend
go test ./...
go build ./...

cd ../frontend/customer-app
npm test
npx expo export --platform ios --output-dir /tmp/nakliye-customer-export
npx expo-doctor

cd ../driver-app
npx expo export --platform ios --output-dir /tmp/nakliye-driver-export
npx expo-doctor

cd ../admin-panel
npm test
npm run lint
```

Frontend kaynakları JavaScript/JSX'tir; repository'de TypeScript config'i olmadığı için `tsc --noEmit` uygulanmaz. Metro export, JSX çözümleme ve bundle doğrulaması olarak kullanılır.

## Faz 0 kabul akışı

1. Customer kayıt ve giriş yapar.
2. Başlangıç ve varışı ayrı ayrı seçer, fotoğraf ekler, ilanı yayınlar.
3. İlan `İlanlarım` listesinde görünür.
4. Driver kayıt ve giriş yapar, açık ilanı görür ve teklif gönderir.
5. Customer teklifi kabul eder; tekil konuşma oluşturulur.
6. Driver ve customer mesaj gönderir; mesajlar Redis'te kalır ve uygulama/API yeniden başladıktan sonra tekrar yüklenir.

Geçici ağ kesintisi oturumu silmez. Yalnızca refresh token'ın backend tarafından açıkça reddedildiği `400/401` durumlarında session temizlenir.
