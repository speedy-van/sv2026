import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  DISMISSED_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DISMISSED',
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
}));

jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(() => Promise.resolve({ isNew: false })),
  reloadAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('expo-audio', () => {
  const player = {
    pause: jest.fn(),
    play: jest.fn(),
    replace: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
  };
  return {
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    useAudioPlayer: jest.fn(() => player),
    useAudioPlayerStatus: jest.fn(() => ({ isLoaded: true, error: null })),
  };
});

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
}));

jest.mock('expo-constants', () => ({
  default: {
    deviceName: 'Test iPhone',
    expoConfig: { extra: { apiBaseUrl: 'https://api.example.test' } },
    sessionId: 'test-session',
  },
}));
