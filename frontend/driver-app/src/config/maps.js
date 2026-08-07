import { Platform } from 'react-native';

const currentKey = Platform.select({
  ios: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  android: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  default: '',
}) || '';

const invalidKey = value => !value || value !== value.trim() || /^['"]|['"]$/.test(value);
export const nativeGoogleMapsConfigured = !invalidKey(currentKey);
export const nativeGoogleMapsMessage = nativeGoogleMapsConfigured
  ? 'Harita yüklenemedi. Development build yapılandırmasını kontrol edin.'
  : 'Google Maps API anahtarı tanımlı değil. .env içine EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ekleyin.';
