import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NotificationPermissionGate } from '../src/components/notification-permission-gate';

describe('NotificationPermissionGate', () => {
  it('shows the child content when permission is granted', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ granted: true } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
    await render(<NotificationPermissionGate><Text>Dashboard</Text></NotificationPermissionGate>);
    await waitFor(() => { expect(screen.getByText('Dashboard')).toBeTruthy(); });
  });
});
