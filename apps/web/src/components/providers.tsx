'use client';

import { ChakraProvider } from '@chakra-ui/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { ReactNode } from 'react';
import { system } from '@/theme/system';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <ChakraProvider value={system}>
      {children}
      <SpeedInsights />
    </ChakraProvider>
  );
}
