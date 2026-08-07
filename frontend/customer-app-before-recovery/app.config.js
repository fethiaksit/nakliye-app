const app = require('./app.json');

// Google Maps SDK keys are public mobile identifiers, not backend secrets.
// Keep the key in the Expo environment and restrict it by bundle/package ID
// and to the Maps SDKs in the Google Cloud Console.
const validMobileKey = value => typeof value === 'string' && value !== '' && value === value.trim() && !/^['"]|['"]$/.test(value);
const maskedKey = value => validMobileKey(value) ? `****${value.slice(-4)}` : 'not-set';
const googleMapsIOSKey = validMobileKey(process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY) ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY : '';
const googleMapsAndroidKey = validMobileKey(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY) ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY : '';
const expo = app.expo;
const mapsPluginOptions = {};
if (googleMapsIOSKey) mapsPluginOptions.iosGoogleMapsApiKey = googleMapsIOSKey;
if (googleMapsAndroidKey) mapsPluginOptions.androidGoogleMapsApiKey = googleMapsAndroidKey;
const mapsPlugin = Object.keys(mapsPluginOptions).length
  ? [['react-native-maps', mapsPluginOptions]]
  : [];

if (process.env.NODE_ENV !== 'production') {
  console.log(`[MAPS CONFIG] iOS key configured: ${Boolean(googleMapsIOSKey)}; suffix=${maskedKey(process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY)}`);
  console.log(`[MAPS CONFIG] Android key configured: ${Boolean(googleMapsAndroidKey)}; suffix=${maskedKey(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY)}`);
}

module.exports = {
  ...expo,
  plugins: [
    ...(expo.plugins || []),
    ...mapsPlugin,
    ['expo-image-picker', {
      photosPermission: 'Nakliye ilanınıza fotoğraf eklemek için galeri erişimi gerekir.',
      cameraPermission: 'Nakliye ilanınız için fotoğraf çekmek üzere kamera erişimi gerekir.',
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'Başlangıç konumunuzu seçmek için konum erişimi gerekir.',
    }],
  ],
};
