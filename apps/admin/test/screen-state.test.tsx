import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenState } from '../src/components/screen-state';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdminHeaderInsetContext } from '../src/shell/admin-header-context';

describe('ScreenState', () => {
  it('keeps safe-area spacing once a persistent header consumes the top inset', async () => {
    const metrics = {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 44, left: 0, right: 0, bottom: 34 },
    };
    const content = (handled: boolean): React.ReactElement => (
      <SafeAreaProvider initialMetrics={metrics}>
        <AdminHeaderInsetContext value={handled}>
          <ScreenState title="Today">
            <Text>Ready</Text>
          </ScreenState>
        </AdminHeaderInsetContext>
      </SafeAreaProvider>
    );
    const view = await render(content(false));
    expect(view.getByTestId('screen-content')).toHaveStyle({ paddingTop: 68 });
    await view.rerender(content(true));
    expect(view.getByTestId('screen-content')).toHaveStyle({ paddingTop: 24 });
  });

  it('renders loading, empty, error and ready states', async () => {
    const view = await render(
      <ScreenState status="loading" title="Bookings">
        <Text>Ready</Text>
      </ScreenState>,
    );
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();

    await view.rerender(
      <ScreenState emptyMessage="No jobs today." status="empty" title="Today">
        <Text>Ready</Text>
      </ScreenState>,
    );
    expect(view.getByText('No jobs today.')).toBeTruthy();

    await view.rerender(
      <ScreenState errorMessage="Could not load." status="error" title="Today">
        <Text>Ready</Text>
      </ScreenState>,
    );
    expect(view.getByText('Could not load.')).toBeTruthy();

    await view.rerender(
      <ScreenState title="Today">
        <Text>Ready</Text>
      </ScreenState>,
    );
    expect(view.getByText('Ready')).toBeTruthy();
  });
});
