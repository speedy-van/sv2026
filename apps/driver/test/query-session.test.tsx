import { act, render, waitFor } from '@testing-library/react-native';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Text } from 'react-native';
import { DriverQuerySession } from '../src/state/query-session';

const mockAuth = { sessionVersion: 1 };
jest.mock('../src/state/auth', () => ({ useAuth: () => mockAuth }));
let currentClient: QueryClient | null = null;
function ClientReader(): React.ReactElement {
  currentClient = useQueryClient();
  return <Text>Root navigator stays mounted</Text>;
}
function client(): QueryClient {
  if (!currentClient) throw new Error('Mount the session first.');
  return currentClient;
}

beforeEach(() => { mockAuth.sessionVersion = 1; currentClient = null; });

it('retires customer/job/profile caches and in-flight responses when a different driver session is accepted', async () => {
  const view = await render(<DriverQuerySession><ClientReader /></DriverQuerySession>);
  const first = client();
  first.setQueryData(['driver-profile'], { name: 'First driver' });
  first.setQueryData(['driver-jobs', 'today'], { contact: 'Private customer from first session' });
  let resolveOld: ((value: string) => void) | undefined;
  const oldRequest = first.query({
    queryKey: ['driver-job', 'test-private-booking'],
    queryFn: () => new Promise<string>((resolve) => { resolveOld = resolve; }),
  }).catch(() => 'Cancelled old session');
  mockAuth.sessionVersion = 2;
  await view.rerender(<DriverQuerySession><ClientReader /></DriverQuerySession>);
  const next = client();
  expect(next).not.toBe(first);
  expect(next.getQueryData(['driver-profile'])).toBeUndefined();
  expect(next.getQueryData(['driver-jobs', 'today'])).toBeUndefined();
  expect(view.getByText('Root navigator stays mounted')).toBeTruthy();
  await act(async () => { resolveOld?.('Late old customer details'); await oldRequest; });
  expect(next.getQueryData(['driver-job', 'test-private-booking'])).toBeUndefined();
  await waitFor(() => { expect(first.getQueryCache().getAll()).toHaveLength(0); });
});
