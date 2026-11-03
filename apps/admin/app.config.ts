import type { ExpoConfig } from 'expo/config';
import { resolveApiBaseUrl } from './src/lib/api-base-url.cjs';

const apiBaseUrl = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  process.env.EAS_BUILD_PROFILE === 'production' ||
    process.env.EAS_BUILD_PROFILE === 'production-store' || process.env.NODE_ENV === 'production',
);
const projectId: string =
  typeof process.env.EAS_PROJECT_ID === 'string'
    ? process.env.EAS_PROJECT_ID
    : '0dd0709d-309d-455c-8ad8-eeeb4550adca';
if (
  projectId &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId)
) {
  throw new Error('EAS_PROJECT_ID must be the valid ID of the SV Admin Expo project.');
}

const config: ExpoConfig = {
  name: 'SV Admin',
  slug: 'speedyvan-admin',
  owner: 'ahmadawadalwakai',
  scheme: 'speedyvan-admin',
  version: '1.0.1',
  icon: './assets/icon.png',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: 'co.uk.speedy-van.admin',
    buildNumber: '55',
    config: { usesNonExemptEncryption: false },
    icon: './assets/icon.png',
    supportsTablet: true,
    entitlements: {
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
    infoPlist: {
      NSFaceIDUsageDescription: 'Unlock Speedy Van admin actions with Face ID.',
    },
  },
  ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  extra: {
    ...(projectId ? { eas: { projectId } } : {}),
    apiBaseUrl,
  },
  plugins: [
    'expo-router',
    [
      'expo-notifications',
      {
        sounds: [
          './assets/sounds/new-job.wav',
          './assets/sounds/job-offer.wav',
          './assets/sounds/chat-message.wav',
        ],
      },
    ],
    'expo-secure-store',
    'expo-local-authentication',
    'expo-font',
  ],
};

export default config;
