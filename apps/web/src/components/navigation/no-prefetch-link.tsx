import NextLink from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type NoPrefetchLinkProps = ComponentProps<typeof NextLink>;

export function NoPrefetchLink(props: NoPrefetchLinkProps): ReactNode {
  return <NextLink {...props} prefetch={false} />;
}
