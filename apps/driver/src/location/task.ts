import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { writeLocationPoint } from '@/offline/sqlite';

export const LOCATION_TASK_NAME = 'sv-driver-location';

export interface DriverLocationPoint {
  accuracyM: number;
  heading?: number;
  lat: number;
  lng: number;
  recordedAt: string;
  speedMps?: number;
}

export async function storeLocationPoint(point: DriverLocationPoint): Promise<void> {
  await writeLocationPoint(point);
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const payload = data as { locations?: Location.LocationObject[] };
  const location = payload.locations?.[0];
  if (!location) return;
  const point: DriverLocationPoint = {
    accuracyM: location.coords.accuracy ?? 0,
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    recordedAt: new Date(location.timestamp).toISOString()
  };
  if (location.coords.heading !== null) point.heading = location.coords.heading;
  if (location.coords.speed !== null) point.speedMps = location.coords.speed;
  await storeLocationPoint(point);
});

export async function startJobLocationTracking(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return;
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) return;
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.AutomotiveNavigation,
    deferredUpdatesDistance: 100,
    distanceInterval: 50,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: true,
    timeInterval: 30_000
  });
}

export async function stopJobLocationTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
}
