// Mobil harita anahtarı istemci tarafında kısıtlanmış bir tanımlayıcıdır.
// These are public mobile SDK keys, restricted in Google Cloud by each app's
// package/bundle identifier. The server Places/Routes key is never bundled.
const validMobileKey = value => typeof value === 'string' && value !== '' && value === value.trim() && !/^['"]|['"]$/.test(value);
const publicMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const googleMapsIOSKey = [process.env.GOOGLE_MAPS_IOS_API_KEY, process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY, publicMapsKey].find(validMobileKey) || '';
const googleMapsAndroidKey = [process.env.GOOGLE_MAPS_ANDROID_API_KEY, process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY, publicMapsKey].find(validMobileKey) || '';
const expo = {
  name: 'NakliyeGo Şoför',
  slug: 'nakliyego-driver',
  version: '2.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.nakliyego.driver',
    ...(googleMapsIOSKey ? { config: { googleMapsApiKey: googleMapsIOSKey } } : {}),
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Yakındaki nakliye işlerini ve seçtiğiniz konumları gösterebilmek için konum izni gereklidir.',
      NSLocalNetworkUsageDescription: 'Nakliye uygulaması geliştirme sunucusuna bağlanmak için yerel ağ erişimi kullanır.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: 'com.nakliyego.driver',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
  },
  extra: { googleMapsConfigured: { ios: Boolean(googleMapsIOSKey), android: Boolean(googleMapsAndroidKey) } },
};

module.exports = {
  ...expo,
  scheme: expo.scheme || 'nakliyego-driver',
  plugins: [
    ...(expo.plugins || []),
    'expo-secure-store',
    'expo-font',
    '@react-native-community/datetimepicker',
    ['expo-image-picker', {
      photosPermission: 'Sohbette fotoğraf göndermek için galeri erişimi gerekir.',
      cameraPermission: 'Sohbette fotoğraf çekmek için kamera erişimi gerekir.',
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'Sohbette konum paylaşmak için konum erişimi gerekir.',
    }],
  ],
};
