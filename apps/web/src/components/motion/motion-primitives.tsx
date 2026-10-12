'use client';

import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }): ReactNode {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

export function FadeIn({ children }: { children: ReactNode }): ReactNode {
  const reduced = useReducedMotion();
  return (
    <m.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: reduced ? 0 : 12 }} transition={{ duration: reduced ? 0.12 : 0.22 }}>
      {children}
    </m.div>
  );
}
