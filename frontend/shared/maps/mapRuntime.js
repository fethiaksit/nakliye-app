import Constants from 'expo-constants';

// react-native-maps is bundled with the Expo SDK used by Expo Go.  The old
// implementation skipped the require in Expo Go altogether, which meant a
// real iPhone could never show a map even when the installed package matched
// the SDK.  We still guard the require so an actually incompatible custom
// client fails visibly and does not take down the screen.
export const isExpoGo = Constants.executionEnvironment === 'storeClient';

let nativeMaps;
let attemptedNativeMapsLoad = false;

export function getNativeMaps() {
  if (attemptedNativeMapsLoad) return nativeMaps || null;
  attemptedNativeMapsLoad = true;
  try {
    // This require intentionally stays inside the non-Expo-Go branch. Metro
    // can bundle it for a development build without evaluating the native
    // TurboModule in Expo Go.
    nativeMaps = require('react-native-maps');
  } catch (error) {
    nativeMaps = null;
    if (__DEV__) console.warn('[MAPS] Native map module is unavailable in this build.', error?.message);
  }
  return nativeMaps || null;
}

export function hasCoordinate(location) {
  return Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
}

export function directionsURL(pickup, dropoff) {
  if (!hasCoordinate(pickup) || !hasCoordinate(dropoff)) return '';
  const origin = `${Number(pickup.latitude)},${Number(pickup.longitude)}`;
  const destination = `${Number(dropoff.latitude)},${Number(dropoff.longitude)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
