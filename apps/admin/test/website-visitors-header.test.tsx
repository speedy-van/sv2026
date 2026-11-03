import { act, fireEvent, render } from '@testing-library/react-native';
import type { AdminVisitorPresenceResponse } from '@sv/contracts';
import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { WebsiteVisitorsHeader } from '../src/components/website-visitors-header';
import { theme } from '../src/theme/theme';

jest.mock('../src/data/visitor-presence', () => ({ useVisitorPresence: () => mockPresence }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));
jest.mock('react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo', () => ({
  __esModule: true, default: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: (_event: string, listener: (reduced: boolean) => void) => {
      mockMotionListener = listener;
      return { remove: jest.fn() };
    },
  },
}));
let mockScheme: 'light' | 'dark' = 'light';
let mockMotionListener: ((reduced: boolean) => void) | undefined;
const mockRefetch = jest.fn(() => Promise.resolve());
function presenceState() {
  return {
    actorId: 'test-admin', authorized: true, foreground: true, offline: false, outdated: false,
    query: {
      data: { activeVisitors: 7, generatedAt: '2031-10-15T12:00:00.000Z', activeWindowSeconds: 90, measurement: 'consenting-browsers' } as AdminVisitorPresenceResponse | undefined,
      isPending: false, isFetching: false, isError: false, refetch: mockRefetch,
    },
  };
}
let mockPresence = presenceState();
interface AnimationControl {
  value: Animated.Value;
  toValue: number;
  stop: jest.Mock;
  finish(): void;
}
const animations: AnimationControl[] = [];

beforeEach(() => {
  mockPresence = presenceState(); mockRefetch.mockClear(); mockScheme = 'light'; animations.length = 0;
  jest.replaceProperty(Platform, 'OS', 'web');
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  mockMotionListener = undefined;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    if (!(value instanceof Animated.Value) || typeof config.toValue !== 'number') throw new Error('Expected a scalar count animation.');
    let callback: ((result: { finished: boolean }) => void) | undefined;
    const control: AnimationControl = {
      value, toValue: config.toValue, stop: jest.fn(),
      finish() { value.setValue(this.toValue); callback?.({ finished: true }); },
    };
    animations.push(control);
    return { start: (onEnd) => { callback = onEnd; }, stop: control.stop, reset: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); });

async function motionReady(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe('website visitor header', () => {
  it('renders the first real count directly, with a compact pill and a 48-point target', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    const badge = view.getByRole('button', { name: /Visitors now: 7\./ });
    expect(badge).toHaveStyle({ minHeight: 48, minWidth: 48 });
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('7');
    expect(Animated.timing).not.toHaveBeenCalled();
    expect(view.getByText('Analytics opt-in')).toBeTruthy();
  });

  it('distinguishes a genuine zero from loading and unavailable data', async () => {
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 0 };
    const view = await render(<WebsiteVisitorsHeader />);
    expect(view.getByRole('button', { name: /Visitors now: 0\./ })).toBeTruthy();
    mockPresence.query.data = undefined; mockPresence.query.isPending = true;
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByRole('button', { name: 'Visitors now, loading.' })).toBeTruthy();
    expect(view.getByTestId('visitor-count-skeleton')).toBeTruthy();
    expect(view.queryByTestId('visitor-count', { includeHiddenElements: true })).toBeNull();
    mockPresence.query.isPending = false; mockPresence.query.isError = true;
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByRole('button', { name: 'Visitors now, unavailable.' })).toBeTruthy();
    expect(view.queryByTestId('visitor-count-skeleton')).toBeNull();
  });

  it('explains a genuine zero without claiming that no one is browsing the website', async () => {
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 0 };
    const view = await render(<WebsiteVisitorsHeader />);
    expect(view.getByText('Analytics opt-in')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: /Visitors now: 0\./ }));
    expect(view.getByText(/A zero does not mean the website is empty/)).toBeTruthy();
    expect(view.getByText('Updates every 15 seconds while this app is open, unlocked and online.')).toBeTruthy();
  });

  it('explains measurement limits, timing and the checked timestamp in a labelled dialog', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    await fireEvent.press(view.getByRole('button', { name: /Visitors now: 7\./ }));
    expect(view.getByRole('header', { name: 'Website visitors' })).toBeTruthy();
    expect(view.getByText(/Counts consenting browser sessions active within the last 90 seconds/)).toBeTruthy();
    expect(view.getByText(/not an exact count of people/)).toBeTruthy();
    expect(view.getByText('Updates every 15 seconds while this app is open, unlocked and online.')).toBeTruthy();
    expect(view.getByText(/Last checked: 15 Oct 2031/)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));
    expect(view.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('offers a real retry for unavailable data without displaying a fake zero', async () => {
    mockPresence.query.data = undefined; mockPresence.query.isError = true;
    const view = await render(<WebsiteVisitorsHeader />);
    await fireEvent.press(view.getByRole('button', { name: 'Visitors now, unavailable.' }));
    expect(view.getByRole('alert')).toHaveTextContent('The visitor count is unavailable. Refresh to try again.');
    await fireEvent.press(view.getByRole('button', { name: 'Refresh count' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'background', 'failed', 'old'] as const)('labels the last count honestly when %s', async (condition) => {
    mockPresence.outdated = true;
    if (condition === 'offline') mockPresence.offline = true;
    if (condition === 'background') mockPresence.foreground = false;
    if (condition === 'failed') mockPresence.query.isError = true;
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    const status = condition === 'offline' ? 'Offline' : condition === 'background' ? 'Paused' : condition === 'failed' ? 'Unavailable' : 'Out of date';
    const badge = view.getByRole('button', { name: new RegExp(`Visitors now: 7\\. ${status}; last count shown`) });
    expect(view.getByText(`Last count · ${status}`)).toBeTruthy();
    await fireEvent.press(badge);
    const refresh = view.getByRole('button', { name: 'Refresh count' });
    if (condition === 'offline' || condition === 'background') expect(refresh).toBeDisabled();
  });

  it('does not render private counts when the session is locked or signed out', async () => {
    mockPresence.authorized = false;
    const view = await render(<WebsiteVisitorsHeader />);
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByTestId('visitor-count', { includeHiddenElements: true })).toBeNull();
  });

  it('counts upward and downward while exposing only each final count to screen readers', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 12 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(animations[0]?.toValue).toBe(12);
    expect(animations[1]?.toValue).toBe(0);
    await act(() => { animations[0]?.value.setValue(9); });
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('9');
    expect(view.getByRole('button', { name: /Visitors now: 12\./ })).toBeTruthy();
    expect(view.getByTestId('visitor-count-animation', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
    await act(() => { animations[0]?.finish(); animations[1]?.finish(); });
    mockPresence.query.data = { ...mockPresence.query.data, activeVisitors: 3 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(animations[2]?.toValue).toBe(3);
    await act(() => { animations[2]?.finish(); animations[3]?.finish(); });
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('3');
    expect(view.getByRole('button', { name: /Visitors now: 3\./ })).toBeTruthy();
    expect(jest.mocked(Animated.timing).mock.calls.every(([, config]) => !config.isInteraction)).toBe(true);
    expect(jest.mocked(Animated.timing).mock.calls.every(([, config]) => !config.useNativeDriver)).toBe(true);
  });

  it('stops old animations and settles at the latest value during rapid changes', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 20 };
    await view.rerender(<WebsiteVisitorsHeader />);
    await act(() => { animations[0]?.value.setValue(11); });
    mockPresence.query.data = { ...mockPresence.query.data, activeVisitors: 4 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(animations[0]?.stop).toHaveBeenCalledTimes(1);
    expect(animations[1]?.stop).toHaveBeenCalledTimes(1);
    expect(animations[2]?.toValue).toBe(4);
    await act(() => { animations[2]?.finish(); animations[3]?.finish(); });
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('4');
  });

  it('renders updates immediately with reduced motion and responds to preference changes', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 11 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('11');
    expect(Animated.timing).not.toHaveBeenCalled();
    const listener = mockMotionListener;
    if (!listener) throw new Error('Expected a reduced-motion subscription.');
    await act(() => { listener(false); });
    mockPresence.query.data = { ...mockPresence.query.data, activeVisitors: 8 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(animations[0]?.toValue).toBe(8);
    await act(() => { listener(true); });
    expect(animations[0]?.stop).toHaveBeenCalled();
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('8');
  });

  it('starts an account’s first number directly instead of animating from another account', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.actorId = 'other-admin';
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 2 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('2');
    expect(Animated.timing).not.toHaveBeenCalled();
  });

  it('uses a native transform driver on iOS while keeping the displayed count in JavaScript', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 9 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(jest.mocked(Animated.timing).mock.calls[0]?.[1].useNativeDriver).toBe(false);
    expect(jest.mocked(Animated.timing).mock.calls[1]?.[1].useNativeDriver).toBe(true);
    await act(() => { animations[0]?.finish(); animations[1]?.finish(); });
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('9');
  });

  it('keeps exact non-animated counts if the reduced-motion preference cannot be read', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(new Error('Preference unavailable'));
    const view = await render(<WebsiteVisitorsHeader />);
    await motionReady();
    mockPresence.query.data = { ...mockPresence.query.data as AdminVisitorPresenceResponse, activeVisitors: 4 };
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByTestId('visitor-count', { includeHiddenElements: true })).toHaveTextContent('4');
    expect(Animated.timing).not.toHaveBeenCalled();
  });

  it('uses the shared light and dark surfaces and keeps text scalable', async () => {
    const view = await render(<WebsiteVisitorsHeader />);
    expect(view.getByTestId('visitor-presence-pill')).toHaveStyle({ backgroundColor: theme.colors.surfaceMuted });
    expect(view.getByText('Visitors now').props.allowFontScaling).not.toBe(false);
    mockScheme = 'dark';
    await view.rerender(<WebsiteVisitorsHeader />);
    expect(view.getByTestId('visitor-presence-pill')).toHaveStyle({ backgroundColor: theme.darkColors.surfaceMuted });
    expect(view.getByText('Visitors now')).toHaveStyle({ color: theme.darkColors.text });
  });
});
