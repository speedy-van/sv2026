import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ScreenState } from '../src/components/screen-state';

describe('ScreenState', () => {
  it('renders loading, empty, error and ready states', async () => {
    const { rerender } = await render(<ScreenState status="loading" title="Bookings"><Text>Ready</Text></ScreenState>);
    expect(screen.getByTestId('screen-skeleton')).toBeTruthy();

    await rerender(<ScreenState emptyMessage="No jobs today." status="empty" title="Today"><Text>Ready</Text></ScreenState>);
    expect(screen.getByText('No jobs today.')).toBeTruthy();

    await rerender(<ScreenState errorMessage="Could not load." status="error" title="Today"><Text>Ready</Text></ScreenState>);
    expect(screen.getByText('Could not load.')).toBeTruthy();

    await rerender(<ScreenState title="Today"><Text>Ready</Text></ScreenState>);
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
