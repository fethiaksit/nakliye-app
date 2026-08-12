import { Platform } from 'react-native';
import Constants from 'expo-constants';

const configuredPlatforms = Constants.expoConfig?.extra?.googleMapsConfigured || {};
const isExpoGo = Constants.executionEnvironment === 'storeClient';
const platformConfigured = Boolean(configuredPlatforms[Platform.OS]);
export const nativeGoogleMapsConfigured = platformConfigured && !isExpoGo;
export const nativeGoogleMapsMessage = nativeGoogleMapsConfigured
  ? 'Harita yüklenemedi. Development build yapılandırmasını kontrol edin.'
  : isExpoGo
    ? 'Google Maps iOS/Android için Expo Go desteklenmez. Development build oluşturun.'
    : __DEV__
      ? `Google Maps ${Platform.OS === 'ios' ? 'iOS' : 'Android'} API key missing.`
      : 'Harita şu anda kullanılamıyor.';

if (__DEV__ && !nativeGoogleMapsConfigured) console.error(`[MAPS CONFIG] ${nativeGoogleMapsMessage}`);
