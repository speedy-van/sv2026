import { neon } from '@neondatabase/serverless';
import { createHash, randomUUID } from 'node:crypto';
import dns from 'node:dns';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { directDatabaseUrl } from './env';

dns.setDefaultResultOrder('ipv4first');

const migrationsDir = resolve('prisma/migrations');

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';

    if (lineComment) {
      current += char;
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      current += char;
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === '-' && next === '-') {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === '/' && next === '*') {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }

    if (!doubleQuoted && char === "'" && next === "'") {
      current += char + next;
      index += 1;
      continue;
    }

    if (!doubleQuoted && char === "'") {
      singleQuoted = !singleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && char === '"') {
      doubleQuoted = !doubleQuoted;
      current += char;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && char === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

async function main(): Promise<void> {
  const sql = neon(directDatabaseUrl(), { fetchOptions: { cache: 'no-store' } });
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const migrationName of migrationNames) {
    const migrationRows = (await sql.query('SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "rolled_back_at" IS NULL', [migrationName])) as Array<{ count: string }>;
    const count = migrationRows[0]?.count ?? '0';
    if (count !== '0') {
      process.stdout.write(`Migration ${migrationName} already applied.\n`);
      continue;
    }

    const migrationSql = readFileSync(resolve(migrationsDir, migrationName, 'migration.sql'), 'utf8');
    const statements = splitSql(migrationSql);
    const startedAt = new Date();
    await sql.transaction((tx) => [
      ...statements.map((statement) => tx.query(statement)),
      tx.query(
        `
          INSERT INTO "_prisma_migrations" (
            "id",
            "checksum",
            "finished_at",
            "migration_name",
            "started_at",
            "applied_steps_count"
          )
          VALUES ($1, $2, now(), $3, $4, $5)
        `,
        [randomUUID(), checksum(migrationSql), migrationName, startedAt, statements.length],
      ),
    ]);
    process.stdout.write(`Applied migration ${migrationName} (${String(statements.length)} statements).\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
