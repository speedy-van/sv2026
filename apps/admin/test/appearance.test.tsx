import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import MoreScreen from '../app/(app)/more';
import { theme, useAppAppearance, useAppColors, useAppColorScheme } from '../src/theme/theme';

let mockSystemScheme: 'light' | 'dark' | null = 'light';
const mockSignOut = jest.fn(() => Promise.resolve());

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    signOut: mockSignOut,
    status: 'signed-in',
    user: {
      email: 'appearance@example.test',
      id: 'appearance-test',
      name: 'Appearance Test',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  }),
}));

function ThemeProbe(): React.ReactElement {
  const { preference } = useAppAppearance();
  const scheme = useAppColorScheme();
  const colors = useAppColors();
  return (
    <View testID="outside-theme" style={{ backgroundColor: colors.background }}>
      <Text>{`${preference}/${scheme}`}</Text>
    </View>
  );
}

function Workspace(): React.ReactElement {
  return (
    <>
      <MoreScreen />
      <ThemeProbe />
    </>
  );
}

beforeEach(async () => {
  mockSystemScheme = 'light';
  mockSignOut.mockClear();
  const reset = await renderHook(useAppAppearance);
  await act(() => {
    reset.result.current.setPreference('system');
  });
  await reset.unmount();
});

describe('session appearance preference', () => {
  it('defaults to System and follows OS changes while it remains selected', async () => {
    const view = await render(<Workspace />);
    expect(view.getByRole('tab', { name: 'System', selected: true })).toBeTruthy();
    expect(view.getByText('system/light')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.colors.background });
    mockSystemScheme = 'dark';
    await view.rerender(<Workspace />);
    expect(view.getByText('system/dark')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.darkColors.background });
  });

  it('switches the actual shared palette to Dark without changing the OS preference', async () => {
    const view = await render(<Workspace />);
    await fireEvent.press(view.getByRole('tab', { name: 'Dark' }));
    expect(view.getByRole('tab', { name: 'Dark', selected: true })).toBeTruthy();
    expect(view.getByRole('tab', { name: 'System', selected: false })).toBeTruthy();
    expect(view.getByText('dark/dark')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.darkColors.background });
    expect(mockSystemScheme).toBe('light');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('can explicitly select Light on a dark device and restore System afterwards', async () => {
    mockSystemScheme = 'dark';
    const view = await render(<Workspace />);
    await fireEvent.press(view.getByRole('tab', { name: 'Light' }));
    expect(view.getByText('light/light')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.colors.background });
    await fireEvent.press(view.getByRole('tab', { name: 'System' }));
    expect(view.getByText('system/dark')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.darkColors.background });
  });

  it('keeps the session choice when More unmounts and makes the scope clear', async () => {
    const view = await render(<Workspace />);
    expect(
      view.getByText('Choose a look for this session. System follows your device settings.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('tab', { name: 'Dark' }));
    await view.rerender(<ThemeProbe />);
    expect(view.getByText('dark/dark')).toBeTruthy();
    await view.rerender(<Workspace />);
    expect(view.getByRole('tab', { name: 'Dark', selected: true })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('uses a light default if the device does not provide a colour scheme', async () => {
    mockSystemScheme = null;
    const view = await render(<ThemeProbe />);
    expect(view.getByText('system/light')).toBeTruthy();
    expect(view.getByTestId('outside-theme')).toHaveStyle({ backgroundColor: theme.colors.background });
  });
});
