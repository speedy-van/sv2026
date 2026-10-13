export interface NewJobAlert {
  bookingId: string;
  notificationId: string;
  pricePence: number;
  route: string;
  service: string;
  slot: string;
}

export function addAlerts(existing: readonly NewJobAlert[], incoming: readonly NewJobAlert[]): NewJobAlert[] {
  const byId = new Map(existing.map((alert) => [alert.notificationId, alert]));
  for (const alert of incoming) byId.set(alert.notificationId, alert);
  return [...byId.values()];
}

export function dismissAlert(existing: readonly NewJobAlert[], notificationId: string): NewJobAlert[] {
  return existing.filter((alert) => alert.notificationId !== notificationId);
}
