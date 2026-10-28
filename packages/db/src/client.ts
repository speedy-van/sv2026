import { PrismaNeon } from '@prisma/adapter-neon';
import dns from 'node:dns';
import { PrismaClient } from './generated/prisma/client';
import { runtimeDatabaseUrl } from './env';

dns.setDefaultResultOrder('ipv4first');

type GlobalPrisma = typeof globalThis & {
  __speedyVanPrisma?: PrismaClient;
  __speedyVanPrismaConstructor?: typeof PrismaClient;
};

export function createPrismaClient(connectionString = runtimeDatabaseUrl()): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });
}

const globalPrisma = globalThis as GlobalPrisma;

// Regenerating Prisma changes its constructor; an older singleton still has the old schema.
export const prisma = globalPrisma.__speedyVanPrismaConstructor === PrismaClient
  ? globalPrisma.__speedyVanPrisma ?? createPrismaClient()
  : createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalPrisma.__speedyVanPrisma = prisma;
  globalPrisma.__speedyVanPrismaConstructor = PrismaClient;
}
