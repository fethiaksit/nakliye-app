# Nakliye Platformu

Tek Go API'sine bağlanan iki React uygulamasından oluşan başlangıç projesi:

- `frontend/customer-app`: yük ilanı oluşturan müşteri uygulaması
- `frontend/driver-app`: açık ilanları görüp kabul eden şoför uygulaması
- `backend`: Redis üzerinde ilan, teklif/kabul ve mesaj verilerini tutan API

## Çalıştırma

1. Redis'i başlatın: `docker compose up -d redis`
2. API: `cd backend && go run ./cmd/api`
3. Müşteri: `cd frontend/customer-app && npm install && npm run dev`
4. Şoför: `cd frontend/driver-app && npm install && npm run dev`

API `0.0.0.0:8080` üzerinde dinler. Simülatörde `http://localhost:8080` kullanılabilir; fiziksel cihaz için her mobil uygulamanın `.env` dosyasına bilgisayarın yerel ağ IP'sini yazın:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:8080
```

İstemci, URL'ye yanlışlıkla `/api` eklense bile bunu normalize eder; istek yollarında çift `/api/api` oluşmaz. Geliştirme modundaki giriş ekranında API bağlantısını `/api/health` ile kontrol eden bir araç da bulunur.

## Google Maps Platform kurulumu

Rota, adres ve konum verileri yalnızca backend üzerinden Google Maps Platform’dan alınır. Mobil uygulamalara server anahtarı gönderilmez.

Google Cloud Console’da aynı faturalandırma hesabına şu API’leri etkinleştirin:

- Maps SDK for Android
- Maps SDK for iOS
- Places API (New)
- Geocoding API
- Routes API

`backend/.env` içine yalnızca sunucuda kalan anahtarı ekleyin:

```env
GOOGLE_MAPS_API_KEY=your_server_maps_key
```

Müşteri ve şoför uygulamalarının kendi `.env` dosyalarına, sırasıyla Android ve iOS Maps SDK anahtarlarını ekleyin:

```env
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=your_android_maps_key
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=your_ios_maps_key
```

Android anahtarını hem `com.nakliyego.customer` hem `com.nakliyego.driver` paketleri için SHA-1 uygulama imzası ile; iOS anahtarını `com.nakliyego.customer` ve `com.nakliyego.driver` bundle ID’leriyle kısıtlayın. Server anahtarını yalnızca Places API (New), Geocoding API ve Routes API ile, üretimde mümkünse API sunucusunun IP adresiyle kısıtlayın.

Backend uçları şunlardır:

- `GET /api/maps/places/autocomplete?input=&session_token=` — Places API (New) autocomplete
- `GET /api/maps/places/:placeId` — Place Details
- `POST /api/maps/reverse-geocode` — Google Geocoding
- `POST /api/maps/routes/calculate` — Google Routes `computeRoutes`

Rota sonucu Google’ın sürüş mesafesi ve süresinden hesaplanır: `distance_meters / 1000 × PRICE_PER_KM`. Varsayılan `PRICE_PER_KM=200` TL’dir. İlanlarda Google encoded polyline, çözülmüş koordinatlar, mesafe, süre, kilometre ücreti ve `routeProvider: "google"` saklanır; şoför ekranı bunları yeniden hesaplamadan kullanır.

Google anahtarı tanımlı değilse uygulama sahte veri üretmez; harita backend’i kullanıcıya kontrollü “Harita servisine şu anda ulaşılamıyor.” hatasını döndürür. Native Google Maps görünümü için SDK anahtarlarını ekledikten sonra Expo development/production build’i yeniden oluşturun; Expo Go, iOS tarafındaki native Google Maps anahtar yapılandırmasını temsil etmez.

Önceki geliştirme kayıtları Redis’te OSRM rotasıyla kalmışsa, server anahtarını ekledikten sonra bir kez şu kontrollü komutu çalıştırın. Komut yalnızca `routeProvider !== "google"` olan kayıtları günceller ve kabul edilmiş işlerin anlaşılmış teklif fiyatını değiştirmez:

```bash
cd backend
go run ./cmd/routebackfill --apply
```
