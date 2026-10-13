import 'server-only';

import { AppError, CatalogueResponseSchema } from '@sv/contracts';
import { prisma } from '@sv/db';
import { validateConfig, type PricingConfig } from '@sv/pricing';
import { z } from 'zod';

const PresetItemsSchema = z.array(
  z
    .object({
      itemSlug: z.string().min(1),
      quantity: z.number().int().min(1),
    })
    .strict(),
);

export async function getActivePricingConfig(): Promise<{ config: PricingConfig; id: string; version: number }> {
  const active = await prisma.pricingConfigVersion.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { config: true, id: true, version: true },
  });
  if (!active) {
    throw new AppError('INTERNAL', 'No active pricing version is configured.');
  }
  const config = active.config as unknown as PricingConfig;
  const problems = validateConfig(config);
  if (problems.length > 0) {
    throw new AppError('INTERNAL', 'The active pricing config is invalid.', { problems });
  }
  return { config, id: active.id, version: active.version };
}

export async function getCatalogue() {
  const [items, presets, config] = await Promise.all([
    prisma.item.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { aliases: true, category: true, name: true, slug: true, volumeM3: true },
    }),
    prisma.itemPreset.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { items: true, name: true, slug: true },
    }),
    getActivePricingConfig(),
  ]);

  const categories = [...new Set(items.map((item) => item.category))].sort((left, right) => left.localeCompare(right));

  return CatalogueResponseSchema.parse({
    items: items.map((item) => ({
      aliases: item.aliases,
      category: item.category,
      name: item.name,
      slug: item.slug,
      unitVolumeM3: item.volumeM3,
    })),
    presets: presets.map((preset) => ({
      items: PresetItemsSchema.parse(preset.items),
      label: preset.name,
      slug: preset.slug,
    })),
    customSizes: config.config.customItemSizes,
    categories,
  });
}
