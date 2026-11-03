import { act, render, waitFor } from '@testing-library/react-native';
import { focusManager, onlineManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Platform, Text } from 'react-native';
import { QueryRuntime } from '../src/state/query-runtime';

let mockState: string | null = null;
let mockAppChange: ((state: string) => void) | undefined;
let mockNetworkChange: ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) | undefined;
const mockRemove = jest.fn();
const mockUnsubscribe = jest.fn();
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() { return mockState; },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mockAppChange = listener;
      return { remove: mockRemove };
    },
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: typeof mockNetworkChange) => {
      mockNetworkChange = listener;
      return mockUnsubscribe;
    },
  },
}));

const clients: QueryClient[] = [];
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockState = null;
  mockAppChange = undefined;
  mockNetworkChange = undefined;
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  jest.clearAllMocks();
});
afterEach(() => {
  clients.splice(0).forEach(client => { client.clear(); });
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

function wrapper({ children }: PropsWithChildren): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return <QueryClientProvider client={client}><QueryRuntime />{children}</QueryClientProvider>;
}

it('does not suspend a cold launch whose native AppState is initially unknown', async () => {
  await render(<QueryRuntime />);
  expect(focusManager.isFocused()).toBe(true);
  await act(() => { mockAppChange?.('background'); });
  expect(focusManager.isFocused()).toBe(false);
  await act(() => { mockAppChange?.('active'); });
  expect(focusManager.isFocused()).toBe(true);
});

it('refreshes a stale real query immediately on foreground without remounting the screen', async () => {
  const request = jest.fn<Promise<string>, []>().mockResolvedValueOnce('First').mockResolvedValue('Updated');
  function Screen(): React.ReactElement {
    const query = useQuery({ queryKey: ['runtime-proof'], queryFn: request });
    return <Text>{query.data ?? 'Loading'}</Text>;
  }
  const view = await render(<Screen />, { wrapper });
  await waitFor(() => { expect(view.getByText('First')).toBeTruthy(); });
  await act(() => { mockAppChange?.('background'); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => { mockAppChange?.('active'); });
  await waitFor(() => { expect(view.getByText('Updated')).toBeTruthy(); });
  expect(request).toHaveBeenCalledTimes(2);
});

it('treats explicit disconnection as offline, and unknown reachability as inconclusive', async () => {
  const view = await render(<QueryRuntime />);
  await act(() => { mockNetworkChange?.({ isConnected: false, isInternetReachable: null }); });
  expect(onlineManager.isOnline()).toBe(false);
  await act(() => { mockNetworkChange?.({ isConnected: true, isInternetReachable: null }); });
  expect(onlineManager.isOnline()).toBe(true);
  await act(() => { mockNetworkChange?.({ isConnected: true, isInternetReachable: false }); });
  expect(onlineManager.isOnline()).toBe(false);
  await view.unmount();
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it('preserves the browser visibility and online event managers on web', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await render(<QueryRuntime />);
  expect(mockAppChange).toBeUndefined();
  expect(mockNetworkChange).toBeUndefined();
});
