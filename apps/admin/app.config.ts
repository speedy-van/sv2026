import type { ExpoConfig } from 'expo/config';

const apiBaseUrl: string = typeof process.env.EXPO_PUBLIC_API_BASE_URL === 'string'
  ? process.env.EXPO_PUBLIC_API_BASE_URL
  : 'http://127.0.0.1:3000';

const config: ExpoConfig = {
  name: 'SV Admin',
  slug: 'speedyvan-admin',
  scheme: 'speedyvan-admin',
  version: '1.0.0',
  icon: './assets/icon.png',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: 'uk.speedyvan.admin',
    icon: './assets/icon.png',
    supportsTablet: true,
    entitlements: {
      'com.apple.developer.usernotifications.time-sensitive': true
    },
    infoPlist: {
      NSFaceIDUsageDescription: 'Unlock Speedy Van admin actions with Face ID.'
    }
  },
  updates: {
    url: 'https://u.expo.dev/00000000-0000-0000-0000-000000000013'
  },
  extra: {
    eas: {
      projectId: '00000000-0000-0000-0000-000000000013'
    },
    apiBaseUrl
  },
  plugins: [
    'expo-router',
    [
      'expo-notifications',
      {
        sounds: ['./assets/sounds/new-job.wav', './assets/sounds/job-offer.wav']
      }
    ],
    'expo-secure-store',
    'expo-local-authentication',
    'expo-font'
  ]
};

export default config;
