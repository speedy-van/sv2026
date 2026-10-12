import { PrismaNeon } from '@prisma/adapter-neon';
import dns from 'node:dns';
import { PrismaClient } from './generated/prisma/client';
import { runtimeDatabaseUrl } from './env';

dns.setDefaultResultOrder('ipv4first');

type GlobalPrisma = typeof globalThis & {
  __speedyVanPrisma?: PrismaClient;
};

export function createPrismaClient(connectionString = runtimeDatabaseUrl()): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });
}

const globalPrisma = globalThis as GlobalPrisma;

export const prisma = globalPrisma.__speedyVanPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalPrisma.__speedyVanPrisma = prisma;
}
