import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenState } from '../src/components/screen-state';

describe('ScreenState', () => {
  it('renders loading, empty, error and ready states', async () => {
    const view = await render(<ScreenState status="loading" title="Bookings"><Text>Ready</Text></ScreenState>);
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();

    await view.rerender(<ScreenState emptyMessage="No jobs today." status="empty" title="Today"><Text>Ready</Text></ScreenState>);
    expect(view.getByText('No jobs today.')).toBeTruthy();

    await view.rerender(<ScreenState errorMessage="Could not load." status="error" title="Today"><Text>Ready</Text></ScreenState>);
    expect(view.getByText('Could not load.')).toBeTruthy();

    await view.rerender(<ScreenState title="Today"><Text>Ready</Text></ScreenState>);
    expect(view.getByText('Ready')).toBeTruthy();
  });
});
