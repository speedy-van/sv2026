const sqliteRuns: unknown[][] = [];

jest.mock('expo-sqlite', () => ({
  __sqliteRuns: sqliteRuns,
  openDatabaseAsync: jest.fn(() => Promise.resolve({
    execAsync: jest.fn(() => Promise.resolve()),
    runAsync: jest.fn((...args: unknown[]) => {
      sqliteRuns.push(args);
      return Promise.resolve();
    })
  }))
}));

const mockManipulate = jest.fn(() => ({
  resize: jest.fn().mockReturnThis(),
  renderAsync: jest.fn(() => Promise.resolve({
    saveAsync: jest.fn((options: unknown) => Promise.resolve({
      height: 900,
      options,
      uri: 'file://photo.jpg?compressed=1',
      width: 1600
    }))
  }))
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: mockManipulate },
  SaveFormat: { JPEG: 'jpeg' },
  __manipulate: mockManipulate
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn()
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 1 },
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  hasStartedLocationUpdatesAsync: jest.fn(() => Promise.resolve(false)),
  requestBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  startLocationUpdatesAsync: jest.fn(() => Promise.resolve()),
  stopLocationUpdatesAsync: jest.fn(() => Promise.resolve())
}));

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn()
}));

jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(() => Promise.resolve({ isNew: false })),
  reloadAsync: jest.fn(() => Promise.resolve())
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn()
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve())
}));

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true }))
}));

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn(() => Promise.resolve({ granted: true }))])
}));

jest.mock('expo-constants', () => ({
  default: {
    deviceName: 'Test iPhone',
    expoConfig: { extra: { apiBaseUrl: 'https://api.example.test' } },
    sessionId: 'test-session'
  }
}));
