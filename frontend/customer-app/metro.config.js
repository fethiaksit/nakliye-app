const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  path.resolve(__dirname, '../shared'),
];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  expo: path.resolve(__dirname, 'node_modules/expo'),
  'expo-constants': path.resolve(__dirname, 'node_modules/expo-constants'),
  'expo-notifications': path.resolve(__dirname, 'node_modules/expo-notifications'),
  'react-native-safe-area-context': path.resolve(__dirname, 'node_modules/react-native-safe-area-context'),
  'expo-clipboard': path.resolve(__dirname, 'node_modules/expo-clipboard'),
  'expo-image-picker': path.resolve(__dirname, 'node_modules/expo-image-picker'),
  'expo-location': path.resolve(__dirname, 'node_modules/expo-location'),
  '@expo/vector-icons': path.resolve(__dirname, 'node_modules/@expo/vector-icons'),
  '@react-native-community/datetimepicker': path.resolve(__dirname, 'node_modules/@react-native-community/datetimepicker'),
  'react-native-maps': path.resolve(__dirname, 'node_modules/react-native-maps'),
};

module.exports = config;
