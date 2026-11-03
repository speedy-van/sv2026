import { act, fireEvent, render } from '@testing-library/react-native';
import { ExpoRoot } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { getMockContext } from 'expo-router/testing-library';
import { DeviceEventEmitter, Text } from 'react-native';
import { AdminTabBar } from '../src/components/admin-tab-bar';

let mockWidth = 320;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 667, scale: 2, fontScale: 1 }),
}));

function Navigation(): React.ReactElement {
  return (
    <Tabs
      tabBar={(props) => <AdminTabBar {...props} chatUnreadCount={2} />}
      screenOptions={{ headerShown: false, animation: 'none' }}
    />
  );
}

const context = getMockContext({
  _layout: Navigation,
  today: () => <Text>Today content</Text>,
  'bookings/index': () => <Text>Bookings content</Text>,
  schedule: () => <Text>Schedule content</Text>,
  'drivers/index': () => <Text>Drivers content</Text>,
  more: () => <Text>More content</Text>,
});

async function keyboard(show: boolean): Promise<void> {
  await act(() => {
    DeviceEventEmitter.emit(show ? 'keyboardWillShow' : 'keyboardWillHide', {
      duration: 0,
      easing: 'keyboard',
      endCoordinates: { screenY: show ? 377 : 667, height: show ? 290 : 0, screenX: 0, width: mockWidth },
    });
  });
}

beforeEach(() => {
  mockWidth = 320;
});

describe('custom admin navigation keyboard behavior', () => {
  it('releases the phone tab bar space while typing and restores working navigation after keyboard dismissal', async () => {
    const view = await render(<ExpoRoot context={context} location={new URL('speedyvan-admin:///today')} />);
    expect(view.getByRole('tab', { name: 'Today' })).toBeTruthy();
    await keyboard(true);
    expect(view.queryByRole('tab', { name: 'Today' })).toBeNull();
    expect(view.getByText('Today content')).toBeTruthy();
    await keyboard(false);
    expect(view.getByRole('tab', { name: 'More, 2 unread chat messages' })).toBeTruthy();
    await fireEvent.press(view.getByRole('tab', { name: 'Bookings' }));
    expect(view.getByText('Bookings content')).toBeTruthy();
  });

  it('keeps the iPad side navigation available when the keyboard opens', async () => {
    mockWidth = 1194;
    const view = await render(<ExpoRoot context={context} location={new URL('speedyvan-admin:///today')} />);
    await keyboard(true);
    expect(view.getByRole('tab', { name: 'Today' })).toBeTruthy();
    expect(view.getByText('Admin workspace')).toBeTruthy();
    await keyboard(false);
  });
});
