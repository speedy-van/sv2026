import type { ReactNode } from 'react';
import { jsonLd } from '@/server/marketing';

export function StructuredData({ data }: { data: unknown }): ReactNode {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
