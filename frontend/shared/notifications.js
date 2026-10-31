import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const hasPermission = permission => permission.status === 'granted' || (Platform.OS === 'ios' && [Notifications.IosAuthorizationStatus.PROVISIONAL, Notifications.IosAuthorizationStatus.EPHEMERAL].includes(permission.ios?.status));

export async function registerDevicePushToken(api, isCurrent = () => true) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Bildirimler', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let permission = await Notifications.getPermissionsAsync();
  // Permission is requested only by the explicit account notification action.
  if (!hasPermission(permission) || !isCurrent()) return null;
  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Expo push projectId yapılandırılmamış.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!isCurrent()) return null;
  await api.register(token, Platform.OS, projectId);
  return token;
}

export async function unregisterDevicePushToken(api, token) {
  if (token) await api.unregister(token);
}

export function subscribeNotificationResponses(onData) {
  let active = true;
  const delivered = new Set();
  const deliver = response => {
    const data = response?.notification?.request?.content?.data;
    const id = response?.notification?.request?.identifier;
    const action = response?.actionIdentifier;
    if (action && action !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    if (active && id && !delivered.has(id) && ['load', 'conversation'].includes(data?.screen)) {
      delivered.add(id);
      onData(data);
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(deliver);
  Notifications.getLastNotificationResponseAsync().then(deliver).catch(() => {});
  return () => {
    active = false;
    subscription.remove();
  };
}

// Refresh after Settings changes/network recovery and APNs token rotation. Never
// interpret a notification/token as payment consent; screens fetch the load API.
export function subscribeDevicePushRegistration(api, onToken, onError) {
  let active = true;
  let inFlight = false;
  let lastToken = null;
  let pending = Promise.resolve();
  const refresh = () => {
    if (!active || inFlight) return;
    inFlight = true;
    pending = (async () => {
      try {
        const token = await registerDevicePushToken({ register: (candidate, platform, projectId) => {
          // A timed-out POST may have committed. Remember its token before the
          // request so logout can remove the binding even if its response is lost.
          lastToken = candidate;
          return api.register(candidate, platform, projectId);
        } }, () => active);
        // Preserve the binding when permission is revoked so logout can still
        // remove it. A null permission result does not unregister on the server.
        if (token) lastToken = token;
        if (active && token) onToken(token);
      } catch (error) { if (active) onError(error); }
      finally { inFlight = false; }
    })();
  };
  const foreground = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
  const rotation = Notifications.addPushTokenListener(refresh);
  refresh();
  let stopped = false;
  const stop = () => {
    active = false;
    if (!stopped) { stopped = true; foreground.remove(); rotation.remove(); }
    // Explicit logout awaits this before DELETE and before switching credentials:
    // an already dispatched POST cannot recreate the binding after the DELETE.
    return pending.then(() => lastToken);
  };
  stop.refresh = () => { refresh(); return pending.then(() => lastToken); };
  return stop;
}
