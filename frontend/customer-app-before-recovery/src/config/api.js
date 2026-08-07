const rawUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || '';

// Endpoint paths in the client include /api. Allow either host or host/api in .env
// and remove a final slash so /api/api and // combinations cannot be produced.
export const apiOrigin = rawUrl.replace(/\/+$/, '').replace(/\/api$/, '');
export const apiConfigurationError = !apiOrigin
  ? 'API adresi tanımlı değil. EXPO_PUBLIC_API_URL değerini bilgisayarının yerel IP adresiyle ayarla.'
  : !/^https?:\/\/[^/]+/i.test(apiOrigin)
    ? 'API adresi http://SUNUCU_IP:8080 biçiminde olmalıdır.'
    : '';
export const healthUrl = apiOrigin ? `${apiOrigin}/health` : '';
