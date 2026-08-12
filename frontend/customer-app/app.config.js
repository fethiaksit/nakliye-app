// Google Maps SDK keys are public mobile identifiers, not backend secrets.
// Keep the key in the Expo environment and restrict it by bundle/package ID
// and to the Maps SDKs in the Google Cloud Console.
const validMobileKey = value => typeof value === 'string' && value !== '' && value === value.trim() && !/^['"]|['"]$/.test(value);
const publicMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const googleMapsIOSKey = [process.env.GOOGLE_MAPS_IOS_API_KEY, process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY, publicMapsKey].find(validMobileKey) || '';
const googleMapsAndroidKey = [process.env.GOOGLE_MAPS_ANDROID_API_KEY, process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY, publicMapsKey].find(validMobileKey) || '';
const expo = {
  name: 'NakliyeGo Müşteri',
  slug: 'nakliyego-customer',
  version: '2.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.nakliyego.customer',
    ...(googleMapsIOSKey ? { config: { googleMapsApiKey: googleMapsIOSKey } } : {}),
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Yakındaki nakliye işlerini ve seçtiğiniz konumları gösterebilmek için konum izni gereklidir.',
      NSLocalNetworkUsageDescription: 'Nakliye uygulaması geliştirme sunucusuna bağlanmak için yerel ağ erişimi kullanır.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: 'com.nakliyego.customer',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
  },
  extra: { googleMapsConfigured: { ios: Boolean(googleMapsIOSKey), android: Boolean(googleMapsAndroidKey) } },
};

module.exports = {
  ...expo,
  scheme: expo.scheme || 'nakliyego-customer',
  plugins: [
    ...(expo.plugins || []),
    'expo-secure-store',
    ['expo-image-picker', {
      photosPermission: 'Nakliye ilanınıza fotoğraf eklemek için galeri erişimi gerekir.',
      cameraPermission: 'Nakliye ilanınız için fotoğraf çekmek üzere kamera erişimi gerekir.',
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'Başlangıç konumunuzu seçmek için konum erişimi gerekir.',
    }],
  ],
};
