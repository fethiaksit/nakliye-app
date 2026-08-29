import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function registerDevicePushToken(api) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Bildirimler', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'undetermined') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;
  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api.register(token, Platform.OS);
  return token;
}

export async function unregisterDevicePushToken(api, token) {
  if (token) await api.unregister(token);
}

export function subscribeNotificationResponses(onData) {
  let active = true;
  const deliver = response => {
    const data = response?.notification?.request?.content?.data;
    if (active && data?.screen) {
      onData(data);
      void Notifications.clearLastNotificationResponseAsync();
    }
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(deliver);
  Notifications.getLastNotificationResponseAsync().then(deliver).catch(() => {});
  return () => {
    active = false;
    subscription.remove();
  };
}
