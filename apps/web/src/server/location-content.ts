import 'server-only';

import { prisma } from '@sv/db';
import { cache } from 'react';

export interface PublishedLocationContent {
  localNotes: string;
  updatedAt: Date;
}

export const getPublishedLocationContent = cache(
  async (slug: string): Promise<PublishedLocationContent | null> => {
    const row = await prisma.locationContent.findUnique({
      where: { slug },
      select: { localNotes: true, published: true, updatedAt: true },
    });
    if (!row?.published || !row.localNotes?.trim()) return null;
    return { localNotes: row.localNotes.trim(), updatedAt: row.updatedAt };
  },
);

export const getPublishedLocationContentMap = cache(
  async (): Promise<Map<string, PublishedLocationContent>> => {
    const rows = await prisma.locationContent.findMany({
      where: { published: true, localNotes: { not: null } },
      select: { slug: true, localNotes: true, updatedAt: true },
    });
    const content = new Map<string, PublishedLocationContent>();
    for (const row of rows) {
      if (row.localNotes?.trim())
        content.set(row.slug, { localNotes: row.localNotes.trim(), updatedAt: row.updatedAt });
    }
    return content;
  },
);
