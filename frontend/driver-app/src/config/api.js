const rawUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || '';
export const API_PREFIX = '/api';
export const apiOrigin = rawUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
export const apiConfigurationError = !apiOrigin ? 'API adresi tanımlı değil. EXPO_PUBLIC_API_URL değerini bilgisayarının yerel IP adresiyle ayarla.' : !/^https?:\/\/[^/]+(?:\/api)?\/?$/i.test(rawUrl) ? 'API adresi http://SUNUCU_IP:8080 veya http://SUNUCU_IP:8080/api biçiminde olmalıdır.' : '';
export const healthUrl = apiOrigin ? `${apiOrigin}/health` : '';
