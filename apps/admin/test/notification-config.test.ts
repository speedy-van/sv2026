import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import config from '../app.config';

it('uses the production EAS environment and public HTTPS API for the internal production build', () => {
  const value: unknown = JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8'));
  const profiles = z.object({ build: z.object({
    production: z.object({
      channel: z.literal('production'), node: z.literal('24.7.0'), environment: z.literal('production'), distribution: z.literal('internal'),
      env: z.object({ EXPO_PUBLIC_API_BASE_URL: z.literal('https://www.speedyvan.uk') }),
    }),
    development: z.object({ env: z.object({ EXPO_PUBLIC_API_BASE_URL: z.literal('http://127.0.0.1:3000') }) }),
    preview: z.object({ env: z.object({ EXPO_PUBLIC_API_BASE_URL: z.literal('https://staging.speedyvan.uk') }) }),
  }) }).parse(value);
  expect(profiles.build.production.env.EXPO_PUBLIC_API_BASE_URL).toBe('https://www.speedyvan.uk');
});

it('links one valid admin EAS identity to its update URL and custom notification asset', () => {
  const extra: unknown = config.extra;
  const metadata = z.object({ eas: z.object({ projectId: z.uuid() }) }).parse(extra);
  expect(config.owner).toBe('ahmadawadalwakai');
  expect(config.slug).toBe('speedyvan-admin');
  expect(config.ios?.bundleIdentifier).toBe('co.uk.speedy-van.admin');
  expect(config.version).toBe('1.0.1');
  expect(config.ios?.buildNumber).toBe('55');
  expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
  expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  expect(config.updates?.url).toBe(`https://u.expo.dev/${metadata.eas.projectId}`);
  const plugins = z.array(z.union([z.string(), z.tuple([z.string(), z.unknown()])])).parse(config.plugins);
  const notifications = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications');
  if (!Array.isArray(notifications)) throw new Error('Notification plugin is missing.');
  const options = z.object({ sounds: z.array(z.string()) }).parse(notifications[1]);
  expect(options.sounds).toContain('./assets/sounds/new-job.wav');
  expect(options.sounds).toContain('./assets/sounds/chat-message.wav');
  expect(config.ios?.entitlements?.['com.apple.developer.usernotifications.time-sensitive']).toBe(true);
});

it('targets the existing admin App Store record for TestFlight while retaining the internal production profile', () => {
  const value: unknown = JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8'));
  const profiles = z.object({
    build: z.object({
      production: z.object({ channel: z.literal('production'), distribution: z.literal('internal') }),
      'production-store': z.object({
        extends: z.literal('production'), environment: z.literal('production'), distribution: z.literal('store'),
      }),
    }),
    submit: z.object({ 'production-store': z.object({ ios: z.object({ ascAppId: z.literal('6812268357') }) }) }),
  }).parse(value);
  expect(profiles.build['production-store'].extends).toBe('production');
  expect(profiles.submit['production-store'].ios.ascAppId).toBe('6812268357');
  expect(config.ios?.bundleIdentifier).toBe('co.uk.speedy-van.admin');
});

it.each(['new-job.wav', 'chat-message.wav'])('bundles %s as non-silent PCM audio below the iOS custom-notification duration limit', (filename) => {
  const bytes = readFileSync(resolve(__dirname, `../assets/sounds/${filename}`));
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
  let format: Buffer | undefined;
  let samples: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error('The WAV asset contains an incomplete chunk.');
    if (name === 'fmt ') format = bytes.subarray(start, start + size);
    if (name === 'data') samples = bytes.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || format.length < 16 || !samples) throw new Error('The WAV asset is incomplete.');
  expect(format.readUInt16LE(0)).toBe(1); // Uncompressed linear PCM.
  expect(format.readUInt16LE(2)).toBe(1);
  expect(format.readUInt16LE(14)).toBe(16);
  const byteRate = format.readUInt32LE(8);
  expect(byteRate).toBeGreaterThan(0);
  const duration = samples.length / byteRate;
  expect(duration).toBeGreaterThan(0);
  expect(duration).toBeLessThan(30);
  expect(samples.some((value) => value !== 0)).toBe(true);
});

it('uses the same owner sound for booking, chat and the admin browser preview', () => {
  const booking = readFileSync(resolve(__dirname, '../assets/sounds/new-job.wav'));
  expect(readFileSync(resolve(__dirname, '../assets/sounds/chat-message.wav')).equals(booking)).toBe(true);
  expect(readFileSync(resolve(__dirname, '../public/sounds/chat-message.wav')).equals(booking)).toBe(true);
});
