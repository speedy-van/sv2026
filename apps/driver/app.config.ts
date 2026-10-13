import type { ExpoConfig } from 'expo/config';

const apiBaseUrl: string = typeof process.env.EXPO_PUBLIC_API_BASE_URL === 'string'
  ? process.env.EXPO_PUBLIC_API_BASE_URL
  : 'http://127.0.0.1:3000';

const config: ExpoConfig = {
  name: 'Speedy Van Driver',
  slug: 'speedy-van-driver',
  scheme: 'speedyvan-driver',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: 'uk.speedyvan.driver',
    infoPlist: {
      NSCameraUsageDescription: 'Take job evidence photos.',
      NSFaceIDUsageDescription: 'Unlock the driver app.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Share job progress location while you are on an active move.',
      NSLocationWhenInUseUsageDescription: 'Share job progress location while you are on an active move.',
      NSPhotoLibraryUsageDescription: 'Attach job evidence photos.',
      UIBackgroundModes: ['location', 'remote-notification']
    }
  },
  updates: {
    url: 'https://u.expo.dev/00000000-0000-0000-0000-000000000014'
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#f4c542',
      foregroundImage: './assets/icon.png'
    },
    package: 'uk.speedyvan.driver'
  },
  plugins: [
    'expo-router',
    ['expo-notifications', { sounds: ['./assets/sounds/job-offer.wav'] }],
    ['expo-location', {
      isIosBackgroundLocationEnabled: true,
      locationAlwaysAndWhenInUsePermission: 'Speedy Van uses your location during active moves so customers and dispatch can see progress.',
      locationWhenInUsePermission: 'Speedy Van uses your location during active moves so customers and dispatch can see progress.'
    }],
    'expo-camera',
    'expo-sqlite',
    'expo-secure-store',
    'expo-local-authentication',
    'expo-font'
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    apiBaseUrl,
    eas: {
      projectId: '00000000-0000-0000-0000-000000000014'
    }
  }
};

export default config;
