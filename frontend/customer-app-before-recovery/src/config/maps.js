import { Platform } from 'react-native';

const currentKey = Platform.select({
  ios: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
  android: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
  default: '',
}) || '';

const invalidKey = value => !value || value !== value.trim() || /^['"]|['"]$/.test(value);
const maskedKey = value => invalidKey(value) ? 'not-set' : `****${value.slice(-4)}`;

export const nativeGoogleMapsConfigured = !invalidKey(currentKey);
export const nativeGoogleMapsMessage = 'Google haritası yüklenemedi. Harita anahtarı ve uygulama yapılandırmasını kontrol edin.';

if (__DEV__) console.info(`[MAPS CONFIG] ${Platform.OS} key configured: ${nativeGoogleMapsConfigured}; suffix=${maskedKey(currentKey)}`);
