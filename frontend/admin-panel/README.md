# NakliyeGo Admin Paneli

Müşteri ve şoför mobil uygulamalarından ayrı çalışan web yönetim merkezidir.
Kimlik doğrulama yalnızca backend'deki `/api/admin/auth/login` üzerinden yapılır;
mobil access/refresh tokenları admin endpointlerinde kabul edilmez.

## Yerel çalıştırma

```bash
cp .env.example .env.local
npm ci
npm run dev
```

`NEXT_PUBLIC_ADMIN_API_URL`, admin API prefix'ini göstermelidir. Varsayılan değer
`http://localhost:8080/api/admin` olur.

## Doğrulama

```bash
npm test
npm run lint
```
