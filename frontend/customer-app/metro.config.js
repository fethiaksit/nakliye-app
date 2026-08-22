const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../shared')];
// Shared source has no node_modules ancestor. Pin its peer modules to this app
// so Metro never reaches a sibling application's React installation.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react-native-safe-area-context': path.resolve(__dirname, 'node_modules/react-native-safe-area-context'),
  'expo-clipboard': path.resolve(__dirname, 'node_modules/expo-clipboard'),
  'expo-image-picker': path.resolve(__dirname, 'node_modules/expo-image-picker'),
  'expo-location': path.resolve(__dirname, 'node_modules/expo-location'),
  'expo-constants': path.resolve(__dirname, 'node_modules/expo-constants'),
  '@expo/vector-icons': path.resolve(__dirname, 'node_modules/@expo/vector-icons'),
  '@react-native-community/datetimepicker': path.resolve(__dirname, 'node_modules/@react-native-community/datetimepicker'),
  'react-native-maps': path.resolve(__dirname, 'node_modules/react-native-maps'),
};

module.exports = config;
