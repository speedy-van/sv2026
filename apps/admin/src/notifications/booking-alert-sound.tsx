import * as Sentry from '@sentry/react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import newJobSound from '../../assets/sounds/new-job.wav';
import { AppText, Button } from '@/components/primitives';
import { claimNotificationSound } from './notification-sound-focus';

/** A foreground alert uses the same bundled sound as the APNs notification. */
export function BookingAlertSound(props: { alertId: string }): React.ReactElement | null {
  const player = useAudioPlayer(newJobSound);
  const audio = useAudioPlayerStatus(player);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const key = `${props.alertId}:${String(attempt)}`;
    if (played.current === key) return;
    const playback = { current: true };
    const isCurrent = (): boolean => playback.current;
    setFailed(false);
    if (!audio.isLoaded) {
      const timeout = setTimeout(() => {
        setFailed(true);
        Sentry.captureException(new Error('The bundled booking alert sound did not finish loading.'), {
          tags: { feature: 'admin-booking-alert-sound' },
        });
      }, 15_000);
      return () => {
        clearTimeout(timeout);
      };
    }
    const stop = (): void => {
      playback.current = false;
      try {
        player.pause();
      } catch (error) {
        Sentry.captureException(error, { tags: { feature: 'admin-booking-alert-sound-stop' } });
      }
    };
    const releaseFocus = claimNotificationSound(stop);
    void (async () => {
      // Respect the phone's silent setting; this is not a critical alert entitlement.
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: false,
        shouldPlayInBackground: false,
      });
      if (!isCurrent()) return;
      await player.seekTo(0);
      if (isCurrent()) {
        player.play();
        played.current = key;
      }
    })().catch((error: unknown) => {
      if (!playback.current) return;
      setFailed(true);
      Sentry.captureException(error, { tags: { feature: 'admin-booking-alert-sound' } });
    });
    return () => {
      releaseFocus();
      stop();
    };
  }, [attempt, audio.isLoaded, player, props.alertId]);
  useEffect(() => {
    if (audio.error && Platform.OS !== 'web') {
      setFailed(true);
      Sentry.captureException(new Error('The bundled booking alert sound could not be decoded or played.'), {
        tags: { feature: 'admin-booking-alert-sound' },
      });
    }
  }, [audio.error]);
  if (!failed || Platform.OS === 'web') return null;
  return (
    <>
      <AppText accessibilityRole="alert" size="sm" tone="danger">
        The booking alert sound could not play. You can still open this booking.
      </AppText>
      <Button
        label="Try alert sound again"
        tone="secondary"
        onPress={() => {
          try {
            if (!audio.isLoaded || audio.error) player.replace(newJobSound);
            setAttempt((current) => current + 1);
          } catch (error) {
            Sentry.captureException(error, { tags: { feature: 'admin-booking-alert-sound-retry' } });
          }
        }}
      />
    </>
  );
}
