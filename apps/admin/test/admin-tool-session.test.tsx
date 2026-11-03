import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import type { PropsWithChildren } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { z } from 'zod';
import { useAdminToolAction } from '../src/data/admin-tool-action';
import { penceToInput, poundsToPence } from '../src/data/admin-tool-forms';
import { useAdminToolSession } from '../src/data/admin-tool-session';

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: mockApi,
    status: mockStatus,
    appLocked: mockLocked,
    user: { id: mockUser, role: mockRole },
  }),
}));
let mockFocused = true;
let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockStatus = 'signed-in';
let mockLocked = false;
let mockUser = 'admin-one';
let mockRole = 'ADMIN';
const mockRequest = jest.fn<Promise<unknown>, [string, unknown]>();
const mockApi = { request: mockRequest };
const clients: QueryClient[] = [];
const appListeners = new Set<(status: AppStateStatus) => void>();
function wrapper({ children }: PropsWithChildren): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockStatus = 'signed-in';
  mockLocked = false;
  mockUser = 'admin-one';
  mockRole = 'ADMIN';
  mockRequest.mockResolvedValue({ ok: true });
  jest.replaceProperty(Platform, 'OS', 'ios');
  appListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appListeners.add(listener);
    return {
      remove: () => {
        appListeners.delete(listener);
      },
    };
  });
});
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  jest.restoreAllMocks();
});

it('blocks requests whenever the account is locked, offline, unfocused or unauthorized', async () => {
  const { result, rerender } = await renderHook(useAdminToolSession, { wrapper });
  const schema = z.object({ ok: z.boolean() });
  expect(result.current.enabled).toBe(true);
  mockLocked = true;
  await rerender(undefined);
  await expect(result.current.request('/private', schema)).rejects.toThrow('unlock');
  mockLocked = false;
  mockNetwork.isInternetReachable = false;
  await rerender(undefined);
  await expect(result.current.request('/private', schema)).rejects.toThrow('online');
  mockNetwork.isInternetReachable = true;
  mockFocused = false;
  await rerender(undefined);
  await expect(result.current.request('/private', schema)).rejects.toThrow('unlock');
  mockFocused = true;
  mockRole = 'DRIVER';
  await rerender(undefined);
  expect(result.current.privateReady).toBe(false);
  await expect(result.current.request('/private', schema)).rejects.toThrow('unlock');
  expect(mockRequest).not.toHaveBeenCalled();
});

it('discards a response from a previous account even when the request succeeds', async () => {
  let finish: ((value: unknown) => void) | undefined;
  mockRequest.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = await renderHook(useAdminToolSession, { wrapper });
  const promise = result.current.request('/private', z.object({ ok: z.boolean() }));
  const rejected = expect(promise).rejects.toThrow('active session changed');
  mockUser = 'admin-two';
  await rerender(undefined);
  finish?.({ ok: true });
  await rejected;
});

it('requires successful device confirmation and rejects deferred confirmation after account lock', async () => {
  let confirm: ((value: LocalAuthentication.LocalAuthenticationResult) => void) | undefined;
  jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  const { result, rerender } = await renderHook(
    () => {
      const session = useAdminToolSession();
      return useAdminToolAction(session);
    },
    { wrapper },
  );
  const mutation = jest.fn(() => Promise.resolve(true));
  let action: Promise<boolean | undefined> | undefined;
  await act(() => {
    action = result.current.run(mutation, { authenticate: 'Confirm refund' });
  });
  mockLocked = true;
  await rerender(undefined);
  await act(async () => {
    confirm?.({ success: true });
    await action;
  });
  expect(mutation).not.toHaveBeenCalled();
  expect(result.current.message).toBeNull();
});

it('serializes rapid commands and reports the result only once', async () => {
  let finish: ((value: boolean) => void) | undefined;
  const mutation = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await renderHook(
    () => {
      const session = useAdminToolSession();
      return useAdminToolAction(session);
    },
    { wrapper },
  );
  let first: Promise<boolean | undefined> | undefined;
  await act(async () => {
    first = result.current.run(mutation, { success: 'Saved' });
    await result.current.run(mutation);
  });
  expect(mutation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.(true);
    await first;
  });
  expect(result.current.message).toBe('Saved');
});

it('waits for active after Face ID temporarily makes the app inactive, then sends one confirmed command', async () => {
  let confirm: ((value: LocalAuthentication.LocalAuthenticationResult) => void) | undefined;
  jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  const { result } = await renderHook(
    () => {
      const session = useAdminToolSession();
      return { session, action: useAdminToolAction(session) };
    },
    { wrapper },
  );
  const identityRevision = result.current.session.identityRevision;
  const mutation = jest.fn(() => Promise.resolve(true));
  let pending: Promise<boolean | undefined> | undefined;
  await act(() => {
    pending = result.current.action.run(mutation, {
      authenticate: 'Confirm refund',
      success: 'Refund requested',
    });
  });
  await act(() => {
    appListeners.forEach((listener) => {
      listener('inactive');
    });
  });
  expect(result.current.session.enabled).toBe(false);
  expect(result.current.session.identityRevision).toBe(identityRevision);
  await act(() => {
    confirm?.({ success: true });
  });
  expect(mutation).not.toHaveBeenCalled();
  await act(() => {
    appListeners.forEach((listener) => {
      listener('active');
    });
  });
  await act(async () => {
    await pending;
  });
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(result.current.action.message).toBe('Refund requested');
});

it('converts a typed pound amount to exact pence and rejects unsafe financial input', () => {
  expect(poundsToPence('37.29')).toBe(3729);
  expect(poundsToPence('0.01')).toBe(1);
  expect(penceToInput(3729)).toBe('37.29');
  for (const value of ['1.999', '-1', '1e3', '0', 'NaN', '9007199254740992'])
    expect(() => poundsToPence(value)).toThrow();
});
