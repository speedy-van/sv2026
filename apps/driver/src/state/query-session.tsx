import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useAuth } from './auth';

/** A retired session's requests can only settle into its detached, cancelled cache. */
export function DriverQuerySession(props: { children: React.ReactNode }): React.ReactElement {
  const { sessionVersion } = useAuth();
  const queryClient = useMemo(() => new QueryClient(), [sessionVersion]);
  useEffect(() => () => {
    void queryClient.cancelQueries().then(
      () => { queryClient.clear(); },
      () => { queryClient.clear(); },
    );
  }, [queryClient]);
  return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>;
}
