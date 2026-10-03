# Changelog

## Şehir içi fiyatlandırma (city-v2)

- Araç, doluluk, yardım, kat/asansör ve zaman bazlı merkezi referans tarifesi eklendi; ilk 5 km tabana dahil.
- Müşteri özeti ve ilan oluşturma aynı backend motorunu kullanıyor; serbest şoför teklifi korunuyor.
- Komple ev, TIR ve kapasite dışı işler özel teklif gerektiriyor.
- Dağıtım ve yeni ortam değişkenleri: [Şehir içi fiyatlandırma](city-pricing.md).

## 2.0.0

- Added authenticated registration, login, refresh, logout and secure token persistence.
- Added listing lifecycle, offers, messages, photo upload and soft-delete API flows.
- Added `/api/health`, `/api/listings` and driver job API compatibility routes.
- Normalized mobile API URL handling and added development connection diagnostics.
- Upgraded password storage to Argon2id for newly registered users.
