import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * FR-18 — push registration on native.
 *
 * Expo Push sits in front of APNs and FCM, so there are no certificates or
 * service accounts to manage here. Permission is requested at first check-in,
 * never at launch: a refusal on the launch screen is permanent, and by the
 * time someone taps "I'm on my way" the notification has an obvious purpose.
 */

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      // shouldShowAlert is the field this SDK version requires; the banner and
      // list flags are the newer split and are set alongside it.
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'android') {
    // Android needs a channel before anything will display.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Dinner updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;

  if (!granted && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  // Declining is a supported outcome, not a failure: everything still works,
  // you just have to open the app to see it.
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId === undefined ? {} : { projectId },
    );
    return token.data;
  } catch {
    // Missing EAS project, simulator without push support, or a network
    // failure. None of these should block checking in.
    return null;
  }
}
