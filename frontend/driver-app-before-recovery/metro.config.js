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
  'expo-clipboard': path.resolve(__dirname, 'node_modules/expo-clipboard'),
  'expo-image-picker': path.resolve(__dirname, 'node_modules/expo-image-picker'),
  'expo-location': path.resolve(__dirname, 'node_modules/expo-location'),
  'react-native-maps': path.resolve(__dirname, 'node_modules/react-native-maps'),
};

module.exports = config;
